"""
Background Poller module for SNMP Network Monitor
Polls sysUpTime for device liveness and ifHCInOctets/ifHCOutOctets for bps traffic rate
Meets PRD FR-4.3, FR-4.4, FR-4.5 requirements (bps rate, counter wrap, reboot handling)
"""

import asyncio
import logging
import time
from typing import Dict, Tuple

from database import (
    get_all_devices,
    save_device,
    save_traffic_sample,
    update_interface_status,
)
from snmp_engine import snmp_get_system_info, snmp_poll_octets
from trap_receiver import ws_manager

logger = logging.getLogger("poller")

# Memory cache for previous counter samples:
# {(device_id, if_index): (timestamp, in_octets, out_octets)}
_prev_counters: Dict[Tuple[str, int], Tuple[float, int, int]] = {}


async def poll_device_metrics(device: dict):
    if device.get("discovery_only") or not device.get("ip"):
        return
    dev_id = device["id"]
    ip = device["ip"]
    community = device.get("community", "public")
    ver = device.get("ver", "v2c")
    snmp_port = int(device.get("snmp_port", 161) or 161)

    # 1. Check device liveness via sysUpTime (FR-1.5)
    sys_info = await snmp_get_system_info(ip, community, port=snmp_port, timeout=1.5)
    is_online = sys_info.get("ok", False)
    new_status = "online" if is_online else "offline"

    status_changed = device.get("status") != new_status
    if status_changed or is_online:
        device["status"] = new_status
        if is_online:
            device["up"] = sys_info.get("uptime", device.get("up", ""))
            if sys_info.get("name"):
                device["name"] = sys_info["name"]
            if sys_info.get("descr"):
                device["descr"] = sys_info["descr"]
        # A liveness response must not overwrite interface state received via Trap.
        metadata = {key: value for key, value in device.items() if key != "ports"}
        save_device(metadata)

        if status_changed:
            await ws_manager.broadcast({
                "type": "DEVICE_STATUS_CHANGE",
                "device_id": dev_id,
                "status": new_status,
                "uptime": device.get("up", "")
            })

    if not is_online:
        return

    # 2. Poll interface traffic octets (FR-4.3)
    ports = device.get("ports", [])
    if not ports:
        return

    active_indices = [p["idx"] for p in ports if not p.get("virtual")]
    octets_data = await snmp_poll_octets(ip, community, port=snmp_port, if_indices=active_indices)
    now = time.time()

    for port in ports:
        idx = port["idx"]
        pname = port["name"]
        if idx not in octets_data:
            continue

        sample = octets_data[idx]
        cur_in = sample.get("in_octets")
        cur_out = sample.get("out_octets")

        if cur_in is None or cur_out is None:
            continue

        cache_key = (dev_id, idx)
        prev = _prev_counters.get(cache_key)
        _prev_counters[cache_key] = (now, cur_in, cur_out)

        if not prev:
            continue

        prev_time, prev_in, prev_out = prev
        dt = now - prev_time
        if dt <= 0.1:
            continue

        # FR-4.4: Calculate bps and handle counter wrap / reboot
        # If counter drops significantly, check for counter wrap or reboot
        diff_in = cur_in - prev_in
        diff_out = cur_out - prev_out

        # Counter wrapped or device rebooted
        if diff_in < 0:
            if cur_in < 4294967296 and prev_in < 4294967296:
                diff_in = (4294967296 - prev_in) + cur_in  # 32-bit wrap
            else:
                # Reboot or invalid jump: skip point to prevent bogus spike
                diff_in = 0

        if diff_out < 0:
            if cur_out < 4294967296 and prev_out < 4294967296:
                diff_out = (4294967296 - prev_out) + cur_out  # 32-bit wrap
            else:
                diff_out = 0

        in_bps = (diff_in * 8) / dt
        out_bps = (diff_out * 8) / dt

        # Sanity check: max speed cap
        max_bps = port["speed"] * 1e6 * 1.5
        if in_bps > max_bps:
            in_bps = max_bps
        if out_bps > max_bps:
            out_bps = max_bps

        # Save to database
        save_traffic_sample(dev_id, pname, cur_in, cur_out, in_bps, out_bps)


async def run_poller_loop(poll_interval_seconds: int = 60):
    """Periodic polling worker task"""
    logger.info(f"Starting SNMP Poller loop (interval={poll_interval_seconds}s)")
    while True:
        try:
            devices = get_all_devices()
            tasks = [poll_device_metrics(dev) for dev in devices]
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
        except Exception as e:
            logger.error(f"Error in poller loop: {e}")

        await asyncio.sleep(poll_interval_seconds)
