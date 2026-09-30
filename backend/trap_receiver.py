"""
SNMP Trap Receiver module listening on UDP 162
Decodes linkDown (1.3.6.1.6.3.1.1.5.3) and linkUp (1.3.6.1.6.3.1.1.5.4) traps
Meets PRD FR-5 requirements: Real Trap reception, varbind decoding, DB logging, WS push
"""

import asyncio
import json
import logging
import time
from typing import Callable, Optional, Set
from fastapi import WebSocket
from pyasn1.codec.ber import decoder
from pysnmp.proto import api

from database import add_event, get_all_devices, update_interface_status

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


class SnmpTrapProtocol(asyncio.DatagramProtocol):
    def __init__(self, on_trap_callback: Optional[Callable] = None):
        self.on_trap_callback = on_trap_callback
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport
        logger.info("SNMP Trap listener ready on UDP port 162")

    def datagram_received(self, data: bytes, addr: tuple):
        src_ip = addr[0]
        logger.info(f"Incoming SNMP packet ({len(data)} bytes) from {src_ip}:{addr[1]}")

        try:
            trap_data = self.parse_trap(data, src_ip)
            if trap_data:
                # Handle trap in async task
                asyncio.create_task(self.handle_parsed_trap(trap_data))
        except Exception as e:
            logger.error(f"Failed to process trap from {src_ip}: {e}")

    def parse_trap(self, data: bytes, src_ip: str) -> Optional[dict]:
        """Decode SNMPv2c / SNMPv1 trap packet"""
        try:
            # Try decoding as SNMPv2c
            msg, _ = decoder.decode(data, asn1Spec=api.v2c.Message())
            community = str(api.v2c.apiMessage.get_community(msg))
            pdu = api.v2c.apiMessage.get_pdu(msg)
            varbinds = api.v2c.apiPDU.get_varbinds(pdu)

            trap_type = "unknown"
            trap_oid = ""
            if_index = None
            if_name = None
            admin_status = None
            oper_status = None
            raw_vbs = {}

            for vb in varbinds:
                oid_str = str(vb[0])
                val_str = str(vb[1])
                raw_vbs[oid_str] = val_str

                if oid_str == OID_SNMP_TRAP_OID:
                    trap_oid = val_str
                    if OID_LINK_DOWN in val_str:
                        trap_type = "linkDown"
                    elif OID_LINK_UP in val_str:
                        trap_type = "linkUp"
                elif ".1.3.6.1.2.1.2.2.1.1." in oid_str:  # ifIndex
                    try:
                        if_index = int(val_str)
                    except Exception:
                        pass
                elif ".1.3.6.1.2.1.2.2.1.7." in oid_str:  # ifAdminStatus
                    try:
                        admin_status = "up" if int(val_str) == 1 else "down"
                    except Exception:
                        pass
                elif ".1.3.6.1.2.1.2.2.1.8." in oid_str:  # ifOperStatus
                    try:
                        oper_status = "up" if int(val_str) == 1 else "down"
                    except Exception:
                        pass
                elif ".1.3.6.1.2.1.2.2.1.2." in oid_str:  # ifDescr
                    if_name = val_str

            # Fallback deduction if trap_oid wasn't explicitly standard
            if trap_type == "unknown":
                if oper_status == "down" or admin_status == "down":
                    trap_type = "linkDown"
                    trap_oid = OID_LINK_DOWN
                elif oper_status == "up":
                    trap_type = "linkUp"
                    trap_oid = OID_LINK_UP
                else:
                    trap_type = "linkDown"
                    trap_oid = OID_LINK_DOWN

            return {
                "source_ip": src_ip,
                "community": community,
                "type": trap_type,
                "oid": trap_oid or (OID_LINK_DOWN if trap_type == "linkDown" else OID_LINK_UP),
                "if_index": if_index,
                "if_name": if_name,
                "admin": admin_status,
                "oper": oper_status,
                "raw": raw_vbs
            }
        except Exception:
            # Fallback to SNMPv1 trap
            try:
                msg, _ = decoder.decode(data, asn1Spec=api.v1.Message())
                pdu = api.v1.apiMessage.get_pdu(msg)
                generic_trap = int(api.v1.apiTrapPDU.get_generic_trap(pdu))
                trap_type = "linkDown" if generic_trap == 2 else "linkUp" if generic_trap == 3 else "linkDown"
                return {
                    "source_ip": src_ip,
                    "community": str(api.v1.apiMessage.get_community(msg)),
                    "type": trap_type,
                    "oid": OID_LINK_DOWN if trap_type == "linkDown" else OID_LINK_UP,
                    "if_index": None,
                    "if_name": None,
                    "admin": None,
                    "oper": "down" if trap_type == "linkDown" else "up",
                    "raw": {}
                }
            except Exception as e:
                logger.error(f"Cannot parse SNMP packet: {e}")
                return None

    async def handle_parsed_trap(self, trap_data: dict):
        src_ip = trap_data["source_ip"]
        trap_type = trap_data["type"]
        trap_oid = trap_data["oid"]

        # Match device by IP in database
        devices = get_all_devices()
        matched_dev = None
        for dev in devices:
            if dev["ip"] == src_ip:
                matched_dev = dev
                break

        device_id = matched_dev["id"] if matched_dev else "unknown"
        device_name = matched_dev["name"] if matched_dev else "Unknown Source"

        # Determine port name
        port_name = trap_data["if_name"]
        if not port_name and matched_dev and trap_data["if_index"]:
            for p in matched_dev.get("ports", []):
                if p["idx"] == trap_data["if_index"]:
                    port_name = p["name"]
                    break

        if not port_name:
            port_name = f"ifIndex {trap_data.get('if_index') or '1'}"

        evt_id = f"e_{int(time.time()*1000)}"
        logger.info(f"TRAP RECEIVED: {trap_type} on {device_name} ({src_ip}) Port {port_name}")

        # Update interface oper status in DB if device is known
        new_oper = "down" if trap_type == "linkDown" else "up"
        if matched_dev and port_name:
            update_interface_status(device_id, port_name, oper=new_oper)

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
                "isNew": True
            }
        }
        await ws_manager.broadcast(ws_payload)


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
    except PermissionError:
        logger.warning(f"Permission denied for port {port}. Trying fallback port 1162...")
        transport, _ = await loop.create_datagram_endpoint(
            lambda: SnmpTrapProtocol(),
            local_addr=("0.0.0.0", 1162)
        )
        logger.info("SNMP Trap Receiver started on UDP 0.0.0.0:1162 (redirect from 162 recommended)")
        return transport
    except Exception as e:
        logger.error(f"Could not bind SNMP Trap Receiver: {e}")
        return None
