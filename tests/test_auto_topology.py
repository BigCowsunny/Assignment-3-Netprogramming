"""Auto topology regression tests: synthetic MIBs/frames and isolated SQLite."""
import asyncio
import ipaddress
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import database
import discovery
import discovery_jobs
import main
from lldp_receiver import parse_lldp_frame
from fastapi.testclient import TestClient


def ports():
    return [{"idx": idx, "name": f"GigabitEthernet0/{idx - 6}", "admin": "up", "oper": "up",
             "speed": 1000, "mac": f"00:11:22:33:44:{idx:02x}"}
            for idx in (7, 8)]


def device(device_id="a", ip="192.0.2.1", name="Core"):
    return {"id": device_id, "ip": ip, "name": name, "community": "lab-ro",
            "type": "switch", "status": "online", "ports": ports()}


class TempDatabase:
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.original = database.DB_PATH
        database.DB_PATH = str(Path(self.folder.name) / "test.db")
        database.init_db()

    def tearDown(self):
        database.DB_PATH = self.original
        self.folder.cleanup()


def ltlv(kind, value):
    return struct.pack("!H", kind << 9 | len(value)) + value


def lframe(name="Switch", ip="", ttl=120, vlan=False):
    payload = ltlv(1, b"\x04" + bytes.fromhex("001122334455"))
    payload += ltlv(2, b"\x05Gi0/1") + ltlv(3, struct.pack("!H", ttl))
    if name: payload += ltlv(5, name.encode())
    payload += ltlv(7, b"\x00\x04\x00\x04")
    if ip:
        payload += ltlv(8, b"\x05\x01" + ipaddress.IPv4Address(ip).packed + b"\x02\x00\x00\x00\x01\x00")
    payload += b"\x00\x00"
    header = bytes.fromhex("0180c200000e001122334455")
    if vlan: header += bytes.fromhex("81000064")
    return header + bytes.fromhex("88cc") + payload


class LldpParserTests(unittest.TestCase):
    def test_no_ip_and_vlan(self):
        for vlan in (False, True):
            result = parse_lldp_frame(lframe(vlan=vlan), "lab-NIC")
            self.assertEqual(result["chassis_mac"], "00:11:22:33:44:55")
            self.assertEqual(result["management_ip"], "")
            self.assertEqual(result["port"], "Gi0/1")
            self.assertEqual(result["protocol"], "LLDP")
            self.assertEqual(result["capture_interface"], "lab-NIC")

    def test_address_and_unnamed_device(self):
        result = parse_lldp_frame(lframe(name="", ip="192.0.2.10"))
        self.assertEqual(result["name"], "00:11:22:33:44:55")
        self.assertEqual(result["management_ip"], "192.0.2.10")

    def test_withdrawal(self):
        self.assertEqual(parse_lldp_frame(lframe(ttl=0))["ttl"], 0)

    def test_invalid_frames_and_duplicate_mandatory_tlv(self):
        raw = lframe()
        duplicate = raw[:-2] + ltlv(3, b"\x00\x78") + raw[-2:]
        wrong_order = raw[:14] + ltlv(2, b"\x05Gi0/1") + raw[14:]
        for invalid in (b"", raw[:20], raw[:-1], b"\xff" * 6 + raw[6:], duplicate, wrong_order):
            self.assertIsNone(parse_lldp_frame(invalid))


class IdentityAndSnapshotTests(TempDatabase, unittest.TestCase):
    def observe(self, **options):
        return database.record_discovered_neighbor({
            "identity": "Switch", "name": "Switch", "port": "Gi0/1", "protocol": "CDP",
            "ttl": 180, **options})[0]

    def test_duplicate_generic_names_with_distinct_macs_are_separate(self):
        a = self.observe(source_mac="00:11:22:33:44:55")
        b = self.observe(source_mac="00:11:22:33:44:66")
        self.assertNotEqual(a["id"], b["id"])
        self.assertEqual(len(database.get_all_devices()), 2)

    def test_cross_protocol_and_multiport_reuse_strong_identity(self):
        a = self.observe(source_mac="00:11:22:33:44:55")
        b = self.observe(protocol="LLDP", chassis_mac="00:11:22:33:44:55",
                         chassis_id="4:001122334455", port="Gi0/2")
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(len(database.get_all_devices()), 1)
        self.assertEqual(len(b["ports"]), 2)

    def test_generic_name_without_strong_identity_is_scoped_to_reporter_port(self):
        a = self.observe(observer_id="a", local_port="Gi0/1")
        b = self.observe(observer_id="a", local_port="Gi0/2")
        self.assertNotEqual(a["id"], b["id"])

    def test_migration_keeps_existing_observation_id(self):
        a = self.observe(source_mac="00:11:22:33:44:55", management_ip="192.0.2.10")
        database.init_db()
        b = self.observe(protocol="LLDP", chassis_mac="00:11:22:33:44:55", chassis_id="4:001122334455")
        self.assertEqual(a["id"], b["id"])

    def test_reused_ip_does_not_merge_different_chassis(self):
        a = self.observe(management_ip="192.0.2.10", chassis_id="4:001122334455", chassis_mac="00:11:22:33:44:55")
        b = self.observe(management_ip="192.0.2.10", chassis_id="4:001122334466", chassis_mac="00:11:22:33:44:66")
        self.assertNotEqual(a["id"], b["id"])

    def test_old_address_alias_removed_on_address_change(self):
        a = self.observe(management_ip="192.0.2.10", source_mac="00:11:22:33:44:55")
        b = self.observe(management_ip="192.0.2.11", source_mac="00:11:22:33:44:55")
        self.assertEqual(a["id"], b["id"])
        c = self.observe(management_ip="192.0.2.10")
        self.assertNotEqual(a["id"], c["id"])

    def test_successful_snapshot_moves_then_removes_link(self):
        database.save_device(device())
        b = self.observe(source_mac="00:11:22:33:44:55")
        link = {"a": "a", "pa": "Gi0/1", "b": b["id"], "pb": "Gi0/1"}
        database.replace_topology_observations("a", "CDP", [link])
        self.assertEqual(len(database.get_topology_links()), 1)
        database.replace_topology_observations("a", "CDP", [{**link, "pa": "Gi0/2"}])
        self.assertEqual(database.get_topology_links()[0]["pa"], "GigabitEthernet0/2")
        database.replace_topology_observations("a", "CDP", [])
        self.assertEqual(database.get_topology_links(), [])

    def test_reverse_reporters_deduplicate_and_ttl_expires(self):
        database.save_device(device())
        database.save_device(device("b", "192.0.2.2", "Access"))
        with patch.object(database.time, "time", return_value=1000):
            database.replace_topology_observations("a", "CDP", [{"a": "a", "pa": "Gi0/1", "b": "b", "pb": "Gi0/2"}], ttl=30)
            database.replace_topology_observations("b", "LLDP", [{"a": "b", "pa": "Gi0/2", "b": "a", "pb": "Gi0/1"}], ttl=30)
            self.assertEqual(len(database.get_topology_links()), 1)
        with patch.object(database.time, "time", return_value=1031):
            self.assertEqual(database.get_topology_links(), [])

    def test_timeout_or_unresolved_local_port_keeps_prior_link(self):
        source = device()
        database.save_device(source)
        b = self.observe(identity="Access", name="Access")
        database.replace_topology_observations("a", "CDP", [{"a": "a", "pa": "Gi0/1", "b": b["id"], "pb": "Gi0/1"}])
        for group in (
            {"protocol": "CDP", "complete": False, "neighbors": []},
            {"protocol": "CDP", "complete": True, "neighbors": [
                {"identity": "Access", "name": "Access", "port": "Gi0/1", "local_port": "", "observer_id": "a"}]},
        ):
            _, issues = discovery.persist_neighbors(source, [group])
            self.assertTrue(issues)
            self.assertEqual(len(database.get_topology_links()), 1)

    def test_legacy_discovery_edges_migrate_and_expire(self):
        database.save_device(device())
        database.save_device(device("b", "192.0.2.2", "Access"))
        database.save_topology_link("a", "Gi0/1", "b", "Gi0/2", "CDP")
        with patch.object(database.time, "time", return_value=1000):
            database.init_db()
            self.assertEqual(len(database.get_topology_links()), 1)
        with patch.object(database.time, "time", return_value=1181):
            database.init_db()  # Restart must not renew expired data.
            self.assertEqual(database.get_topology_links(), [])

    def test_passive_withdrawal_hides_links_of_unmanaged_neighbor(self):
        database.save_device(device())
        b = self.observe(source_mac="00:11:22:33:44:55")
        database.replace_topology_observations("a", "CDP", [{"a": "a", "pa": "Gi0/1", "b": b["id"], "pb": "Gi0/1"}])
        self.assertEqual(len(database.get_topology_links()), 1)
        self.observe(source_mac="00:11:22:33:44:55", ttl=0)
        self.assertEqual(database.get_topology_links(), [])

    def test_captured_and_mib_generic_neighbor_dedup_with_verified_segment(self):
        source = device()
        database.save_device(source)
        self.observe(identity="Core", name="Core", source_mac=ports()[0]["mac"],
                     capture_interface="lab-NIC", management_ip=source["ip"])
        captured = self.observe(source_mac="50:00:00:01:00:00", port="Gi0/0", capture_interface="lab-NIC")
        groups = [{"protocol": "CDP", "complete": True, "neighbors": [
            {"identity": "Switch", "name": "Switch", "port": "Gi0/0", "observer_id": "a",
             "local_port": "GigabitEthernet0/1"}]}]
        found, _ = discovery.persist_neighbors(source, groups)
        self.assertEqual(found[0]["id"], captured["id"])
        self.assertEqual(len(database.get_all_devices()), 2)
        self.assertEqual(database.get_topology_links()[0]["b"], captured["id"])

    def test_different_capture_segment_or_ambiguous_macs_are_not_merged(self):
        source = device()
        database.save_device(source)
        self.observe(identity="Core", name="Core", source_mac=ports()[0]["mac"],
                     capture_interface="lab-NIC", management_ip=source["ip"])
        captured = self.observe(source_mac="50:00:00:01:00:00", port="Gi0/0", capture_interface="other-NIC")
        weak = self.observe(observer_id="a", local_port="GigabitEthernet0/1", port="Gi0/0")
        self.assertNotEqual(weak["id"], captured["id"])
        self.observe(source_mac="50:00:00:01:00:00", port="Gi0/0", capture_interface="lab-NIC")
        self.assertEqual(len(database.get_all_devices()), 2)
        self.observe(source_mac="50:00:00:02:00:00", port="Gi0/0", capture_interface="lab-NIC")
        # Both strong devices and the unresolved observation remain separate.
        self.assertEqual(len(database.get_all_devices()), 4)


class CrawlTests(TempDatabase, unittest.IsolatedAsyncioTestCase):
    async def mib(self, ip, community, oid, port=161, raw=False):
        destinations = {
            "192.0.2.1": ("B", "192.0.2.2"),
            "192.0.2.2": ("C", "192.0.2.3"),
            "192.0.2.3": ("A", "192.0.2.1"),
        }
        name, address = destinations[ip]
        data = {discovery.OID_CDP_CACHE_DEVICE_ID: name,
                discovery.OID_CDP_CACHE_DEVICE_PORT: "Gi0/2",
                discovery.OID_CDP_CACHE_ADDRESS: ipaddress.IPv4Address(address).packed}
        return [(oid + ".7.1", data[oid])] if oid in data else []

    async def probe(self, ip, *args, **kwargs):
        return {"ok": True, "name": {"192.0.2.1": "A", "192.0.2.2": "B", "192.0.2.3": "C"}[ip], "descr": "Cisco Switch"}

    async def test_three_node_cycle_from_one_seed_and_real_ports(self):
        progress = AsyncMock()
        with patch.object(discovery, "_walk_column", self.mib), \
             patch.object(discovery, "snmp_get_system_info", new=AsyncMock(side_effect=self.probe)) as probe, \
             patch.object(discovery, "snmp_walk_interfaces", new=AsyncMock(return_value=ports())), \
             patch.object(discovery, "scan_network", new_callable=AsyncMock) as sweep:
            result = await discovery.discover_network(seed_ip="192.0.2.1", community="lab-ro", progress=progress)
        self.assertEqual(result["devices_count"], 3)
        self.assertEqual(result["links_count"], 3)
        self.assertEqual(result["checked"], 3)
        self.assertEqual(probe.await_count, 3)
        sweep.assert_not_awaited()
        self.assertTrue(all(link["pa"] == "GigabitEthernet0/1" and link["pb"] == "GigabitEthernet0/2" for link in result["links"]))
        self.assertTrue(all(not d["discovery_only"] for d in result["devices"]))
        self.assertEqual(progress.await_args.args[0]["phase"], "completed")

    async def test_auto_seed_uses_saved_credential_without_subnet(self):
        database.save_device(device())
        with patch.object(discovery, "_walk_column", new=AsyncMock(return_value=[])), \
             patch.object(discovery, "snmp_get_system_info", new=AsyncMock(return_value={"ok": True, "name": "Core"})) as probe, \
             patch.object(discovery, "snmp_walk_interfaces", new=AsyncMock(return_value=ports())), \
             patch.object(discovery, "scan_network", new_callable=AsyncMock) as sweep:
            result = await discovery.discover_network()
        self.assertEqual(result["checked"], 1)
        self.assertEqual(probe.await_args.args[1], "lab-ro")
        sweep.assert_not_awaited()

    async def test_passive_seed_without_credential_stays_visible(self):
        observed, _ = database.record_discovered_neighbor({"identity": "R3", "port": "Eth0/0", "management_ip": "192.0.2.1"})
        with patch.object(discovery, "snmp_get_system_info", new_callable=AsyncMock) as probe:
            result = await discovery.discover_network()
        probe.assert_not_awaited()
        self.assertEqual(result["devices"][0]["id"], observed["id"])
        self.assertEqual(result["issues"][0]["code"], "missing_credentials")
        self.assertFalse(result["devices"][0]["can_configure"])

    async def test_timeout_does_not_erase_discovered_inventory(self):
        observed, _ = database.record_discovered_neighbor({"identity": "R3", "port": "Eth0/0", "management_ip": "192.0.2.1"})
        with patch.object(discovery, "snmp_get_system_info", new=AsyncMock(return_value={"ok": False})):
            result = await discovery.discover_network(community="wrong")
        self.assertEqual(result["devices"][0]["id"], observed["id"])
        self.assertEqual(result["issues"][0]["code"], "snmp_timeout")

    async def test_credential_fallback_and_promotion_keep_id(self):
        observed, _ = database.record_discovered_neighbor({"identity": "Core", "port": "Gi0/1", "management_ip": "192.0.2.1"})
        with patch.object(discovery, "_walk_column", new=AsyncMock(return_value=[])), \
             patch.object(discovery, "snmp_get_system_info", new=AsyncMock(side_effect=[{"ok": False}, {"ok": True, "name": "Core"}])), \
             patch.object(discovery, "snmp_walk_interfaces", new=AsyncMock(return_value=ports())):
            result = await discovery.discover_network(communities=["wrong", "lab-ro"])
        self.assertEqual(result["devices"][0]["id"], observed["id"])
        self.assertEqual(result["devices"][0]["community"], "lab-ro")
        self.assertFalse(result["devices"][0]["discovery_only"])

    async def test_depth_and_device_limits_keep_seen_nodes(self):
        for limit in ({"max_depth": 0}, {"max_devices": 1}):
            # Reset each scenario so saved managed devices do not become new seeds.
            self.tearDown()
            self.setUp()
            with patch.object(discovery, "_walk_column", self.mib), \
                 patch.object(discovery, "snmp_get_system_info", new=AsyncMock(side_effect=self.probe)) as probe, \
                 patch.object(discovery, "snmp_walk_interfaces", new=AsyncMock(return_value=ports())):
                result = await discovery.discover_network("192.0.2.1", "lab-ro", **limit)
            self.assertEqual(probe.await_count, 1)
            self.assertEqual(result["devices_count"], 2)
            self.assertTrue(any(i["code"] in ("depth_limit", "device_limit") for i in result["issues"]))

    async def test_cdp_without_ip_node_and_link(self):
        async def mib(ip, community, oid, port=161, raw=False):
            values = {discovery.OID_CDP_CACHE_DEVICE_ID: "No-IP", discovery.OID_CDP_CACHE_DEVICE_PORT: "Gi0/2"}
            return [(oid + ".7.1", values[oid])] if oid in values else []
        with patch.object(discovery, "_walk_column", mib), \
             patch.object(discovery, "snmp_get_system_info", new=AsyncMock(return_value={"ok": True, "name": "Core"})), \
             patch.object(discovery, "snmp_walk_interfaces", new=AsyncMock(return_value=ports())):
            result = await discovery.discover_network("192.0.2.1", "lab-ro")
        pending = next(d for d in result["devices"] if d["name"] == "No-IP")
        self.assertEqual(pending["ip"], "")
        self.assertFalse(pending["can_configure"])
        self.assertEqual(result["links_count"], 1)
        self.assertTrue(any(i["code"] == "no_ip" for i in result["issues"]))

    async def test_lldp_local_number_is_not_assumed_ifindex_and_no_ip_supported(self):
        source = device()
        database.save_device(source)
        async def mib(ip, community, oid, port=161, raw=False):
            values = {
                discovery.OID_LLDP_REM_SYS_NAME: ("0.99.1", "LLDP-No-IP"),
                discovery.OID_LLDP_REM_CHASSIS_TYPE: ("0.99.1", "4"),
                discovery.OID_LLDP_REM_CHASSIS_ID: ("0.99.1", bytes.fromhex("001122334455")),
                discovery.OID_LLDP_REM_PORT_TYPE: ("0.99.1", "5"),
                discovery.OID_LLDP_REM_PORT_ID: ("0.99.1", b"Gi0/2"),
                discovery.OID_LLDP_LOC_PORT_ID: ("99", b"Gi0/1"),
                discovery.OID_LLDP_LOC_PORT_TYPE: ("99", "5"),
            }
            if oid not in values: return []
            suffix, value = values[oid]
            return [(oid + "." + suffix, value)]
        with patch.object(discovery, "_walk_column", mib):
            links = await discovery.discover_topology_links(database.get_all_devices())
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["pa"], "GigabitEthernet0/1")
        remote = database.get_device(links[0]["b"])
        self.assertFalse(remote["can_configure"])
        self.assertEqual(remote["discovery_protocol"], "LLDP")

    async def test_lldp_management_address_index_and_mac_port_mapping(self):
        async def mib(ip, community, oid, port=161, raw=False):
            values = {
                discovery.OID_LLDP_REM_CHASSIS_TYPE: ("0.99.1", "4"),
                discovery.OID_LLDP_REM_CHASSIS_ID: ("0.99.1", bytes.fromhex("001122334455")),
                discovery.OID_LLDP_REM_PORT_TYPE: ("0.99.1", "3"),
                discovery.OID_LLDP_REM_PORT_ID: ("0.99.1", bytes.fromhex("001122334408")),
                discovery.OID_LLDP_REM_PORT_DESC: ("0.99.1", "Gi0/2"),
                discovery.OID_LLDP_REM_MAN_ADDR: ("0.99.1.1.4.192.0.2.10", "2"),
                discovery.OID_LLDP_LOC_PORT_ID: ("99", bytes.fromhex("001122334407")),
                discovery.OID_LLDP_LOC_PORT_TYPE: ("99", "3"),
            }
            if oid not in values: return []
            suffix, value = values[oid]
            return [(oid + "." + suffix, value)]
        with patch.object(discovery, "_walk_column", mib):
            groups = await discovery.read_neighbors(device())
        neighbor = groups[1]["neighbors"][0]
        self.assertEqual(neighbor["management_ip"], "192.0.2.10")
        self.assertEqual(neighbor["local_port"], "GigabitEthernet0/1")
        self.assertEqual(neighbor["port"], "Gi0/2")

    async def test_failed_walk_is_not_a_successful_empty_snapshot(self):
        async def mib(*args, **kwargs):
            rows = discovery.WalkRows()
            rows.ok, rows.error = False, "timeout"
            return rows
        with patch.object(discovery, "_walk_column", mib):
            groups = await discovery.read_neighbors(device())
        self.assertTrue(all(not group["complete"] for group in groups))

    def test_invalid_inputs_and_unknown_job_api(self):
        client = TestClient(main.app)
        for body in ({"seed_ip": "not-ip"}, {"subnet": "192.0.0.0/16"},
                     {"max_devices": 0}, {"max_depth": 99}, {"communities": list("123456789")}):
            self.assertEqual(client.post("/api/discovery/jobs", json=body).status_code, 422)
        self.assertEqual(client.get("/api/discovery/jobs/missing").status_code, 404)

    async def test_jobs_report_progress_and_reject_overlap(self):
        jobs = discovery_jobs.DiscoveryJobs()
        gate = asyncio.Event()
        async def run(**options):
            await options["progress"]({"phase": "probing", "current_ip": "192.0.2.1", "checked": 1})
            await gate.wait()
            return {"devices": [], "links": [], "issues": []}
        with patch.object(discovery_jobs, "discover_network", run):
            started = await jobs.start({"seed_ip": "192.0.2.1", "community": "secret-ro"})
            await asyncio.sleep(0)
            self.assertEqual(jobs.get(started["id"])["phase"], "probing")
            self.assertNotIn("secret-ro", json.dumps(jobs.get(started["id"])))
            with self.assertRaises(RuntimeError): await jobs.start({})
            gate.set()
            await asyncio.gather(*jobs.tasks)
            self.assertEqual(jobs.get(started["id"])["status"], "completed")
        await jobs.stop()

    async def test_jobs_cancel_on_shutdown_and_validate_total_credentials(self):
        jobs = discovery_jobs.DiscoveryJobs()
        with self.assertRaises(ValueError):
            await jobs.start({"community": "ninth", "communities": list("12345678")})
        async def run(**options):
            await asyncio.Event().wait()
        with patch.object(discovery_jobs, "discover_network", run):
            started = await jobs.start({})
            await asyncio.sleep(0)
            await jobs.stop()
        self.assertEqual(jobs.get(started["id"])["status"], "cancelled")

    async def test_captured_lldp_persists_and_broadcasts(self):
        from cdp_receiver import CdpCapture
        from trap_receiver import ws_manager
        capture = CdpCapture()
        capture._queue = asyncio.Queue(maxsize=256)
        capture._consumer = asyncio.create_task(capture._consume())
        try:
            with patch.object(ws_manager, "broadcast", new_callable=AsyncMock) as broadcast:
                capture._enqueue(parse_lldp_frame(lframe(), "test-NIC"))
                await asyncio.wait_for(capture._queue.join(), timeout=2)
                message = broadcast.await_args.args[0]
                self.assertEqual(message["device"]["discovery_protocol"], "LLDP")
                self.assertFalse(message["device"]["can_configure"])
                self.assertEqual(capture.health()["received_packets"]["LLDP"], 1)
        finally:
            await capture.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)
