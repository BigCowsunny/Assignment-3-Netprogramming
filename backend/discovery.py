"""
Auto Discovery & Topology Engine
Meets PRD FR-6: LLDP-MIB, CDP-MIB, subnet sweep, link mapping
"""

import asyncio
import logging
from typing import Dict, Any, List

from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine,
    CommunityData,
    UdpTransportTarget,
    ContextData,
    ObjectType,
    ObjectIdentity,
    next_cmd,
)
from database import (
    get_all_devices,
    save_device,
    add_audit_log,
    save_topology_link,
)
from snmp_engine import snmp_get_system_info, snmp_walk_interfaces
from network_scanner import scan_network

logger = logging.getLogger("discovery")

# LLDP MIB
OID_LLDP_REM_SYS_NAME = "1.0.8802.1.1.2.1.4.1.1.9"
OID_LLDP_REM_PORT_ID = "1.0.8802.1.1.2.1.4.1.1.7"

# CDP MIB
OID_CDP_CACHE_DEVICE_ID = "1.3.6.1.4.1.9.9.23.1.2.1.1.6"
OID_CDP_CACHE_DEVICE_PORT = "1.3.6.1.4.1.9.9.23.1.2.1.1.7"
OID_CDP_CACHE_IFINDEX = "1.3.6.1.4.1.9.9.23.1.2.1.1.1"


async def _walk_column(ip: str, community: str, oid: str, port: int = 161) -> List[tuple[str, str]]:
    engine = SnmpEngine()
    rows: List[tuple[str, str]] = []
    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=1.5, retries=0)
        async for error, status, _, var_binds in next_cmd(
            engine, CommunityData(community), transport, ContextData(),
            ObjectType(ObjectIdentity(oid)), lexicographicMode=False,
        ):
            if error or status:
                break
            for var_bind in var_binds:
                rows.append((str(var_bind[0]), str(var_bind[1])))
    except Exception as error:
        logger.debug("SNMP table walk %s on %s failed: %s", oid, ip, error)
    return rows


async def discover_topology_links(devices: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Resolve LLDP/CDP neighbors to monitored devices and real interface names."""
    by_name = {str(device.get("name", "")).strip().lower(): device for device in devices}
    by_short_name = {name.split(".")[0]: device for name, device in by_name.items() if name}
    discovered: List[Dict[str, str]] = []
    for device in devices:
        ip = device.get("ip", "")
        community = device.get("community", "public")
        snmp_port = int(device.get("snmp_port", 161) or 161)
        ports_by_index = {int(port["idx"]): port["name"] for port in device.get("ports", [])}

        # LLDP remote table index is timeMark.localPortNum.remoteIndex.
        names = await _walk_column(ip, community, OID_LLDP_REM_SYS_NAME, snmp_port)
        remote_ports = dict(await _walk_column(ip, community, OID_LLDP_REM_PORT_ID, snmp_port))
        for oid, remote_name in names:
            try:
                suffix = oid.split(OID_LLDP_REM_SYS_NAME + ".", 1)[1].split(".")
                local_index = int(suffix[-2])
            except (IndexError, ValueError):
                continue
            remote = by_name.get(remote_name.strip().lower()) or by_short_name.get(remote_name.strip().lower().split(".")[0])
            local_name = ports_by_index.get(local_index)
            remote_port_value = remote_ports.get(oid.replace(OID_LLDP_REM_SYS_NAME, OID_LLDP_REM_PORT_ID))
            if not remote or remote["id"] == device["id"] or not local_name or not remote_port_value:
                continue
            remote_port = next((p["name"] for p in remote.get("ports", []) if p["name"].lower() == remote_port_value.lower()), remote_port_value)
            link = {"a": device["id"], "pa": local_name, "b": remote["id"], "pb": remote_port, "proto": "LLDP"}
            save_topology_link(link["a"], link["pa"], link["b"], link["pb"], link["proto"])
            discovered.append(link)

        # CDP cache index is ifIndex.deviceIndex.
        cdp_names = await _walk_column(ip, community, OID_CDP_CACHE_DEVICE_ID, snmp_port)
        cdp_ports = dict(await _walk_column(ip, community, OID_CDP_CACHE_DEVICE_PORT, snmp_port))
        for oid, remote_name in cdp_names:
            try:
                suffix = oid.split(OID_CDP_CACHE_DEVICE_ID + ".", 1)[1].split(".")
                local_index = int(suffix[0])
            except (IndexError, ValueError):
                continue
            remote = by_name.get(remote_name.strip().lower()) or by_short_name.get(remote_name.strip().lower().split(".")[0])
            local_name = ports_by_index.get(local_index)
            remote_port_value = cdp_ports.get(oid.replace(OID_CDP_CACHE_DEVICE_ID, OID_CDP_CACHE_DEVICE_PORT))
            if not remote or remote["id"] == device["id"] or not local_name or not remote_port_value:
                continue
            remote_port = next((p["name"] for p in remote.get("ports", []) if p["name"].lower() == remote_port_value.lower()), remote_port_value)
            link = {"a": device["id"], "pa": local_name, "b": remote["id"], "pb": remote_port, "proto": "CDP"}
            save_topology_link(link["a"], link["pa"], link["b"], link["pb"], link["proto"])
            discovered.append(link)
    return discovered


async def query_lldp_neighbors(ip: str, community: str = "public", port: int = 161) -> List[Dict[str, str]]:
    """Walk lldpRemTable to discover connected neighbor devices and ports"""
    engine = SnmpEngine()
    neighbors = []
    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=2.0, retries=1)
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_LLDP_REM_SYS_NAME)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                rem_name = str(vb[1])
                neighbors.append({"name": rem_name, "protocol": "LLDP"})
    except Exception as e:
        logger.debug(f"LLDP query to {ip} error: {e}")
    return neighbors


async def query_cdp_neighbors(ip: str, community: str = "public", port: int = 161) -> List[Dict[str, str]]:
    """Walk cdpCacheTable to discover connected Cisco neighbors"""
    engine = SnmpEngine()
    neighbors = []
    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=2.0, retries=1)
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_CDP_CACHE_DEVICE_ID)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                rem_name = str(vb[1])
                neighbors.append({"name": rem_name, "protocol": "CDP"})
    except Exception as e:
        logger.debug(f"CDP query to {ip} error: {e}")
    return neighbors


async def discover_network(seed_ip: str, community: str = "public", subnet: str = "") -> Dict[str, Any]:
    """
    Run full discovery starting from seed IP or subnet
    Discovers neighbors via LLDP/CDP and returns newly discovered devices and links
    """
    logger.info(f"Starting discovery from seed={seed_ip}, subnet={subnet}")

    existing_devices = get_all_devices()
    existing_ips = {d["ip"] for d in existing_devices}
    scanned = await scan_network(subnet, [community], max_concurrent=40) if subnet else []
    candidates = list(scanned)
    if seed_ip and seed_ip not in {candidate.get("ip") for candidate in candidates}:
        candidates.append({"ip": seed_ip, "community": community})

    discovered_new_devices = []
    for index, candidate in enumerate(candidates, start=1):
        ip = candidate.get("ip", "")
        if not ip:
            continue
        probe = await snmp_get_system_info(ip, community)
        if not probe.get("ok"):
            continue
        ports = await snmp_walk_interfaces(ip, community)
        if ip in existing_ips:
            continue
        safe_ip = "".join(ch if ch.isalnum() else "_" for ch in ip)
        descr = probe.get("descr", "")
        new_dev = {
            "id": f"discovery_{safe_ip}"[:80], "name": probe.get("name") or f"Discovered-{ip}",
            "ip": ip, "ver": "v2c", "community": community, "snmp_port": 161,
            "type": "switch" if any(word in descr.lower() for word in ("switch", "catalyst", "c29", "iol l2")) else "router",
            "vendor": descr[:48] or "SNMP Network Device", "descr": descr,
            "status": "online", "up": probe.get("uptime", "0"), "ports": ports,
        }
        save_device(new_dev)
        discovered_new_devices.append(new_dev)
        existing_ips.add(ip)

    all_devices = get_all_devices()
    discovered_new_links = await discover_topology_links(all_devices)

    add_audit_log("admin", "Auto Discovery (LLDP/CDP)", subnet or seed_ip or "Network", f"พบ {len(discovered_new_devices)} อุปกรณ์ใหม่")

    return {
        "ok": True,
        "new_devices_count": len(discovered_new_devices),
        "devices": get_all_devices(),
        "links": discovered_new_links
    }
