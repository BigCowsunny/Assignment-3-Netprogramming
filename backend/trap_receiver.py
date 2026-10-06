"""
SNMP Trap Receiver module listening on UDP 162
Decodes linkDown (1.3.6.1.6.3.1.1.5.3) and linkUp (1.3.6.1.6.3.1.1.5.4) traps
Meets PRD FR-5 requirements: Real Trap reception, varbind decoding, DB logging, WS push
"""

import asyncio
import json
import logging
import time
import uuid
from typing import Callable, Optional, Set
from fastapi import WebSocket
from pyasn1.codec.ber import decoder
from pysnmp.proto import api

from database import add_audit_log, add_event, get_all_devices, save_device, update_interface_status
from snmp_engine import snmp_get_system_info, snmp_walk_interfaces
from device_types import classify_device

logger = logging.getLogger("trap_receiver")

OID_LINK_DOWN = "1.3.6.1.6.3.1.1.5.3"
OID_LINK_UP = "1.3.6.1.6.3.1.1.5.4"
OID_SNMP_TRAP_OID = "1.3.6.1.6.3.1.1.4.1.0"


class WebSocketManager:
    """Manages active WebSocket connections to push live events to web browsers"""
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        dead_sockets = set()
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                dead_sockets.add(connection)
        for dead in dead_sockets:
            self.active_connections.discard(dead)


ws_manager = WebSocketManager()


async def _discover_from_trap(source_ip: str, community: str) -> Optional[dict]:
    """Enroll an unknown trap sender only after SNMP GET and IF-MIB confirm it."""
    current = next((item for item in get_all_devices() if item.get("ip") == source_ip), None)
    if current and not current.get("discovery_only"):
        return current

    if not community:
        logger.warning("Cannot discover SNMP trap source %s without a community", source_ip)
        return None

    info = await snmp_get_system_info(source_ip, community, timeout=2.0)
    if not info.get("ok"):
        logger.warning("Trap received from %s, but SNMP GET with the trap community failed", source_ip)
        return None

    interfaces = await snmp_walk_interfaces(source_ip, community, timeout=2.5)
    if not interfaces or not getattr(interfaces, "complete", True):
        logger.warning("Trap received from %s, but SNMP returned no interfaces", source_ip)
        return None

    descr = info.get("descr", "")
    safe_ip = "".join(char if char.isalnum() else "_" for char in source_ip)
    device = {
        "id": f"trap_{safe_ip}"[:80],
        "name": info.get("name") or f"SNMP-{source_ip}",
        "ip": source_ip,
        "ver": "v2c",
        "community": community,
        "snmp_port": 161,
        "type": classify_device(descr),
        "vendor": descr[:48] or "SNMP device",
        "descr": descr,
        "status": "online",
        "up": info.get("uptime", "0"),
        "ports": interfaces,
    }
    # A subnet scan or another trap may have enrolled this IP while the SNMP
    # requests above were in flight. Preserve its stable ID in that case.
    current = next((item for item in get_all_devices() if item.get("ip") == source_ip), None)
    if current:
        if not current.get("discovery_only"):
            return current
        device["id"] = current["id"]
    save_device(device)
    add_audit_log("snmp-trap", "Auto Discovery via SNMP Trap", source_ip, "สำเร็จ")

    saved = next((item for item in get_all_devices() if item["ip"] == source_ip), device)
    await ws_manager.broadcast({"type": "DEVICE_DISCOVERED", "device": saved})
    logger.info("Auto-discovered SNMP device %s (%s) with %s interfaces", saved["name"], source_ip, len(interfaces))
    return saved


class SnmpTrapProtocol(asyncio.DatagramProtocol):
    def __init__(self, on_trap_callback: Optional[Callable] = None):
        self.on_trap_callback = on_trap_callback
        self.transport = None
        self.tasks = set()

    def connection_made(self, transport):
        self.transport = transport
        logger.info("SNMP Trap listener ready on %s", transport.get_extra_info("sockname"))

    def datagram_received(self, data: bytes, addr: tuple):
        src_ip = addr[0]
        logger.info(f"Incoming SNMP packet ({len(data)} bytes) from {src_ip}:{addr[1]}")

        try:
            trap_data = self.parse_trap(data, src_ip)
            if trap_data:
                # Handle trap in async task
                if len(self.tasks) >= 256:
                    logger.warning("Trap queue full; dropped notification from %s", src_ip)
                    return
                task = asyncio.create_task(self.handle_parsed_trap(trap_data))
                self.tasks.add(task)
                task.add_done_callback(self._task_done)
        except Exception as e:
            logger.error(f"Failed to process trap from {src_ip}: {e}")

    def _task_done(self, task):
        self.tasks.discard(task)
        if not task.cancelled() and task.exception():
            logger.error("Trap processing failed: %s", task.exception())

    def connection_lost(self, exc):
        for task in list(self.tasks):
            task.cancel()

    def parse_trap(self, data: bytes, src_ip: str) -> Optional[dict]:
        """Decode real v1/v2c notifications, including v1 interface varbinds."""
        try:
            version = int(api.decodeMessageVersion(data))
            proto = api.v1 if version == 0 else api.v2c if version == 1 else None
            if proto is None:
                return None
            message, trailing = decoder.decode(data, asn1Spec=proto.Message())
            if trailing:
                return None
            pdu = proto.apiMessage.get_pdu(message)
            trap_oid = ""
            if version == 0:
                if pdu.tagSet != api.v1.TrapPDU.tagSet:
                    return None
                generic = int(proto.apiTrapPDU.get_generic_trap(pdu))
                if generic not in (2, 3):
                    return None
                trap_oid = OID_LINK_DOWN if generic == 2 else OID_LINK_UP
                varbinds = proto.apiTrapPDU.get_varbinds(pdu)
            else:
                if pdu.tagSet != api.v2c.SNMPv2TrapPDU.tagSet:
                    return None
                varbinds = proto.apiPDU.get_varbinds(pdu)
            raw = {str(oid): str(value) for oid, value in varbinds}
            if version == 1:
                trap_oid = raw.get(OID_SNMP_TRAP_OID, "")
            if trap_oid not in (OID_LINK_DOWN, OID_LINK_UP):
                return None
            result = {
                "source_ip": src_ip, "community": str(proto.apiMessage.get_community(message)),
                "type": "linkDown" if trap_oid == OID_LINK_DOWN else "linkUp",
                "oid": trap_oid, "if_index": None, "if_name": None, "admin": None,
                "oper": "down" if trap_oid == OID_LINK_DOWN else "up", "raw": raw,
            }
            for oid, value in raw.items():
                if oid.startswith("1.3.6.1.2.1.2.2.1.1."):
                    try:
                        result["if_index"] = int(value) if int(value) > 0 else None
                    except ValueError:
                        pass
            for oid, value in raw.items():
                for base, field in (("1.3.6.1.2.1.2.2.1.7.", "admin"),
                                    ("1.3.6.1.2.1.2.2.1.8.", "oper"),
                                    ("1.3.6.1.2.1.2.2.1.2.", "if_name"),
                                    ("1.3.6.1.2.1.31.1.1.1.1.", "if_name")):
                    if not oid.startswith(base):
                        continue
                    index = int(oid[len(base):])
                    if result["if_index"] is None and index > 0:
                        result["if_index"] = index
                    if result["if_index"] != index:
                        continue
                    if field == "if_name":
                        result[field] = value
                    elif value in ("1", "2"):
                        result[field] = "up" if value == "1" else "down"
            return result
        except Exception:
            logger.debug("Ignoring malformed SNMP packet from %s", src_ip)
            return None

    async def handle_parsed_trap(self, trap_data: dict):
        src_ip = trap_data["source_ip"]
        trap_type = trap_data["type"]
        trap_oid = trap_data["oid"]

        # Match device by IP in database
        devices = get_all_devices()
        matched_dev = None
        for dev in devices:
            addresses = {dev["ip"], *(port.get("ip", "") for port in dev.get("ports", []))}
            if src_ip in addresses and not dev.get("discovery_only"):
                matched_dev = dev
                break

        device_id = matched_dev["id"] if matched_dev else "unknown"
        device_name = matched_dev["name"] if matched_dev else src_ip

        # Determine port name
        port_name = trap_data["if_name"]
        if matched_dev and trap_data["if_index"]:
            for p in matched_dev.get("ports", []):
                if p["idx"] == trap_data["if_index"]:
                    port_name = p["name"]
                    break

        if not port_name:
            port_name = f"ifIndex {trap_data['if_index']}" if trap_data.get("if_index") else "Unknown interface"

        evt_id = f"e_{uuid.uuid4().hex}"
        logger.info(f"TRAP RECEIVED: {trap_type} on {device_name} ({src_ip}) Port {port_name}")

        # Update interface oper status in DB if device is known
        new_oper = "down" if trap_type == "linkDown" else "up"
        if matched_dev and port_name:
            update_interface_status(device_id, port_name, admin=trap_data.get("admin"), oper=new_oper)

        # Store in events table
        add_event(
            evt_id=evt_id,
            device_id=device_id,
            source_ip=src_ip,
            port_name=port_name,
            trap_type=trap_type,
            oid=trap_oid,
            raw_varbinds=json.dumps(trap_data.get("raw", {}))
        )

        # Broadcast via WebSocket to all connected browser clients (FR-5.5, FR-5.6)
        ws_payload = {
            "type": "TRAP_EVENT",
            "event": {
                "id": evt_id,
                "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "dev": device_id,
                "dev_name": device_name,
                "src": src_ip,
                "port": port_name,
                "type": trap_type,
                "oid": trap_oid,
                "oper": new_oper,
                "admin": trap_data.get("admin"),
                "isNew": True
            }
        }
        await ws_manager.broadcast(ws_payload)
        # Record receipt immediately, even if the sender cannot be queried.
        # Trap community is not necessarily the device's read community.
        if not matched_dev and src_ip not in ("127.0.0.1", "::1"):
            try:
                await asyncio.wait_for(_discover_from_trap(src_ip, trap_data.get("community", "")), timeout=8)
            except asyncio.TimeoutError:
                logger.info("Trap recorded; sender %s could not be enrolled yet", src_ip)


async def start_trap_listener(port: int = 162) -> asyncio.DatagramTransport:
    """Start UDP datagram server for receiving SNMP Traps"""
    loop = asyncio.get_running_loop()
    try:
        transport, _ = await loop.create_datagram_endpoint(
            lambda: SnmpTrapProtocol(),
            local_addr=("0.0.0.0", port)
        )
        logger.info(f"SNMP Trap Receiver started on UDP 0.0.0.0:{port}")
        return transport
    except Exception as e:
        if port != 1162:
            logger.warning(f"Could not bind UDP {port} ({e}). Trying fallback port 1162...")
            try:
                transport, _ = await loop.create_datagram_endpoint(
                    lambda: SnmpTrapProtocol(),
                    local_addr=("0.0.0.0", 1162)
                )
                logger.info("SNMP Trap Receiver started on UDP 0.0.0.0:1162")
                return transport
            except Exception as fallback_error:
                logger.error(f"Could not bind SNMP Trap Receiver on 162 or 1162: {fallback_error}")
                return None
        logger.error(f"Could not bind SNMP Trap Receiver: {e}")
        return None
