"""In-process discovery jobs; one writer, bounded results, credential-free progress/errors."""
import asyncio
import os
import time
import uuid
from database import get_all_devices
from discovery import discover_network, validate_target


class DiscoveryJobs:
    def __init__(self):
        self.jobs = {}
        self.active_id = ""
        self.tasks = set()

    def get(self, job_id):
        return self.jobs.get(job_id)

    async def start(self, options):
        validate_target(options.get("seed_ip", ""), options.get("subnet", ""))
        credentials = [options.get("community", ""), *options.get("communities", [])]
        if len({value.strip() for value in credentials if value.strip()}) > 8:
            raise ValueError("ใช้ SNMP communities ได้ไม่เกิน 8 รายการ")
        if self.active_id and self.jobs[self.active_id]["status"] == "running":
            raise RuntimeError("Discovery กำลังทำงานอยู่")
        job_id = uuid.uuid4().hex
        state = {"id": job_id, "status": "running", "phase": "starting", "current_ip": "",
                 "current_name": "", "checked": 0, "queued": 0, "issues": [],
                 "devices_count": len(get_all_devices()), "links_count": 0, "started_at": time.time()}
        self.jobs[job_id], self.active_id = state, job_id
        for old_id in list(self.jobs):
            if len(self.jobs) <= 20: break
            if old_id != self.active_id: del self.jobs[old_id]
        task = asyncio.create_task(self._run(state, options))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return state.copy()

    async def _run(self, state, options):
        async def progress(update):
            state.update(update)
        try:
            result = await discover_network(**options, progress=progress)
            state.update(status="completed", phase="completed", result=result, finished_at=time.time())
        except asyncio.CancelledError:
            state.update(status="cancelled", phase="cancelled", finished_at=time.time())
            raise
        except Exception:
            # Exceptions may contain transport details. Do not publish credential-bearing strings.
            state.update(status="failed", phase="failed", error="ค้นหาอุปกรณ์ไม่สำเร็จ โปรดตรวจสอบบันทึกข้อผิดพลาดของบริการค้นหาอุปกรณ์", finished_at=time.time())
            import logging
            logging.getLogger("discovery_jobs").exception("Discovery job failed")

    async def periodic(self):
        interval = max(15, int(os.getenv("NETFIX_DISCOVERY_INTERVAL", "60")))
        while True:
            await asyncio.sleep(interval)
            if self.active_id and self.jobs[self.active_id]["status"] == "running":
                continue
            if any(not device.get("discovery_only") and device.get("community") for device in get_all_devices()):
                await self.start({})

    async def stop(self):
        pending = list(self.tasks)
        for task in pending: task.cancel()
        if pending: await asyncio.gather(*pending, return_exceptions=True)


discovery_jobs = DiscoveryJobs()
