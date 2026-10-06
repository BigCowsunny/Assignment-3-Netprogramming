"""Discover reachable physical or EVE-NG nodes using SNMP only."""

import asyncio
import ipaddress
import logging
from typing import Dict, List, Optional

from snmp_engine import snmp_get_system_info, snmp_walk_interfaces
from device_types import classify_device

logger = logging.getLogger("network_scanner")


def _device_type(description: str) -> str:
    return classify_device(description)


async def scan_host(host: str, communities: List[str], port: int = 161) -> Optional[Dict]:
    """Return a node only when SNMP identifies it and exposes real interfaces."""
    for community in communities:
        info = await snmp_get_system_info(host, community, port=port, timeout=1.5)
        if not info.get("ok"):
            continue

        interfaces = await snmp_walk_interfaces(host, community, port=port, timeout=2.0)
        if not interfaces or not getattr(interfaces, "complete", True):
            logger.debug("SNMP answered at %s but returned no interfaces", host)
            continue

        descr = info.get("descr", "")
        return {
            "name": info.get("name") or f"SNMP-{host}",
            "ip": host,
            "ver": "v2c",
            "community": community,
            "snmp_port": port,
            "descr": descr,
            "type": _device_type(descr),
            "vendor": descr[:48] or "SNMP device",
            "status": "online",
            "up": info.get("uptime", "0"),
            "ports": interfaces,
        }
    return None


async def scan_network(
    network: str = "192.168.1.0/24",
    communities: Optional[List[str]] = None,
    max_concurrent: int = 50,
) -> List[Dict]:
    """Sweep a management subnet with SNMP GET and IF-MIB walks only."""
    try:
        ip_network = ipaddress.ip_network(network, strict=False)
    except ValueError as error:
        raise ValueError(f"Invalid network CIDR '{network}': {error}") from error

    hosts = [str(address) for address in ip_network.hosts()]
    community_list = [value.strip() for value in (communities or ["public"]) if value.strip()]
    if not community_list:
        raise ValueError("At least one SNMP community is required")

    semaphore = asyncio.Semaphore(max(1, min(max_concurrent, 200)))

    async def scan_with_semaphore(host: str) -> Optional[Dict]:
        async with semaphore:
            return await scan_host(host, community_list)

    results = await asyncio.gather(*(scan_with_semaphore(host) for host in hosts))
    devices = [result for result in results if result]
    logger.info("SNMP sweep of %s found %s device(s)", network, len(devices))
    return devices
