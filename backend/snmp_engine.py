"""
SNMP Engine module using pysnmp async hlapi
Handles SNMP GET, SET, WALK for devices, interfaces, and stats
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional, Tuple

from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine,
    CommunityData,
    UdpTransportTarget,
    ContextData,
    ObjectType,
    ObjectIdentity,
    get_cmd,
    set_cmd,
    next_cmd,
    bulk_cmd,
)
from pysnmp.proto.rfc1902 import Integer32, OctetString

logger = logging.getLogger("snmp_engine")

# Common Standard OIDs (Appendix A in PRD)
OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0"
OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0"
OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"

OID_IF_TABLE = "1.3.6.1.2.1.2.2.1"
OID_IF_INDEX = "1.3.6.1.2.1.2.2.1.1"
OID_IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
OID_IF_TYPE = "1.3.6.1.2.1.2.2.1.3"
OID_IF_SPEED = "1.3.6.1.2.1.2.2.1.5"
OID_IF_PHYS_ADDR = "1.3.6.1.2.1.2.2.1.6"
OID_IF_ADMIN_STATUS = "1.3.6.1.2.1.2.2.1.7"
OID_IF_OPER_STATUS = "1.3.6.1.2.1.2.2.1.8"
OID_IF_IN_ERRORS = "1.3.6.1.2.1.2.2.1.14"
OID_IF_OUT_ERRORS = "1.3.6.1.2.1.2.2.1.20"

OID_IF_NAME = "1.3.6.1.2.1.31.1.1.1.1"
OID_IF_HC_IN_OCTETS = "1.3.6.1.2.1.31.1.1.1.6"
OID_IF_HC_OUT_OCTETS = "1.3.6.1.2.1.31.1.1.1.10"
OID_IF_ALIAS = "1.3.6.1.2.1.31.1.1.1.18"

# 32-bit fallback counters
OID_IF_IN_OCTETS = "1.3.6.1.2.1.2.2.1.10"
OID_IF_OUT_OCTETS = "1.3.6.1.2.1.2.2.1.16"


def format_uptime(ticks: int) -> str:
    """Format timeticks (1/100 sec) to 'X วัน HH:MM:SS'"""
    total_seconds = int(ticks / 100)
    days = total_seconds // 86400
    hours = (total_seconds % 86400) // 3600
    mins = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{days} วัน {hours:02d}:{mins:02d}:{secs:02d}"


async def snmp_get_system_info(ip: str, community: str = "public", port: int = 161, timeout: float = 2.0) -> Dict[str, Any]:
    """
    Perform SNMP GET on sysDescr, sysName, sysUpTime
    Used for FR-1.2 Test Connection and device discovery
    """
    engine = SnmpEngine()
    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1)
        errorIndication, errorStatus, errorIndex, varBinds = await get_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_SYS_DESCR)),
            ObjectType(ObjectIdentity(OID_SYS_NAME)),
            ObjectType(ObjectIdentity(OID_SYS_UPTIME)),
        )

        if errorIndication:
            return {"ok": False, "error": str(errorIndication)}

        if errorStatus:
            return {"ok": False, "error": f"{errorStatus.prettyPrint()} at {errorIndex}"}

        res = {"ok": True}
        for varBind in varBinds:
            oid = str(varBind[0])
            val = str(varBind[1])
            if oid == OID_SYS_DESCR:
                res["descr"] = val
            elif oid == OID_SYS_NAME:
                res["name"] = val
            elif oid == OID_SYS_UPTIME:
                try:
                    res["uptime_ticks"] = int(varBind[1])
                    res["uptime"] = format_uptime(int(varBind[1]))
                except Exception:
                    res["uptime"] = val

        return res
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def snmp_set_admin_status(
    ip: str,
    community: str,
    if_index: int,
    status_code: int,  # 1 = up, 2 = down
    port: int = 161,
    timeout: float = 2.5
) -> Dict[str, Any]:
    """
    Send SNMP SET ifAdminStatus.<if_index> = 1 (up) or 2 (down)
    Then read back value to confirm status (PRD FR-3.2, FR-3.4)
    """
    engine = SnmpEngine()
    oid_target = f"{OID_IF_ADMIN_STATUS}.{if_index}"
    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1)
        errorIndication, errorStatus, errorIndex, varBinds = await set_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(oid_target), Integer32(status_code)),
        )

        if errorIndication:
            return {"ok": False, "error": f"SNMP Error: {errorIndication}"}

        if errorStatus:
            status_str = str(errorStatus.prettyPrint())
            if "noSuchName" in status_str or "notWritable" in status_str:
                return {"ok": False, "error": "SNMP SET ล้มเหลว: community เป็น read-only หรือ MIB ไม่อนุญาตแก้ไข"}
            return {"ok": False, "error": f"SNMP Error: {status_str}"}

        # Read back to verify
        read_error, _, _, read_vbs = await get_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(oid_target)),
            ObjectType(ObjectIdentity(f"{OID_IF_OPER_STATUS}.{if_index}")),
        )

        admin_res = "up" if status_code == 1 else "down"
        oper_res = admin_res
        if not read_error and read_vbs:
            try:
                verified_admin = int(read_vbs[0][1])
                admin_res = "up" if verified_admin == 1 else "down"
                if len(read_vbs) > 1:
                    verified_oper = int(read_vbs[1][1])
                    oper_res = "up" if verified_oper == 1 else "down"
            except Exception:
                pass

        return {
            "ok": True,
            "admin": admin_res,
            "oper": oper_res,
            "oid": oid_target,
            "value": status_code
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def snmp_walk_interfaces(
    ip: str,
    community: str = "public",
    port: int = 161,
    timeout: float = 3.0
) -> List[Dict[str, Any]]:
    """
    Walk ifTable & ifXTable to get list of interfaces (FR-2.1)
    """
    engine = SnmpEngine()
    interfaces = {}

    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1)

        # Walk ifDescr
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_DESCR)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                oid_str = str(vb[0])
                if_idx = int(oid_str.split(".")[-1])
                descr = str(vb[1])
                if if_idx not in interfaces:
                    interfaces[if_idx] = {
                        "idx": if_idx,
                        "name": descr,
                        "speed": 1000,
                        "admin": "up",
                        "oper": "up",
                        "errors": 0,
                        "mac": "",
                        "alias": "",
                        "virtual": "loopback" in descr.lower() or "null" in descr.lower() or "vlan" in descr.lower(),
                        "ip": "",
                    }

        # Walk ifAdminStatus
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_ADMIN_STATUS)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                oid_str = str(vb[0])
                if_idx = int(oid_str.split(".")[-1])
                if if_idx in interfaces:
                    try:
                        interfaces[if_idx]["admin"] = "up" if int(vb[1]) == 1 else "down"
                    except Exception:
                        pass

        # Walk ifOperStatus
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_OPER_STATUS)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                oid_str = str(vb[0])
                if_idx = int(oid_str.split(".")[-1])
                if if_idx in interfaces:
                    try:
                        interfaces[if_idx]["oper"] = "up" if int(vb[1]) == 1 else "down"
                    except Exception:
                        pass

        # Walk ifSpeed
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_SPEED)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                oid_str = str(vb[0])
                if_idx = int(oid_str.split(".")[-1])
                if if_idx in interfaces:
                    try:
                        raw_speed = int(vb[1])
                        interfaces[if_idx]["speed"] = max(10, raw_speed // 1000000)
                    except Exception:
                        pass

    except Exception as e:
        logger.warning(f"Interface walk failed for {ip}: {e}")

    return sorted(list(interfaces.values()), key=lambda x: x["idx"])


async def snmp_poll_octets(
    ip: str,
    community: str = "public",
    port: int = 161,
    if_indices: Optional[List[int]] = None
) -> Dict[int, Dict[str, int]]:
    """
    Poll 64-bit HC counters (or 32-bit fallback) for calculating bps (FR-4.3, FR-4.4)
    Returns: {if_index: {'in_octets': int, 'out_octets': int}}
    """
    engine = SnmpEngine()
    results = {}

    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=2.0, retries=1)

        # Walk ifHCInOctets
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_HC_IN_OCTETS)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                if_idx = int(str(vb[0]).split(".")[-1])
                if if_indices and if_idx not in if_indices:
                    continue
                try:
                    val = int(vb[1])
                    if if_idx not in results:
                        results[if_idx] = {}
                    results[if_idx]["in_octets"] = val
                except Exception:
                    pass

        # Walk ifHCOutOctets
        async for (errorIndication, errorStatus, _, varBinds) in next_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_HC_OUT_OCTETS)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                break
            for vb in varBinds:
                if_idx = int(str(vb[0]).split(".")[-1])
                if if_indices and if_idx not in if_indices:
                    continue
                try:
                    val = int(vb[1])
                    if if_idx not in results:
                        results[if_idx] = {}
                    results[if_idx]["out_octets"] = val
                except Exception:
                    pass

    except Exception as e:
        logger.warning(f"Octet poll failed for {ip}: {e}")

    return results
