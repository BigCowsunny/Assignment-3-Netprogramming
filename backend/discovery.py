"""Bounded SNMP neighbor discovery. Subnet is optional; links require port evidence."""
import asyncio
import ipaddress
from collections import deque
from pysnmp.hlapi.v3arch.asyncio import SnmpEngine, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity, walk_cmd
from pysnmp.proto.rfc1905 import NoSuchObject, NoSuchInstance, EndOfMibView
from database import get_all_devices, get_device, save_device, add_audit_log, get_topology_links, replace_topology_observations, record_discovered_neighbor, normalize_port_name, normalize_mac, management_ip
from snmp_engine import snmp_get_system_info, snmp_walk_interfaces
from network_scanner import scan_network, _device_type

OID_LLDP_REM_SYS_NAME = "1.0.8802.1.1.2.1.4.1.1.9"
OID_LLDP_REM_PORT_ID = "1.0.8802.1.1.2.1.4.1.1.7"
OID_LLDP_REM_CHASSIS_TYPE = "1.0.8802.1.1.2.1.4.1.1.4"
OID_LLDP_REM_CHASSIS_ID = "1.0.8802.1.1.2.1.4.1.1.5"
OID_LLDP_REM_PORT_TYPE = "1.0.8802.1.1.2.1.4.1.1.6"
OID_LLDP_REM_PORT_DESC = "1.0.8802.1.1.2.1.4.1.1.8"
OID_LLDP_REM_SYS_DESC = "1.0.8802.1.1.2.1.4.1.1.10"
OID_LLDP_REM_MAN_ADDR = "1.0.8802.1.1.2.1.4.2.1.3"
OID_LLDP_LOC_PORT_ID = "1.0.8802.1.1.2.1.3.7.1.3"
OID_LLDP_LOC_PORT_TYPE = "1.0.8802.1.1.2.1.3.7.1.2"
OID_LLDP_LOC_PORT_DESC = "1.0.8802.1.1.2.1.3.7.1.4"
OID_CDP_CACHE_DEVICE_ID = "1.3.6.1.4.1.9.9.23.1.2.1.1.6"
OID_CDP_CACHE_DEVICE_PORT = "1.3.6.1.4.1.9.9.23.1.2.1.1.7"
OID_CDP_CACHE_IFINDEX = "1.3.6.1.4.1.9.9.23.1.2.1.1.1"
OID_CDP_CACHE_ADDRESS = "1.3.6.1.4.1.9.9.23.1.2.1.1.4"
OID_CDP_CACHE_PLATFORM = "1.3.6.1.4.1.9.9.23.1.2.1.1.8"
OID_CDP_CACHE_CAPABILITIES = "1.3.6.1.4.1.9.9.23.1.2.1.1.9"

class WalkRows(list):
    def __init__(self):
        super().__init__()
        self.ok, self.error, self.supported = True, "", True

async def _walk_column(ip, community, oid, port=161, raw=False):
    engine, rows = SnmpEngine(), WalkRows()
    try:
        transport = await UdpTransportTarget.create((ip, port), timeout=1.5, retries=0)
        async for error, status, _, var_binds in walk_cmd(engine, CommunityData(community), transport, ContextData(), ObjectType(ObjectIdentity(oid)), lexicographicMode=False):
            if error or status:
                rows.ok, rows.error = False, str(error or status)
                break
            for name, value in var_binds:
                if isinstance(value, (NoSuchObject, NoSuchInstance, EndOfMibView)):
                    rows.supported = False
                    continue
                rows.append((str(name), bytes(value.asOctets()) if raw and hasattr(value, "asOctets") else str(value)))
    except Exception as error:
        rows.ok, rows.error = False, str(error)
    finally:
        engine.close_dispatcher()
    return rows

def _text(value):
    return value.decode("utf-8", errors="replace").strip("\x00 ")[:512] if isinstance(value, bytes) else str(value or "").strip()[:512]

def _number(value, default=0):
    try: return int(value)
    except (ValueError, TypeError): return default

def _column(rows, oid):
    return {name[len(oid) + 1:]: value for name, value in rows if name.startswith(oid + ".")}

def resolve_port(device, identifier, subtype=5, description=""):
    identifier, description = _text(identifier), _text(description)
    for port in device.get("ports", []):
        names = {normalize_port_name(port["name"]).lower()}
        if port.get("alias"): names.add(str(port["alias"]).lower())
        if normalize_port_name(identifier).lower() in names or normalize_port_name(description).lower() in names:
            return port["name"]
        if subtype == 3 and normalize_mac(identifier) and normalize_mac(port.get("mac", "")) == normalize_mac(identifier):
            return port["name"]
    return ""

async def read_neighbors(device):
    specs = {
        "cdp_names": (OID_CDP_CACHE_DEVICE_ID, False), "cdp_ports": (OID_CDP_CACHE_DEVICE_PORT, False),
        "cdp_ips": (OID_CDP_CACHE_ADDRESS, True), "cdp_models": (OID_CDP_CACHE_PLATFORM, False),
        "cdp_caps": (OID_CDP_CACHE_CAPABILITIES, True),
        "lldp_names": (OID_LLDP_REM_SYS_NAME, False), "lldp_ports": (OID_LLDP_REM_PORT_ID, True),
        "lldp_chassis": (OID_LLDP_REM_CHASSIS_ID, True), "lldp_chassis_type": (OID_LLDP_REM_CHASSIS_TYPE, False),
        "lldp_port_type": (OID_LLDP_REM_PORT_TYPE, False), "lldp_port_desc": (OID_LLDP_REM_PORT_DESC, False),
        "lldp_desc": (OID_LLDP_REM_SYS_DESC, False), "lldp_ips": (OID_LLDP_REM_MAN_ADDR, False),
        "local_ids": (OID_LLDP_LOC_PORT_ID, True), "local_types": (OID_LLDP_LOC_PORT_TYPE, False),
        "local_desc": (OID_LLDP_LOC_PORT_DESC, False),
    }
    semaphore = asyncio.Semaphore(3)
    async def read(oid, raw):
        async with semaphore:
            return await _walk_column(device["ip"], device["community"], oid, device.get("snmp_port", 161), raw=raw)
    values = await asyncio.gather(*(read(*spec) for spec in specs.values()))
    walks = dict(zip(specs, values))
    columns = {key: _column(walks[key], oid) for key, (oid, _) in specs.items()}
    groups = []
    for protocol, essentials in (("CDP", ("cdp_names", "cdp_ports")), ("LLDP", ("lldp_chassis", "lldp_ports", "lldp_names", "local_ids"))):
        complete = all(getattr(walks[key], "ok", True) for key in essentials)
        groups.append({"protocol": protocol, "complete": complete, "neighbors": [], "links": []})
    cdp, lldp = groups
    ports_by_index = {int(port["idx"]): port["name"] for port in device.get("ports", [])}
    for suffix, name in columns["cdp_names"].items():
        remote_port = columns["cdp_ports"].get(suffix)
        if not _text(name) or not remote_port: continue
        local = ports_by_index.get(_number(suffix.split(".")[0]), "")
        address = columns["cdp_ips"].get(suffix, b"")
        remote_ip = management_ip(str(ipaddress.IPv4Address(address))) if isinstance(address, bytes) and len(address) == 4 else management_ip(address)
        cap = columns["cdp_caps"].get(suffix, b"")
        flags = int.from_bytes(cap, "big") if isinstance(cap, bytes) else _number(cap)
        cdp["neighbors"].append({"identity": _text(name), "name": _text(name), "port": _text(remote_port),
            "management_ip": remote_ip, "protocol": "CDP", "ttl": 180,
            "platform": _text(columns["cdp_models"].get(suffix, "")), "device_type": "switch" if flags & 8 else "router",
            "observer_id": device["id"], "local_port": local})
    management = {}
    for suffix in columns["lldp_ips"]:
        parts = suffix.split(".")
        if len(parts) == 9 and parts[3:5] == ["1", "4"]:
            ip = management_ip(".".join(parts[5:9]))
            if ip: management[".".join(parts[:3])] = ip
    for suffix in columns["lldp_chassis"].keys() | columns["lldp_names"].keys():
        parts = suffix.split(".")
        if len(parts) != 3: continue
        raw_chassis = columns["lldp_chassis"].get(suffix, b"")
        chassis_type = _number(columns["lldp_chassis_type"].get(suffix))
        chassis_data = raw_chassis if isinstance(raw_chassis, bytes) else _text(raw_chassis).encode()
        chassis_id = f"{chassis_type}:{chassis_data.hex()}" if chassis_data else ""
        chassis_mac = chassis_data.hex(":") if chassis_type == 4 and len(chassis_data) == 6 else ""
        name = _text(columns["lldp_names"].get(suffix)) or chassis_mac or chassis_id
        raw_port = columns["lldp_ports"].get(suffix, b"")
        subtype = _number(columns["lldp_port_type"].get(suffix), 5)
        port_id = raw_port.hex(":") if subtype == 3 and isinstance(raw_port, bytes) else _text(raw_port)
        desc = _text(columns["lldp_port_desc"].get(suffix))
        port_name = port_id if subtype == 5 else desc or port_id
        local_num = parts[1]
        raw_local = columns["local_ids"].get(local_num, b"")
        local_type = _number(columns["local_types"].get(local_num), 5)
        local_id = raw_local.hex(":") if local_type == 3 and isinstance(raw_local, bytes) else _text(raw_local)
        local = resolve_port(device, local_id, local_type, columns["local_desc"].get(local_num, ""))
        if not name or not port_name: continue
        lldp["neighbors"].append({"identity": name, "name": name, "port": port_name,
            "port_id": port_id, "port_subtype": subtype, "port_description": desc,
            "chassis_id": chassis_id, "chassis_mac": chassis_mac, "management_ip": management.get(suffix, ""),
            "protocol": "LLDP", "ttl": 180, "device_type": _device_type(_text(columns["lldp_desc"].get(suffix))),
            "description": _text(columns["lldp_desc"].get(suffix)), "observer_id": device["id"], "local_port": local})
    return groups

def persist_neighbors(device, groups):
    found, issues = [], []
    for group in groups:
        protocol, links = group["protocol"], []
        if not group["complete"]:
            issues.append({"ip": device["ip"], "name": device["name"], "code": "neighbor_timeout", "message": f"อ่าน {protocol} neighbor table ไม่ครบ; เก็บสายเดิมจน TTL หมด"})
        for neighbor in group["neighbors"]:
            remote, _ = record_discovered_neighbor(neighbor)
            found.append(remote)
            local = neighbor["local_port"]
            if not local:
                issues.append({"ip": device["ip"], "name": device["name"], "code": "port_unresolved", "message": f"{protocol}: พบ {remote['name']} แต่จับคู่ local port กับ IF-MIB ไม่ได้"})
                group["complete"] = False
                continue
            if remote["id"] == device["id"]: continue
            remote_port = resolve_port(remote, neighbor.get("port_id", neighbor["port"]), neighbor.get("port_subtype", 5), neighbor.get("port_description", "")) or normalize_port_name(neighbor["port"])
            links.append({"a": device["id"], "pa": local, "b": remote["id"], "pb": remote_port, "proto": protocol})
        group["links"] = links
        if group["complete"]:
            replace_topology_observations(device["id"], protocol, links)
    return found, issues

async def discover_topology_links(devices):
    for device in devices:
        if device.get("discovery_only") or not management_ip(device.get("ip", "")) or not device.get("community"):
            continue
        persist_neighbors(device, await read_neighbors(device))
    return get_topology_links()

async def query_lldp_neighbors(ip, community="public", port=161):
    return [{"name": _text(value), "protocol": "LLDP"} for _, value in await _walk_column(ip, community, OID_LLDP_REM_SYS_NAME, port)]

async def query_cdp_neighbors(ip, community="public", port=161):
    return [{"name": _text(value), "protocol": "CDP"} for _, value in await _walk_column(ip, community, OID_CDP_CACHE_DEVICE_ID, port)]

def validate_target(seed_ip="", subnet=""):
    if seed_ip and not management_ip(seed_ip):
        raise ValueError("Seed ต้องเป็น IPv4 ที่ใช้งานได้")
    if subnet:
        network = ipaddress.ip_network(subnet, strict=False)
        if network.version != 4 or network.num_addresses > 4096:
            raise ValueError("Subnet ต้องเป็น IPv4 และไม่เกิน 4096 addresses")

async def discover_network(seed_ip="", community="", subnet="", *, communities=None, max_devices=64, max_depth=8, progress=None):
    validate_target(seed_ip, subnet)
    credentials = list(dict.fromkeys(value.strip() for value in ([community] + (communities or [])) if value.strip()))
    if len(credentials) > 8: raise ValueError("ใช้ SNMP communities ได้ไม่เกิน 8 รายการ")
    if not credentials:
        credentials = list(dict.fromkeys(device["community"] for device in get_all_devices()
                                        if not device.get("discovery_only") and device.get("community")))[:8]
    max_devices, max_depth = max(1, min(max_devices, 256)), max(0, min(max_depth, 16))
    before = {device["id"] for device in get_all_devices()}
    queue, queued, visited, issues = deque(), set(), set(), []
    checked = 0
    async def report(phase, current_ip="", current_name=""):
        if progress:
            await progress({"phase": phase, "current_ip": current_ip, "current_name": current_name, "checked": checked, "queued": len(queue), "issues": issues[-30:], "devices_count": len(get_all_devices()), "links_count": len(get_topology_links())})
    def enqueue(ip, depth=0, preferred="", device_id=""):
        ip = management_ip(ip)
        if ip and ip not in queued and len(queued) >= max_devices:
            issues.append({"ip": ip, "code": "device_limit", "message": f"ถึงขีดจำกัด {max_devices} อุปกรณ์ต่อรอบแล้ว; เก็บ node ไว้"})
        if ip and ip not in queued and len(queued) < max_devices and depth <= max_depth:
            queued.add(ip)
            queue.append((ip, depth, preferred, device_id))
    for device in get_all_devices():
        if not device.get("ip"):
            issues.append({"name": device["name"], "ip": "", "code": "no_ip", "message": "ไม่มี Management IP; แสดง node ได้ แต่ค้นต่อผ่าน SNMP ไม่ได้"})
        elif not device.get("discovery_only") or device.get("status") == "discovered":
            enqueue(device["ip"], preferred=device.get("community", ""), device_id=device["id"])
    if seed_ip:
        # Explicit seed gets the first bounded slot even when inventory is already full.
        while len(queue) >= max_devices and seed_ip not in queued:
            dropped = queue.pop()
            queued.discard(dropped[0])
        if seed_ip not in queued: queued.add(seed_ip)
        queue = deque([(seed_ip, 0, "", "")] + [item for item in queue if item[0] != seed_ip])
    if subnet:
        if not credentials:
            issues.append({"ip": subnet, "code": "missing_credentials", "message": "ไม่ได้ระบุ SNMP community จึงข้าม subnet scan"})
        else:
            await report("scanning")
            for candidate in await scan_network(subnet, credentials, max_concurrent=10):
                enqueue(candidate["ip"], preferred=candidate.get("community", ""))
    if not queue:
        issues.append({"ip": "", "code": "no_seed", "message": "ยังไม่มี IP เริ่มต้น; รอ CDP/LLDP หรือใส่ IP ของอุปกรณ์หนึ่งตัว"})
    while queue and checked < max_devices:
        ip, depth, preferred, hint_id = queue.popleft()
        if ip in visited: continue
        visited.add(ip)
        device = get_device(hint_id) if hint_id else get_device(ip)
        choices = list(dict.fromkeys(value for value in [preferred, (device or {}).get("community", ""), *credentials] if value))
        if not choices:
            issues.append({"ip": ip, "name": (device or {}).get("name", ip), "code": "missing_credentials", "message": "ยังไม่มี SNMP community; คงอุปกรณ์ที่พบผ่าน CDP/LLDP ไว้"})
            checked += 1
            await report("probing", ip, (device or {}).get("name", ""))
            continue
        await report("probing", ip, (device or {}).get("name", ""))
        probe, selected = {}, ""
        port = (device or {}).get("snmp_port", 161)
        for candidate in choices:
            probe = await snmp_get_system_info(ip, candidate, port, timeout=1.5)
            if probe.get("ok"):
                selected = candidate
                break
        checked += 1
        if not selected:
            issues.append({"ip": ip, "name": (device or {}).get("name", ip), "code": "snmp_timeout", "message": "SNMP ไม่ตอบ; ตรวจ community, IP, interface และ UDP 161"})
            await report("probing", ip)
            continue
        await report("reading_interfaces", ip)
        ports = await snmp_walk_interfaces(ip, selected, port)
        if not ports:
            issues.append({"ip": ip, "code": "interfaces_unavailable", "message": "SNMP ตอบแต่ IF-MIB อ่านพอร์ตไม่ได้"})
            continue
        description = probe.get("descr", "")
        saved = {**(device or {}), "id": (device or {}).get("id") or "discovery_" + ip.replace(".", "_"), "ip": ip, "name": probe.get("name") or (device or {}).get("name") or ip, "ver": "v2c", "community": selected, "snmp_port": port, "type": _device_type(description), "descr": description, "vendor": description[:48], "status": "online", "up": probe.get("uptime", ""), "ports": ports}
        save_device(saved)
        device = get_device(saved["id"])
        await report("reading_neighbors", ip, device["name"])
        neighbors, warnings = persist_neighbors(device, await read_neighbors(device))
        issues.extend(warnings)
        for neighbor in neighbors:
            if neighbor.get("ip"):
                if depth >= max_depth and neighbor["ip"] not in visited:
                    issues.append({"ip": neighbor["ip"], "code": "depth_limit", "message": "ถึงจำนวน hop สูงสุดแล้ว; เก็บ node ไว้"})
                enqueue(neighbor["ip"], depth + 1, selected, neighbor["id"])
            else:
                issues.append({"ip": "", "name": neighbor["name"], "code": "no_ip", "message": "พบ neighbor ไม่มี IP; แสดง node/สายจากตารางได้ แต่ Config และค้นต่อไม่ได้"})
        await report("reading_neighbors", ip, device["name"])
    if queue:
        issues.append({"ip": "", "code": "device_limit", "message": f"ถึงขีดจำกัด {max_devices} อุปกรณ์ต่อรอบแล้ว"})
    devices, links = get_all_devices(), get_topology_links()
    await report("completed")
    add_audit_log("admin", "Auto Discovery (CDP/LLDP/SNMP)", subnet or seed_ip or "Auto seeds", f"พบ {len(devices)} nodes, {len(links)} links")
    return {"ok": True, "devices": devices, "links": links, "issues": issues, "new_devices_count": sum(device["id"] not in before for device in devices), "checked": checked, "visited_ips": sorted(visited), "devices_count": len(devices), "links_count": len(links)}
