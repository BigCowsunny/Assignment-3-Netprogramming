"""
SNMP Network Monitor - FastAPI Backend Server
REST API & WebSocket implementation conforming to PRD Specification
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database
from database import (
    init_db,
    get_all_devices,
    get_device,
    save_device,
    delete_device,
    update_interface_status,
    get_events,
    get_audit_logs,
    add_audit_log,
    get_traffic_history,
    get_aggregate_traffic,
    get_latest_traffic,
    get_db,
)
from snmp_engine import snmp_get_system_info, snmp_set_admin_status, snmp_walk_interfaces
from trap_receiver import start_trap_listener, ws_manager
from poller import run_poller_loop
from discovery import discover_network, discover_topology_links
from network_scanner import scan_network

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("main")

# Background tasks
_trap_transport = None
_poller_task = None
_trap_port: Optional[int] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _trap_transport, _poller_task, _trap_port
    logger.info("Initializing SQLite database...")
    init_db()

    logger.info("Starting SNMP Trap Receiver on UDP 162...")
    _trap_transport = await start_trap_listener(port=162)
    if _trap_transport:
        _trap_port = int(_trap_transport.get_extra_info("sockname")[1])

    logger.info("Starting Background SNMP Poller...")
    _poller_task = asyncio.create_task(run_poller_loop(poll_interval_seconds=60))

    yield

    logger.info("Shutting down background services...")
    if _trap_transport:
        _trap_transport.close()
    if _poller_task:
        _poller_task.cancel()


app = FastAPI(
    title="SNMP Network Monitor API",
    description="Backend API and Trap Receiver for Assignment 3 Network Programming",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Pydantic Request Models
class DeviceCreateRequest(BaseModel):
    name: Optional[str] = ""
    ip: str
    snmp_version: str = "v2c"
    community: str = "public"
    port: int = 161
    device_type: str = "switch"


class DeviceUpdateRequest(BaseModel):
    name: str
    ip: str
    snmp_version: str = "v2c"
    community: str = "public"
    port: int = 161
    device_type: str = "switch"
    vendor: Optional[str] = ""
    status: Optional[str] = "online"


class InterfaceAdminRequest(BaseModel):
    status: str  # "up" or "down"


class DiscoveryRequest(BaseModel):
    seed_ip: Optional[str] = ""
    community: str = "public"
    subnet: Optional[str] = ""


# ------------------ REST ENDPOINTS ------------------ #

@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "service": "SNMP Network Monitor Backend",
        "trap_port": _trap_port,
        "poller": "active",
        "timestamp": time.time()
    }


@app.get("/api/devices")
async def list_devices():
    """FR-1.5: List all devices with online/offline, uptime, port count"""
    return get_all_devices()


@app.post("/api/devices/test")
async def test_device_connection(req: DeviceCreateRequest):
    """
    FR-1.2: Test Connection via SNMP GET sysDescr
    Returns success with sysDescr or clear timeout message
    """
    res = await snmp_get_system_info(req.ip, req.community, req.port, timeout=2.0)
    if not res.get("ok"):
        return {
            "status": "err",
            "message": "การเชื่อมต่อล้มเหลว",
            "details": f"SNMP Timeout (2s) — ไม่มีอุปกรณ์ตอบกลับที่ {req.ip}:{req.port} · ตรวจสอบ IP และ Firewall UDP 161"
        }

    dev_name = req.name or res.get("name") or (f"SW-{req.ip.split('.')[-1]}" if req.device_type == "switch" else f"RTR-{req.ip.split('.')[-1]}")
    return {
        "status": "ok",
        "message": "เชื่อมต่อสำเร็จ · ได้ข้อมูล sysDescr",
        "details": f"sysName = {dev_name}\nsysDescr = {res.get('descr', 'Unknown')}\nsysUpTime = {res.get('uptime', '0 วัน 00:00:00')}"
    }


@app.post("/api/devices")
async def create_device(req: DeviceCreateRequest):
    """FR-1.1, FR-1.3: Add device, probe interfaces, and save to DB"""
    existing = get_device(req.ip)
    if existing:
        raise HTTPException(status_code=409, detail=f"อุปกรณ์ IP {req.ip} ถูกเพิ่มไว้แล้ว")

    probe = await snmp_get_system_info(req.ip, req.community, req.port, timeout=2.5)
    if not probe.get("ok"):
        raise HTTPException(status_code=422, detail=f"เชื่อมต่อ SNMP ไม่สำเร็จที่ {req.ip}:{req.port}: {probe.get('error', 'timeout')}")

    # Walk interfaces from device
    ports = await snmp_walk_interfaces(req.ip, req.community, req.port)
    if not ports:
        raise HTTPException(status_code=422, detail=f"SNMP ตอบกลับที่ {req.ip}:{req.port} แต่ดึง interface ไม่ได้ ตรวจสอบสิทธิ์ community และ IF-MIB")

    dev_id = f"d_{int(time.time()*1000)}"
    dev_name = req.name or probe.get("name") or f"Device-{req.ip}"
    vendor = "Cisco Device (SNMP)"
    if "c2960" in probe.get("descr", "").lower():
        vendor = "Cisco Catalyst 2960"
    elif "iosv" in probe.get("descr", "").lower():
        vendor = "Cisco IOSv · EVE-NG"
    elif "iol" in probe.get("descr", "").lower():
        vendor = "Cisco IOL L2 · EVE-NG"

    new_device = {
        "id": dev_id,
        "name": dev_name,
        "ip": req.ip,
        "ver": req.snmp_version,
        "community": req.community,
        "snmp_port": req.port,
        "type": req.device_type,
        "vendor": vendor,
        "descr": probe.get("descr", "SNMP Monitored Node"),
        "status": "online" if probe.get("ok") else "offline",
        "up": probe.get("uptime", "0 วัน 00:01:00"),
        "ports": ports
    }

    save_device(new_device)
    add_audit_log("admin", "เพิ่มอุปกรณ์", req.ip, "สำเร็จ")
    return new_device


@app.get("/api/devices/{device_id}")
async def get_single_device(device_id: str):
    dev = get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")
    return dev


@app.put("/api/devices/{device_id}")
async def update_single_device(device_id: str, req: DeviceUpdateRequest):
    """FR-1.4: Edit device"""
    dev = get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    probe = await snmp_get_system_info(req.ip, req.community, req.port, timeout=2.5)
    if not probe.get("ok"):
        raise HTTPException(status_code=422, detail=f"เชื่อมต่อ SNMP ไม่สำเร็จที่ {req.ip}:{req.port}: {probe.get('error', 'timeout')}")
    ports = await snmp_walk_interfaces(req.ip, req.community, req.port)
    if not ports:
        raise HTTPException(status_code=422, detail=f"SNMP ตอบกลับที่ {req.ip}:{req.port} แต่ดึง interface ไม่ได้")

    dev["name"] = req.name
    dev["ip"] = req.ip
    dev["snmp_version"] = req.snmp_version
    dev["ver"] = req.snmp_version
    dev["community"] = req.community
    dev["snmp_port"] = req.port
    dev["device_type"] = req.device_type
    dev["type"] = req.device_type
    dev["vendor"] = req.vendor or dev["vendor"]
    dev["status"] = req.status or dev["status"]
    dev["ports"] = ports
    dev["up"] = probe.get("uptime", dev.get("up", ""))
    dev["descr"] = probe.get("descr", dev.get("descr", ""))

    save_device(dev)
    add_audit_log("admin", f"แก้ไขอุปกรณ์ {req.name}", req.ip, "สำเร็จ")
    return dev


@app.delete("/api/devices/{device_id}")
async def remove_device(device_id: str):
    """FR-1.4: Delete device"""
    dev = get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    delete_device(device_id)
    add_audit_log("admin", f"ลบอุปกรณ์ {dev['name']}", dev["ip"], "สำเร็จ")
    return {"ok": True, "message": f"Deleted device {device_id}"}


@app.get("/api/devices/{device_id}/interfaces")
async def get_device_interfaces(device_id: str):
    """FR-2.1: Get interfaces for Port Panel view"""
    dev = get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")
    return dev.get("ports", [])


@app.post("/api/interfaces/{device_id}/{port_name}/admin-status")
async def set_port_admin_status(device_id: str, port_name: str, req: InterfaceAdminRequest):
    """
    FR-3.1, FR-3.2, FR-3.4:
    Interface Control: Send SNMP SET ifAdminStatus (1=up, 2=down)
    Read back verified status, log audit, and push update
    """
    dev = get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    port = next((p for p in dev.get("ports", []) if p["name"] == port_name), None)
    if not port:
        raise HTTPException(status_code=404, detail="Port not found")
    if req.status not in ("up", "down"):
        raise HTTPException(status_code=422, detail="status must be 'up' or 'down'")

    status_code = 1 if req.status == "up" else 2

    # Send real SNMP SET to device
    res = await snmp_set_admin_status(
        ip=dev["ip"],
        community=dev.get("community", "private"),
        if_index=port["idx"],
        status_code=status_code,
        port=dev.get("snmp_port", 161)
    )

    if not res.get("ok"):
        add_audit_log("admin", f"สั่ง {('Shutdown' if req.status == 'down' else 'No Shutdown')} {port_name}", dev["name"], "ล้มเหลว")
        return {"ok": False, "error": res.get("error", "SNMP SET failed"), "snmp_detail": res}

    # Persist only the state read back from the actual device.
    new_admin = res.get("admin", req.status)
    new_oper = res.get("oper", port["oper"])

    update_interface_status(device_id, port_name, admin=new_admin, oper=new_oper)
    add_audit_log("admin", f"สั่ง {('Shutdown' if req.status == 'down' else 'No Shutdown')} {port_name}", dev["name"], "สำเร็จ")

    # Broadcast status change to browsers
    await ws_manager.broadcast({
        "type": "PORT_STATUS_CHANGE",
        "device_id": device_id,
        "port_name": port_name,
        "admin": new_admin,
        "oper": new_oper
    })

    return {
        "ok": True,
        "device_id": device_id,
        "port_name": port_name,
        "admin": new_admin,
        "oper": new_oper,
        "snmp_detail": res
    }


@app.get("/api/interfaces/{device_id}/{port_name}/traffic")
async def get_port_traffic(device_id: str, port_name: str, range: str = Query("day")):
    """FR-4.1, FR-4.2: Traffic Graph series (live, day, week, month, year)"""
    return get_traffic_history(device_id, port_name, range)


@app.get("/api/traffic/aggregate")
async def get_traffic_aggregate(range: str = Query("day")):
    return get_aggregate_traffic(range)


@app.get("/api/traffic/latest")
async def get_latest_traffic_endpoint():
    return get_latest_traffic()


@app.get("/api/events")
async def list_events(device: Optional[str] = None, type: Optional[str] = None, limit: int = 80):
    """FR-5.4, FR-5.5: Event Log table from SNMP traps"""
    events = get_events(limit)
    if device and device != "all":
        events = [e for e in events if e["dev"] == device]
    if type and type != "all":
        events = [e for e in events if e["type"] == type]
    return events


@app.post("/api/events/test-trap")
async def trigger_test_trap():
    """Send a real SNMPv2c notification to the local UDP Trap Receiver."""
    if not _trap_port:
        return {"ok": False, "error": "SNMP Trap Receiver is not listening; check UDP 162/1162 availability."}
    from pysnmp.hlapi.v3arch.asyncio import (
        SnmpEngine, CommunityData, UdpTransportTarget, ContextData,
        NotificationType, ObjectIdentity, ObjectType, send_notification,
    )
    from pysnmp.proto.rfc1902 import Integer32, OctetString

    try:
        transport = await UdpTransportTarget.create(("127.0.0.1", _trap_port), timeout=2.0, retries=0)
        error_indication, error_status, _, _ = await send_notification(
            SnmpEngine(), CommunityData("public"), transport, ContextData(), "trap",
            NotificationType(ObjectIdentity("1.3.6.1.6.3.1.1.5.4")).add_varbinds(
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.1.1"), Integer32(1)),
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.7.1"), Integer32(1)),
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.8.1"), Integer32(1)),
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.2.1"), OctetString("TestInterface")),
            )
        )
        if error_indication:
            return {"ok": False, "error": str(error_indication)}
        if error_status:
            return {"ok": False, "error": error_status.prettyPrint()}
        return {"ok": True, "message": f"SNMP Trap sent to UDP 127.0.0.1:{_trap_port}; event will be logged only after receiver parses it."}
    except Exception as e:
        logger.exception("Failed to send test SNMP Trap")
        return {"ok": False, "error": str(e)}


@app.get("/api/audit-logs")
async def list_audit_logs():
    """FR-3.5: Audit log listing"""
    return get_audit_logs(40)


@app.get("/api/topology")
async def get_topology():
    """FR-6.4, FR-6.5: Topology Nodes & Links"""
    devices = get_all_devices()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM topology_links")
    links = [
        {"a": r["device_a"], "pa": r["port_a"], "b": r["device_b"], "pb": r["port_b"], "proto": r["protocol"]}
        for r in cursor.fetchall()
    ]
    conn.close()
    return {"devices": devices, "links": links}


@app.post("/api/discovery")
async def run_discovery_endpoint(req: DiscoveryRequest):
    """FR-6.1, FR-6.2: Auto Discovery via LLDP/CDP"""
    res = await discover_network(req.seed_ip or "", req.community, req.subnet or "")
    return res


class NetworkScanRequest(BaseModel):
    network: str = "192.168.1.0/24"
    communities: List[str] = ["public"]
    max_concurrent: int = 50


def _scanned_device_record(device: Dict[str, Any], index: int) -> Dict[str, Any]:
    """Normalize scanner results to the database's device shape."""
    ip = str(device.get("ip", "")).strip()
    name = str(device.get("name") or f"Device-{ip}")
    descr = str(device.get("descr") or "")
    device_type = str(device.get("type") or "router").lower()
    if device_type not in ("router", "switch"):
        device_type = "router"
    # Stable IDs prevent every scan from creating a duplicate device.
    safe_ip = "".join(ch if ch.isalnum() else "_" for ch in ip)
    device_id = f"scan_{safe_ip}"[:80] or f"scan_{index}"
    return {
        "id": device_id,
        "name": name,
        "ip": ip,
        "ver": "v2c",
        "community": device.get("community", "public"),
        "snmp_port": int(device.get("snmp_port", 161) or 161),
        "type": device_type,
        "vendor": device.get("vendor") or descr[:48] or "Network device",
        "descr": descr,
        "status": device.get("status", "online"),
        "up": device.get("up", "0 วัน 00:00:00"),
        "ports": device.get("ports", []),
    }


@app.post("/api/network/scan")
async def network_scan_endpoint(req: NetworkScanRequest):
    """Discover devices by SNMP GET and IF-MIB walk only."""
    logger.info(f"Network scan request: {req.network}")
    try:
        scanned = await scan_network(req.network, req.communities, req.max_concurrent)
        existing_by_ip = {d["ip"]: d for d in get_all_devices()}
        devices = []
        for index, result in enumerate(scanned, start=1):
            ip = result.get("ip", "")
            if not ip:
                continue
            community = result.get("community", req.communities[0] if req.communities else "public")
            if not result.get("ports"):
                continue
            if ip in existing_by_ip:
                record = {**existing_by_ip[ip], **_scanned_device_record(result, index), "id": existing_by_ip[ip]["id"]}
                save_device(record)
                devices.append(record)
                continue
            record = _scanned_device_record(result, index)
            save_device(record)
            devices.append(record)
        links = await discover_topology_links(get_all_devices())
        return {"ok": True, "devices": devices, "count": len(devices), "new_count": sum(1 for d in devices if d["ip"] not in existing_by_ip), "links": links}
    except Exception as e:
        logger.error(f"Network scan error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
# ------------------ WEBSOCKET ENDPOINT ------------------ #

@app.websocket("/ws/events")
async def websocket_events_endpoint(websocket: WebSocket):
    """
    FR-5.5, FR-5.6: WebSocket connection pushing real-time SNMP Traps and device status changes
    """
    await ws_manager.connect(websocket)
    logger.info("WebSocket client connected to live trap feed")
    try:
        while True:
            # Keep connection open, handle client ping/heartbeat
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
        logger.info("WebSocket client disconnected")
    except Exception:
        ws_manager.disconnect(websocket)
