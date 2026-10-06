"""
SNMP Network Monitor - FastAPI Backend Server
REST API & WebSocket implementation conforming to PRD Specification
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any, Literal

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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
from poller import run_poller_loop, configure_poll_interval, get_runtime_poll_interval
from cdp_receiver import cdp_capture
from discovery_jobs import discovery_jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("main")

# Background tasks
_trap_transport = None
_poller_task = None
_topology_task = None
_trap_port: Optional[int] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _trap_transport, _poller_task, _trap_port, _topology_task
    logger.info("Initializing SQLite database...")
    init_db()
    await cdp_capture.start()

    logger.info("Starting SNMP Trap Receiver on UDP 162...")
    _trap_transport = await start_trap_listener(port=162)
    if _trap_transport:
        _trap_port = int(_trap_transport.get_extra_info("sockname")[1])

    logger.info("Starting Background SNMP Poller...")
    configure_poll_interval(database.get_poll_interval())
    _poller_task = asyncio.create_task(run_poller_loop(poll_interval_seconds=get_runtime_poll_interval()))
    _topology_task = asyncio.create_task(discovery_jobs.periodic())

    yield

    logger.info("Shutting down background services...")
    await cdp_capture.stop()
    if _topology_task:
        _topology_task.cancel()
        await asyncio.gather(_topology_task, return_exceptions=True)
    await discovery_jobs.stop()
    if _trap_transport:
        _trap_transport.close()
    if _poller_task:
        _poller_task.cancel()
        await asyncio.gather(_poller_task, return_exceptions=True)


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
    snmp_version: Literal["v2c"] = "v2c"
    community: str = Field(default="public", min_length=1)
    port: int = Field(default=161, ge=1, le=65535)
    device_type: str = "switch"


class DeviceUpdateRequest(BaseModel):
    name: str
    ip: str
    snmp_version: Literal["v2c"] = "v2c"
    community: str = Field(default="public", min_length=1)
    port: int = Field(default=161, ge=1, le=65535)
    device_type: str = "switch"
    vendor: Optional[str] = ""
    status: Optional[str] = "online"


class InterfaceAdminRequest(BaseModel):
    status: str  # "up" or "down"


class PollingSettingsRequest(BaseModel):
    poll_interval: int = Field(strict=True, ge=10, le=3600)


class DiscoveryRequest(BaseModel):
    seed_ip: Optional[str] = ""
    community: str = ""
    subnet: Optional[str] = ""
    communities: List[str] = Field(default_factory=list, max_length=8)
    max_devices: int = Field(default=64, ge=1, le=256)
    max_depth: int = Field(default=8, ge=0, le=16)


# ------------------ REST ENDPOINTS ------------------ #

@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "service": "SNMP Network Monitor Backend",
        "trap_port": _trap_port,
        "poller": "active" if _poller_task and not _poller_task.done() else "inactive",
        "poll_interval": get_runtime_poll_interval(),
        "cdp": cdp_capture.health(),
        "timestamp": time.time()
    }


@app.get("/api/settings/polling")
async def get_polling_settings():
    return {"poll_interval": get_runtime_poll_interval(), "min_seconds": 10, "max_seconds": 3600}


@app.put("/api/settings/polling")
async def update_polling_settings(req: PollingSettingsRequest):
    previous = get_runtime_poll_interval()
    database.save_poll_interval(req.poll_interval)
    configure_poll_interval(req.poll_interval)
    if previous != req.poll_interval:
        add_audit_log("admin", "ปรับรอบการอ่านข้อมูล SNMP", f"{previous} → {req.poll_interval} วินาที", "สำเร็จ")
    return {"poll_interval": get_runtime_poll_interval(), "min_seconds": 10, "max_seconds": 3600}


@app.get("/api/discovery/cdp/status")
async def cdp_discovery_status():
    return cdp_capture.health()


@app.post("/api/discovery/cdp/start")
async def start_cdp_discovery():
    await cdp_capture.start()
    return cdp_capture.health()


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
    if not database.management_ip(req.ip):
        raise HTTPException(status_code=422, detail="กรุณาระบุ Management IP ที่ใช้งานได้ก่อนเชื่อมต่อ SNMP")
    res = await snmp_get_system_info(req.ip, req.community, req.port, timeout=2.0)
    if not res.get("ok"):
        return {
            "status": "err",
            "message": "การเชื่อมต่อล้มเหลว",
            "details": f"{req.ip}:{req.port} · {res.get('error', 'SNMP ไม่ตอบกลับ')} · ตรวจสอบ Community, SNMP View และ Firewall UDP {req.port}"
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
    if not database.management_ip(req.ip):
        raise HTTPException(status_code=422, detail="กรุณาระบุ Management IP ที่ใช้งานได้ก่อนเชื่อมต่อ SNMP")
    existing = get_device(req.ip)
    if existing and not existing.get("discovery_only"):
        raise HTTPException(status_code=409, detail=f"อุปกรณ์ IP {req.ip} ถูกเพิ่มไว้แล้ว")

    probe = await snmp_get_system_info(req.ip, req.community, req.port, timeout=2.5)
    if not probe.get("ok"):
        raise HTTPException(status_code=422, detail=f"เชื่อมต่อ SNMP ไม่สำเร็จที่ {req.ip}:{req.port}: {probe.get('error', 'timeout')}")

    # Walk interfaces from device
    ports = await snmp_walk_interfaces(req.ip, req.community, req.port)
    if not ports or not getattr(ports, "complete", True):
        raise HTTPException(status_code=422, detail=f"SNMP ตอบกลับที่ {req.ip}:{req.port} แต่ดึง interface ไม่ได้ ตรวจสอบสิทธิ์ community และ IF-MIB")

    dev_id = existing["id"] if existing else f"d_{int(time.time()*1000)}"
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
    return get_device(dev_id)


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
    if not database.management_ip(req.ip):
        raise HTTPException(status_code=422, detail="กรุณาระบุ Management IP ที่ใช้งานได้ก่อนเชื่อมต่อ SNMP")
    existing = get_device(req.ip)
    if existing and existing["id"] != device_id and not existing.get("discovery_only"):
        raise HTTPException(status_code=409, detail="Management IP นี้ถูกใช้กับอุปกรณ์อื่นแล้ว")

    probe = await snmp_get_system_info(req.ip, req.community, req.port, timeout=2.5)
    if not probe.get("ok"):
        raise HTTPException(status_code=422, detail=f"เชื่อมต่อ SNMP ไม่สำเร็จที่ {req.ip}:{req.port}: {probe.get('error', 'timeout')}")
    ports = await snmp_walk_interfaces(req.ip, req.community, req.port)
    if not ports or not getattr(ports, "complete", True):
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
    dev["status"] = "online"
    dev["ports"] = ports
    dev["up"] = probe.get("uptime", dev.get("up", ""))
    dev["descr"] = probe.get("descr", dev.get("descr", ""))

    save_device(dev)
    add_audit_log("admin", f"แก้ไขอุปกรณ์ {req.name}", req.ip, "สำเร็จ")
    return get_device(device_id)


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


@app.post("/api/interfaces/{device_id}/{port_name:path}/admin-status")
async def set_port_admin_status(device_id: str, port_name: str, req: InterfaceAdminRequest):
    """
    FR-3.1, FR-3.2, FR-3.4:
    Interface Control: Send SNMP SET ifAdminStatus (1=up, 2=down)
    Read back verified status, log audit, and push update
    """
    dev = get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    if dev.get("discovery_only") or not database.management_ip(dev.get("ip", "")):
        raise HTTPException(status_code=409, detail=dev.get("config_unavailable_reason") or "ไม่มี Management IP จึงไม่สามารถ Config ผ่าน SNMP ได้")

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
        reason = res.get("error_code")
        add_audit_log("admin", f"สั่ง {('Shutdown' if req.status == 'down' else 'No Shutdown')} {port_name}", dev["name"], f"ล้มเหลว ({reason})" if reason else "ล้มเหลว")
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


@app.get("/api/interfaces/{device_id}/{port_name:path}/traffic")
async def get_port_traffic(device_id: str, port_name: str, range: str = Query("day")):
    """FR-4.1, FR-4.2: Traffic Graph series (live, day, week, month, year)"""
    dev = get_device(device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")
    if dev.get("discovery_only"):
        raise HTTPException(status_code=409, detail=dev["config_unavailable_reason"])
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

    engine = SnmpEngine()
    try:
        transport = await UdpTransportTarget.create(("127.0.0.1", _trap_port), timeout=2.0, retries=0)
        error_indication, error_status, _, _ = await send_notification(
            engine, CommunityData("public"), transport, ContextData(), "trap",
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
    finally:
        engine.close_dispatcher()


@app.get("/api/audit-logs")
async def list_audit_logs():
    """FR-3.5: Audit log listing"""
    return get_audit_logs(40)


@app.get("/api/topology")
async def get_topology():
    """FR-6.4, FR-6.5: Topology Nodes & Links"""
    devices = get_all_devices()
    links = database.get_topology_links()
    return {"devices": devices, "links": links}


@app.post("/api/discovery")
async def run_discovery_endpoint(req: DiscoveryRequest):
    """FR-6.1, FR-6.2: Auto Discovery via LLDP/CDP"""
    try:
        job = await discovery_jobs.start({**req.model_dump(), "seed_ip": req.seed_ip or "", "subnet": req.subnet or ""})
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error))
    # Compatibility endpoint waits for the job; the frontend uses the nonblocking job endpoint.
    while discovery_jobs.get(job["id"])["status"] == "running":
        await asyncio.sleep(0.1)
    finished = discovery_jobs.get(job["id"])
    if finished["status"] != "completed":
        raise HTTPException(status_code=500, detail="Discovery ล้มเหลว")
    return finished["result"]


@app.post("/api/discovery/jobs")
async def start_discovery_job(req: DiscoveryRequest):
    try:
        return await discovery_jobs.start({**req.model_dump(), "seed_ip": req.seed_ip or "", "subnet": req.subnet or ""})
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error))


@app.get("/api/discovery/jobs/{job_id}")
async def discovery_job_status(job_id: str):
    job = discovery_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Discovery job not found")
    return job


class NetworkScanRequest(BaseModel):
    network: str = "192.168.1.0/24"
    communities: List[str] = ["public"]
    max_concurrent: int = 50



@app.post("/api/network/scan")
async def network_scan_endpoint(req: NetworkScanRequest):
    """Discover devices by SNMP GET and IF-MIB walk only."""
    logger.info(f"Network scan request: {req.network}")
    return await run_discovery_endpoint(DiscoveryRequest(subnet=req.network, communities=req.communities))
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
