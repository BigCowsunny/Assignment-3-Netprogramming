"""Passive CDP/LLDP discovery. Captures advertisements received by this host."""

import asyncio
import ipaddress
import logging
import os
import struct
import threading
from typing import Optional
from device_types import classify_device

logger = logging.getLogger("cdp_receiver")
CDP_DESTINATION = bytes.fromhex("01000ccccccc")
CDP_SNAP = bytes.fromhex("aaaa0300000c2000")


def _text(value: bytes) -> str:
    return value.decode("utf-8", errors="replace").strip("\x00 \r\n")[:512]


def _addresses(value: bytes) -> list[str]:
    if len(value) < 4:
        raise ValueError("Truncated CDP address count")
    count = int.from_bytes(value[:4], "big")
    if count > 128:
        raise ValueError("Too many CDP addresses")
    offset = 4
    found = []
    for _ in range(count):
        if offset + 2 > len(value):
            raise ValueError("Truncated CDP protocol")
        protocol_type, protocol_length = value[offset:offset + 2]
        offset += 2
        if offset + protocol_length + 2 > len(value):
            raise ValueError("Truncated CDP address")
        protocol = value[offset:offset + protocol_length]
        offset += protocol_length
        size = int.from_bytes(value[offset:offset + 2], "big")
        offset += 2
        if offset + size > len(value):
            raise ValueError("Truncated CDP address bytes")
        address = value[offset:offset + size]
        offset += size
        if protocol_type == 1 and protocol == b"\xcc" and size == 4:
            ip = ipaddress.IPv4Address(address)
            if not (ip.is_unspecified or ip.is_multicast or ip.is_loopback):
                found.append(str(ip))
    return found


def parse_cdp_frame(frame: bytes, interface: str = "") -> Optional[dict]:
    """Read CDPv1/v2 from Ethernet/802.1Q without relying on optional Scapy."""
    try:
        if len(frame) < 26 or frame[:6] != CDP_DESTINATION:
            return None
        source_mac = ":".join(f"{octet:02x}" for octet in frame[6:12])
        offset = 12
        length = int.from_bytes(frame[offset:offset + 2], "big")
        while length in (0x8100, 0x88A8, 0x9100):
            offset += 4
            if offset + 2 > len(frame):
                return None
            length = int.from_bytes(frame[offset:offset + 2], "big")
        offset += 2
        if length > 1500 or offset + length > len(frame):
            return None
        payload = frame[offset:offset + length]
        if len(payload) < 12 or payload[:8] != CDP_SNAP:
            return None
        version, ttl = payload[8:10]
        if version not in (1, 2):
            return None
        fields: dict[int, bytes] = {}
        offset = 12
        while offset < len(payload):
            if offset + 4 > len(payload):
                return None
            kind, size = struct.unpack_from("!HH", payload, offset)
            if size < 4 or offset + size > len(payload):
                return None
            fields[kind] = payload[offset + 4:offset + size]
            offset += size
        identity = _text(fields.get(1, b""))
        port = _text(fields.get(3, b""))
        if not identity or not port:
            return None
        addresses = _addresses(fields[0x16]) if 0x16 in fields else []
        addresses += _addresses(fields[2]) if 2 in fields else []
        capabilities = int.from_bytes(fields.get(4, b"\x00"), "big")
        return {
            "identity": identity, "name": identity, "source_mac": source_mac,
            "management_ip": addresses[0] if addresses else "",
            "port": port, "platform": _text(fields.get(6, b"")),
            "description": _text(fields.get(5, b"")),
            "device_type": classify_device(_text(fields.get(6, b"")), capabilities),
            "protocol": "CDP", "ttl": ttl, "capture_interface": interface,
        }
    except (ValueError, IndexError, struct.error):
        return None


class CdpCapture:
    """Run blocking packet capture on a worker; persist on the asyncio loop."""

    def __init__(self):
        self.status = "stopped"
        self.error = ""
        self.interfaces: list[str] = []
        self._stop = threading.Event()
        self._thread = None
        self._loop = None
        self._queue = None
        self._consumer = None
        self.dropped_packets = 0
        self.received_packets = {"CDP": 0, "LLDP": 0}

    def health(self) -> dict:
        return {"status": self.status, "error": self.error,
                "interfaces": self.interfaces, "dropped_packets": self.dropped_packets,
                "received_packets": self.received_packets.copy(), "protocols": ["CDP", "LLDP"]}

    async def start(self):
        if self._thread and self._thread.is_alive():
            return
        if os.getenv("NETFIX_CDP_ENABLED", "true").lower() in ("0", "false", "no"):
            self.status = "disabled"
            return
        self._loop = asyncio.get_running_loop()
        if self._consumer:
            self._consumer.cancel()
            try:
                await self._consumer
            except asyncio.CancelledError:
                pass
        self._queue = asyncio.Queue(maxsize=256)
        self._stop.clear()
        self.status, self.error = "starting", ""
        self._consumer = asyncio.create_task(self._consume())
        self._thread = threading.Thread(target=self._capture, name="netfix-cdp", daemon=True)
        self._thread.start()

    def _enqueue(self, neighbor):
        if self._stop.is_set():
            return
        protocol = neighbor.get("protocol", "CDP")
        self.received_packets[protocol] = self.received_packets.get(protocol, 0) + 1
        try:
            self._queue.put_nowait(neighbor)
        except asyncio.QueueFull:
            self.dropped_packets += 1

    def _capture(self):
        try:
            from scapy.all import conf, get_if_list, AsyncSniffer
            if os.name == "nt" and not conf.use_pcap:
                raise RuntimeError("Windows ต้องติดตั้ง Npcap เพื่อรับเฟรม CDP")
            configured = os.getenv("NETFIX_CDP_INTERFACES", "")
            self.interfaces = [name.strip() for name in configured.split(",") if name.strip()] or [
                name for name in get_if_list() if "npf_loopback" not in name.lower() and name != "lo"
            ]
            if not self.interfaces:
                raise RuntimeError("ไม่พบการ์ดเครือข่ายสำหรับรับ CDP")

            def packet_received(packet):
                from lldp_receiver import parse_lldp_frame
                raw, interface = bytes(packet), str(getattr(packet, "sniffed_on", ""))
                neighbor = parse_cdp_frame(raw, interface) or parse_lldp_frame(raw, interface)
                if neighbor and not self._stop.is_set():
                    self._loop.call_soon_threadsafe(self._enqueue, neighbor)

            def ready():
                self.status = "listening"

            # Keep capture sockets open continuously; reopening every two seconds
            # can drop the sole advertisement received during that gap.
            sniffer = AsyncSniffer(iface=self.interfaces,
                filter="ether dst 01:00:0c:cc:cc:cc or ether dst 01:80:c2:00:00:0e or ether dst 01:80:c2:00:00:03 or ether dst 01:80:c2:00:00:00",
                store=False, prn=packet_received, started_callback=ready)
            sniffer.start()
            try:
                while not self._stop.wait(0.25):
                    if not sniffer.thread.is_alive():
                        sniffer.join()  # Propagates capture setup errors.
                        raise RuntimeError("CDP/LLDP capture stopped unexpectedly")
            finally:
                if sniffer.running and hasattr(sniffer, "stop_cb"):
                    sniffer.stop(join=False)
                sniffer.join()
        except Exception as error:
            self.status = "unavailable"
            self.error = str(error)
            logger.warning("CDP capture unavailable: %s", error)

    async def _consume(self):
        from database import record_discovered_neighbor
        from trap_receiver import ws_manager
        while True:
            neighbor = await self._queue.get()
            try:
                device, is_new = record_discovered_neighbor(neighbor)
                await ws_manager.broadcast({"type": "NEIGHBOR_DISCOVERED", "device": device, "is_new": is_new})
            except Exception:
                logger.exception("Cannot persist CDP neighbor")
            finally:
                self._queue.task_done()

    async def stop(self):
        self._stop.set()
        if self._thread:
            await asyncio.to_thread(self._thread.join, 3)
        if self._consumer:
            self._consumer.cancel()
            try:
                await self._consumer
            except asyncio.CancelledError:
                pass
        self.status = "stopped"


cdp_capture = CdpCapture()
