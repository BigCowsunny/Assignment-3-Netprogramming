"""Identify trap senders without assuming a NAT gateway is a single router."""

import ipaddress
from typing import Optional

OID_TRAP_ADDRESS = "1.3.6.1.6.3.18.1.3.0"
OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"


def normalize_address(value: str) -> str:
    try:
        address = ipaddress.ip_interface(str(value).strip()).ip
        return str(address) if not address.is_unspecified and not address.is_multicast else ""
    except ValueError:
        return ""


def trap_identity(raw: dict, agent_ip: str = "", agent_name: str = "") -> tuple[str, str]:
    return (normalize_address(agent_ip or raw.get(OID_TRAP_ADDRESS, "")),
            str(agent_name or raw.get(OID_SYS_NAME) or "").strip())


def match_trap_device(devices: list, source_ip: str, agent_ip: str = "",
                      agent_name: str = "") -> Optional[dict]:
    def by_address(value):
        address = normalize_address(value)
        if not address:
            return None
        matches = [device for device in devices if address in
                   {normalize_address(device.get("ip", "")),
                    *(normalize_address(port.get("ip", "")) for port in device.get("ports", []))}]
        return matches[0] if len(matches) == 1 else None

    # SNMPv1 agent-addr / translated v2c snmpTrapAddress survives transport NAT.
    matched = by_address(agent_ip)
    if matched:
        return matched
    name = agent_name.strip().casefold()
    if name:
        matches = [device for device in devices if name == device.get("name", "").casefold()]
        if not matches:
            matches = [device for device in devices if name.split(".")[0] ==
                       device.get("name", "").casefold().split(".")[0]]
        if len(matches) == 1:
            return matches[0]
    # An unknown embedded identity must not be attributed to its relay/router.
    if normalize_address(agent_ip) or name:
        return None
    return by_address(source_ip)


def trap_interface_index(raw: dict) -> Optional[int]:
    for oid, value in raw.items():
        if oid.startswith("1.3.6.1.2.1.2.2.1.1."):
            try:
                index = int(value)
                if index > 0:
                    return index
            except (ValueError, TypeError):
                pass
    for oid in raw:
        for base in ("1.3.6.1.2.1.2.2.1.7.", "1.3.6.1.2.1.2.2.1.8.",
                     "1.3.6.1.2.1.2.2.1.2.", "1.3.6.1.2.1.31.1.1.1.1."):
            if oid.startswith(base):
                try:
                    index = int(oid[len(base):])
                    if index > 0:
                        return index
                except ValueError:
                    pass
    return None
