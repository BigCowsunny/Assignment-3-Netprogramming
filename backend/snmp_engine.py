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
    walk_cmd,
    bulk_cmd,
)
from pysnmp.proto.rfc1902 import Integer32, OctetString
from pysnmp.proto.rfc1905 import NoSuchObject, NoSuchInstance, EndOfMibView

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
OID_IF_HIGH_SPEED = "1.3.6.1.2.1.31.1.1.1.15"
OID_IF_DISCONTINUITY = "1.3.6.1.2.1.31.1.1.1.19"
OID_IP_IFINDEX = "1.3.6.1.2.1.4.20.1.2"
MISSING_VALUES = (NoSuchObject, NoSuchInstance, EndOfMibView)


class InterfaceRows(list):
    """Distinguish a complete IF-MIB snapshot from a partial failed walk."""
    def __init__(self, values=(), complete=True):
        super().__init__(values)
        self.complete = complete

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
            if isinstance(varBind[1], MISSING_VALUES):
                continue
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

        if not any(key in res for key in ("descr", "name", "uptime_ticks")):
            return {"ok": False, "error": "SNMP ตอบกลับแต่ไม่อนุญาตให้อ่าน system MIB", "error_code": "system_unavailable"}
        return res
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        engine.close_dispatcher()


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
            if status_str in ("noAccess", "authorizationError"):
                return {
                    "ok": False,
                    "error_code": status_str,
                    "error": f"อุปกรณ์ปฏิเสธสิทธิ์เขียน SNMP ({status_str}) ตรวจสอบว่า Community ที่บันทึกในโปรแกรมตรงกับ RW ของอุปกรณ์ และ ACL/SNMP View อนุญาตให้เครื่องนี้แก้ไข ifAdminStatus",
                }
            if status_str in ("noSuchName", "notWritable", "noCreation"):
                return {
                    "ok": False,
                    "error_code": status_str,
                    "error": f"อุปกรณ์ไม่อนุญาตแก้ไขพอร์ตผ่าน SNMP ({status_str}) ตรวจสอบ ifIndex, สิทธิ์ RW และการรองรับ ifAdminStatus ของอุปกรณ์",
                }
            return {"ok": False, "error_code": status_str, "error": f"SNMP Error: {status_str}"}

        # Read back to verify
        read_error, read_status, read_index, read_vbs = await get_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(oid_target)),
        )
        if read_error:
            return {"ok": False, "error": f"ส่ง SNMP SET แล้ว แต่อ่าน ifAdminStatus กลับมาตรวจไม่ได้: {read_error}"}
        if read_status:
            return {"ok": False, "error": f"อ่าน ifAdminStatus กลับมาตรวจไม่ได้: {read_status.prettyPrint()} at {read_index}"}
        if not read_vbs:
            return {"ok": False, "error": "อุปกรณ์ไม่ส่งค่า ifAdminStatus กลับมาตรวจ"}

        verified_admin = int(read_vbs[0][1])
        admin_res = "up" if verified_admin == 1 else "down"
        expected_admin = "up" if status_code == 1 else "down"
        if verified_admin != status_code:
            return {"ok": False, "error": f"อุปกรณ์ยังรายงาน ifAdminStatus={admin_res} หลังสั่ง {expected_admin}"}

        oper_res = None
        oper_error, oper_status_error, _, oper_vbs = await get_cmd(
            engine, CommunityData(community), transport, ContextData(),
            ObjectType(ObjectIdentity(f"{OID_IF_OPER_STATUS}.{if_index}")),
        )
        if not oper_error and not oper_status_error and oper_vbs:
            try:
                oper_res = "up" if int(oper_vbs[0][1]) == 1 else "down"
            except Exception:
                pass

        return {
            "ok": True,
            "admin": admin_res,
            **({"oper": oper_res} if oper_res else {}),
            "oid": oid_target,
            "value": status_code
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        engine.close_dispatcher()


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
    complete = True

    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=timeout, retries=1)

        # Walk ifDescr
        async for (errorIndication, errorStatus, _, varBinds) in walk_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_DESCR)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                complete = False
                break
            for vb in varBinds:
                oid_str = str(vb[0])
                if_idx = int(oid_str.split(".")[-1])
                descr = str(vb[1])
                if if_idx not in interfaces:
                    interfaces[if_idx] = {
                        "idx": if_idx,
                        "name": descr,
                        "speed": 0,
                        "admin": "unknown",
                        "oper": "unknown",
                        "errors": 0,
                        "mac": "",
                        "alias": "",
                        "virtual": "loopback" in descr.lower() or "null" in descr.lower() or "vlan" in descr.lower(),
                        "ip": "",
                    }

        # Walk ifAdminStatus
        async for (errorIndication, errorStatus, _, varBinds) in walk_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_ADMIN_STATUS)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                complete = False
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
        async for (errorIndication, errorStatus, _, varBinds) in walk_cmd(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(OID_IF_OPER_STATUS)),
            lexicographicMode=False,
        ):
            if errorIndication or errorStatus:
                complete = False
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
        async for (errorIndication, errorStatus, _, varBinds) in walk_cmd(
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
                        interfaces[if_idx]["speed"] = raw_speed / 1000000
                    except Exception:
                        pass

        # Supplement ifDescr with ifName, ifAlias, physical address, and errors.
        # Some agents do not implement every optional IF-MIB column, so a
        # failed walk should leave the successfully read columns intact.
        optional_columns = (
            (OID_IF_NAME, "name"),
            (OID_IF_ALIAS, "alias"),
            (OID_IF_PHYS_ADDR, "mac"),
            (OID_IF_IN_ERRORS, "in_errors"),
            (OID_IF_OUT_ERRORS, "out_errors"),
            (OID_IF_HIGH_SPEED, "high_speed"),
        )
        for base_oid, field in optional_columns:
            try:
                async for (errorIndication, errorStatus, _, varBinds) in walk_cmd(
                    engine,
                    CommunityData(community),
                    transport,
                    ContextData(),
                    ObjectType(ObjectIdentity(base_oid)),
                    lexicographicMode=False,
                ):
                    if errorIndication or errorStatus:
                        break
                    for vb in varBinds:
                        if_idx = int(str(vb[0]).split(".")[-1])
                        if if_idx not in interfaces:
                            continue
                        value = vb[1]
                        if isinstance(value, MISSING_VALUES):
                            continue
                        if field == "mac":
                            try:
                                raw_mac = bytes(value)
                                interfaces[if_idx][field] = ":".join(f"{octet:02x}" for octet in raw_mac)
                            except Exception:
                                interfaces[if_idx][field] = str(value)
                        elif field in ("in_errors", "out_errors", "high_speed"):
                            try:
                                interfaces[if_idx][field] = int(value)
                            except Exception:
                                pass
                        else:
                            text_value = str(value).strip()
                            if text_value:
                                interfaces[if_idx][field] = text_value
            except Exception as column_error:
                logger.debug(f"Optional interface column {base_oid} unavailable on {ip}: {column_error}")

        # IPv4 addresses can identify a trap sent from a different router interface.
        async for error, status, _, values in walk_cmd(
            engine, CommunityData(community), transport, ContextData(),
            ObjectType(ObjectIdentity(OID_IP_IFINDEX)), lexicographicMode=False,
        ):
            if error or status:
                break
            for oid, value in values:
                if isinstance(value, MISSING_VALUES):
                    continue
                index = int(value)
                if index in interfaces and str(oid).startswith(OID_IP_IFINDEX + "."):
                    interfaces[index]["ip"] = str(oid)[len(OID_IP_IFINDEX) + 1:]

        for interface in interfaces.values():
            high_speed = interface.pop("high_speed", 0)
            if high_speed > 0:
                interface["speed"] = high_speed
            if interface.get("name"):
                interface["alias"] = interface.get("alias") or interface["name"]
            interface["errors"] = interface.pop("in_errors", 0) + interface.pop("out_errors", 0)
            name_lower = interface["name"].lower()
            interface["virtual"] = interface["virtual"] or any(token in name_lower for token in ("loopback", "null", "vlan", "tunnel"))

    except Exception as e:
        logger.warning(f"Interface walk failed for {ip}: {e}")
        complete = False
    finally:
        engine.close_dispatcher()

    complete = complete and all(p["admin"] != "unknown" and p["oper"] != "unknown" for p in interfaces.values())
    return InterfaceRows(sorted(interfaces.values(), key=lambda x: x["idx"]), complete=complete)


async def snmp_poll_octets(
    ip: str, community: str = "public", port: int = 161,
    if_indices: Optional[List[int]] = None,
) -> Dict[int, Dict[str, int]]:
    """Read counters with their actual width and discontinuity marker."""
    if if_indices == []:
        return {}
    engine, results = SnmpEngine(), {}
    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=2.0, retries=1)

        async def column(oid, field, bits=None):
            async for error, status, _, values in walk_cmd(
                engine, CommunityData(community), transport, ContextData(),
                ObjectType(ObjectIdentity(oid)), lexicographicMode=False,
            ):
                if error or status:
                    break
                for name, value in values:
                    if not str(name).startswith(oid + ".") or isinstance(value, MISSING_VALUES):
                        continue
                    idx = int(str(name).split(".")[-1])
                    if if_indices is not None and idx not in if_indices:
                        continue
                    try:
                        number = int(value)
                    except (ValueError, TypeError):
                        continue
                    sample = results.setdefault(idx, {})
                    if field not in sample:
                        sample[field] = number
                        if bits:
                            sample[field + "_bits"] = bits

        for field, high, low in (
            ("in_octets", OID_IF_HC_IN_OCTETS, OID_IF_IN_OCTETS),
            ("out_octets", OID_IF_HC_OUT_OCTETS, OID_IF_OUT_OCTETS),
        ):
            await column(high, field, 64)
            if if_indices is None or any(field not in results.get(idx, {}) for idx in if_indices):
                await column(low, field, 32)
        await column(OID_IF_DISCONTINUITY, "discontinuity")
    except Exception as error:
        logger.warning("Octet poll failed for %s: %s", ip, error)
    finally:
        engine.close_dispatcher()
    return results
