"""Strict passive LLDP decoder; no SNMP credentials or IP required."""

import ipaddress


def _identifier(value, chassis=False):
    if not value:
        return ""
    subtype, data = value[0], value[1:]
    if subtype == (4 if chassis else 3) and len(data) == 6:
        return data.hex(":")
    return data.decode("utf-8", errors="replace").strip("\x00 ")[:512]


def parse_lldp_frame(frame: bytes, interface: str = ""):
    try:
        if len(frame) < 16 or frame[:6] not in (
            bytes.fromhex("0180c200000e"), bytes.fromhex("0180c2000003"), bytes.fromhex("0180c2000000")):
            return None
        offset, ether_type = 12, int.from_bytes(frame[12:14], "big")
        while ether_type in (0x8100, 0x88A8):
            offset += 4
            ether_type = int.from_bytes(frame[offset:offset + 2], "big")
        if ether_type != 0x88CC:
            return None
        offset += 2
        fields, order, ended = {}, [], False
        while offset + 2 <= len(frame):
            header = int.from_bytes(frame[offset:offset + 2], "big")
            kind, length = header >> 9, header & 511
            offset += 2
            if offset + length > len(frame):
                return None
            value = frame[offset:offset + length]
            offset += length
            if kind == 0:
                if length: return None
                ended = True
                break
            order.append(kind)
            fields[kind] = value
        if not ended or order[:3] != [1, 2, 3] or any(order.count(kind) != 1 for kind in (1, 2, 3)) or len(fields.get(3, b"")) != 2:
            return None
        chassis, port = fields.get(1, b""), fields.get(2, b"")
        if len(chassis) < 2 or len(port) < 2:
            return None
        if chassis[0] not in range(1, 8) or port[0] not in range(1, 8):
            return None
        if (chassis[0] == 4 and len(chassis) != 7) or (port[0] == 3 and len(port) != 7):
            return None
        chassis_id = f"{chassis[0]}:{chassis[1:].hex()}"
        chassis_mac = chassis[1:].hex(":") if chassis[0] == 4 and len(chassis) == 7 else ""
        name = fields.get(5, b"").decode("utf-8", errors="replace").strip("\x00 ")[:512] or _identifier(chassis, chassis=True)
        port_name = _identifier(port)
        if port[0] != 5 and fields.get(4):
            port_name = fields[4].decode("utf-8", errors="replace").strip("\x00 ")[:512]
        ip = ""
        management = fields.get(8, b"")
        if len(management) >= 6 and management[0] == 5 and management[1] == 1:
            address = ipaddress.IPv4Address(management[2:6])
            if not (address.is_unspecified or address.is_multicast or address.is_loopback):
                ip = str(address)
        capabilities = int.from_bytes(fields.get(7, b"\x00\x00\x00\x00")[2:4], "big")
        return {"identity": name or chassis_id, "name": name or chassis_id,
                "chassis_id": chassis_id, "chassis_mac": chassis_mac,
                "source_mac": frame[6:12].hex(":"), "management_ip": ip, "port": port_name,
                "protocol": "LLDP", "ttl": int.from_bytes(fields[3], "big"),
                "device_type": "switch" if capabilities & 4 else "router",
                "description": fields.get(6, b"").decode("utf-8", errors="replace")[:512],
                "capture_interface": interface}
    except (IndexError, ValueError):
        return None
