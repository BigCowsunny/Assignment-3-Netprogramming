"""
Background Poller module for SNMP Network Monitor
Polls sysUpTime for device liveness and ifHCInOctets/ifHCOutOctets for bps traffic rate
Meets PRD FR-4.3, FR-4.4, FR-4.5 requirements (bps rate, counter wrap, reboot handling)
"""

import asyncio
import logging
import time

from database import (
    get_all_devices,
    update_device_metrics,
    get_device,
    save_traffic_sample,
)
from snmp_engine import snmp_get_system_info, snmp_poll_octets
from trap_receiver import ws_manager

logger = logging.getLogger("poller")

# Memory cache for previous counter samples:
# {(device_id, if_index): (monotonic_time, counters/width/discontinuity, connection_identity)}
_prev_counters: dict = {}
_prev_uptime: dict = {}
_poll_interval_seconds = 60
_interval_changed = asyncio.Event()


def get_runtime_poll_interval() -> int:
    return _poll_interval_seconds


def configure_poll_interval(seconds: int):
    global _poll_interval_seconds
    if type(seconds) is not int or not 10 <= seconds <= 3600:
        raise ValueError("poll_interval must be an integer between 10 and 3600")
    if seconds != _poll_interval_seconds:
        _poll_interval_seconds = seconds
        _interval_changed.set()
        logger.info("SNMP polling interval changed to %ss", seconds)


async def poll_device_metrics(device: dict):
    if device.get("discovery_only") or not device.get("ip"):
        return
    dev_id = device["id"]
    ip = device["ip"]
    community = device.get("community", "public")
    snmp_port = int(device.get("snmp_port", 161) or 161)

    # 1. Check device liveness via sysUpTime (FR-1.5)
    sys_info = await snmp_get_system_info(ip, community, port=snmp_port, timeout=1.5)
    is_online = sys_info.get("ok", False)
    new_status = "online" if is_online else "offline"

    status_changed = device.get("status") != new_status
    if not update_device_metrics(device, sys_info):
        # Device was deleted or its credentials/address changed during the request.
        return
    if status_changed:
        await ws_manager.broadcast({
            "type": "DEVICE_STATUS_CHANGE", "device_id": dev_id,
            "status": new_status, "uptime": sys_info.get("uptime", device.get("up", "")),
        })
    uptime = sys_info.get("uptime_ticks")
    previous_uptime = _prev_uptime.get(dev_id)
    if not is_online or (uptime is not None and previous_uptime is not None and uptime < previous_uptime):
        for key in list(_prev_counters):
            if key[0] == dev_id:
                del _prev_counters[key]
    if not is_online:
        _prev_uptime.pop(dev_id, None)
        return
    _prev_uptime[dev_id] = uptime

    # 2. Poll interface traffic octets (FR-4.3)
    ports = device.get("ports", [])
    if not ports:
        return

    active_indices = [p["idx"] for p in ports]
    octets_data = await snmp_poll_octets(ip, community, port=snmp_port, if_indices=active_indices)
    current = get_device(dev_id)
    if not current or any(current.get(key) != device.get(key) for key in ("ip", "community", "snmp_port")):
        return
    now = time.monotonic()

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
        identity = (ip, community, snmp_port, pname)
        _prev_counters[cache_key] = (now, sample.copy(), identity)
        if not prev:
            continue
        prev_time, previous, previous_identity = prev
        dt = now - prev_time
        if dt <= 0.1 or identity != previous_identity:
            continue
        if sample.get("discontinuity") != previous.get("discontinuity"):
            continue

        rates = []
        speed = float(port.get("speed", 0) or 0) * 1e6
        for field in ("in_octets", "out_octets"):
            bits = sample.get(field + "_bits", 64)
            if bits != previous.get(field + "_bits", 64):
                break
            difference = sample[field] - previous[field]
            if bits == 32 and speed and speed * dt / 8 >= 2**32:
                # Multiple wraps are indistinguishable. Do not invent a rate.
                break
            if difference < 0:
                if bits != 32 or not speed or sample.get("discontinuity") is None:
                    break
                difference += 2**32
            rate = difference * 8 / dt
            if speed and rate > speed * 1.05:
                break
            rates.append(rate)
        if len(rates) != 2:
            continue
        in_bps, out_bps = rates

        # Save to database
        save_traffic_sample(dev_id, pname, cur_in, cur_out, in_bps, out_bps)


async def run_poller_loop(poll_interval_seconds: int = 60):
    """Periodic polling worker task"""
    configure_poll_interval(poll_interval_seconds)
    logger.info(f"Starting SNMP Poller loop (interval={poll_interval_seconds}s)")
    while True:
        try:
            devices = get_all_devices()
            tasks = [poll_device_metrics(dev) for dev in devices]
            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for device, result in zip(devices, results):
                    if isinstance(result, Exception):
                        logger.error("Polling failed for %s: %s", device["id"], result)
            ids = {device["id"] for device in devices}
            for key in list(_prev_counters):
                if key[0] not in ids:
                    del _prev_counters[key]
            for key in list(_prev_uptime):
                if key not in ids:
                    del _prev_uptime[key]
        except Exception as e:
            logger.error(f"Error in poller loop: {e}")

        # Reschedule from the last completed round without cancelling an SNMP read.
        # Waking the wait also applies a shorter interval immediately.
        completed_at = asyncio.get_running_loop().time()
        while True:
            _interval_changed.clear()
            delay = completed_at + _poll_interval_seconds - asyncio.get_running_loop().time()
            if delay <= 0:
                break
            try:
                await asyncio.wait_for(_interval_changed.wait(), timeout=delay)
            except asyncio.TimeoutError:
                break
