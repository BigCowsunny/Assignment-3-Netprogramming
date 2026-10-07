"""Trap identity through shared NAT, late inventory updates and legacy history."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import database
import main
import trap_receiver
from trap_identity import match_trap_device, trap_interface_index
from test_monitoring_reliability import device, packet


class TrapIdentityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.original = database.DB_PATH
        database.DB_PATH = str(Path(self.folder.name) / "test.db")
        database.init_db()
        database.save_device(device())
        database.save_device({**device(), "id": "r2", "name": "R2.localdomain", "ip": "192.0.2.2",
                              "ports": [{**device()["ports"][0], "ip": "192.0.2.22/24"}]})

    def tearDown(self):
        database.DB_PATH = self.original
        self.folder.cleanup()

    async def receive(self, payload):
        parsed = trap_receiver.SnmpTrapProtocol().parse_trap(payload, "198.51.100.9")
        self.assertIsNotNone(parsed)
        with patch.object(trap_receiver.ws_manager, "broadcast", new_callable=AsyncMock) as broadcast, \
             patch.object(trap_receiver, "_discover_from_trap", new_callable=AsyncMock) as enroll:
            await trap_receiver.SnmpTrapProtocol().handle_parsed_trap(parsed)
        return parsed, broadcast, enroll

    async def test_v1_and_v2_agent_addresses_distinguish_two_devices_behind_nat(self):
        for version in (0, 1):
            for ip, expected in (("192.0.2.1", "r1"), ("192.0.2.2", "r2")):
                parsed, broadcast, enroll = await self.receive(packet(version, agent_ip=ip))
                self.assertEqual(parsed["agent_ip"], ip)
                event = broadcast.call_args.args[0]["event"]
                self.assertEqual((event["dev"], event["src"], event["agent_ip"]),
                                 (expected, "198.51.100.9", ip))
                self.assertEqual(event["port"], "Gi0/1")
                enroll.assert_not_awaited()
        self.assertEqual(len(database.get_events()), 4)
        self.assertEqual({event["dev"] for event in database.get_events()}, {"r1", "r2"})

    async def test_sysname_matches_unique_hostname_and_keeps_shared_source(self):
        _, broadcast, enroll = await self.receive(packet(agent_name="r2"))
        self.assertEqual(broadcast.call_args.args[0]["event"]["dev"], "r2")
        enroll.assert_not_awaited()
        self.assertEqual(database.get_events()[0]["dev_name"], "R2.localdomain")

    async def test_first_trap_relates_after_auto_enrollment_without_duplicate_or_status_replay(self):
        parsed = trap_receiver.SnmpTrapProtocol().parse_trap(packet(agent_ip="192.0.2.3"), "198.51.100.9")
        async def enroll(ip, community):
            self.assertEqual(ip, "192.0.2.3")
            self.assertEqual(database.get_events()[0]["dev"], "unknown")
            saved = {**device(), "id": "r3", "name": "R3", "ip": ip}
            database.save_device(saved)
            return saved
        with patch.object(trap_receiver, "_discover_from_trap", enroll), \
             patch.object(trap_receiver.ws_manager, "broadcast", new_callable=AsyncMock) as broadcast:
            await trap_receiver.SnmpTrapProtocol().handle_parsed_trap(parsed)
        rows = database.get_events()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["dev"], "r3")
        self.assertEqual(database.get_device("r3")["ports"][0]["oper"], "up")
        self.assertEqual([call.args[0]["type"] for call in broadcast.call_args_list], ["TRAP_EVENT", "EVENTS_UPDATED"])
        self.assertEqual(len(await main.list_events(device="r3")), 1)

    async def test_history_resolves_after_discovery_and_rename_without_rewriting_receipt(self):
        database.add_event("old", "unknown", "192.0.2.4", "ifIndex 2", "linkDown", trap_receiver.OID_LINK_DOWN,
                           json.dumps({"1.3.6.1.2.1.2.2.1.8.2": "2"}))
        before = database.get_events()[0]
        database.save_device({**device(), "id": "r4", "name": "R4", "ip": "192.0.2.4"})
        row = database.get_events()[0]
        self.assertEqual((row["id"], row["t"], row["src"]), (before["id"], before["t"], before["src"]))
        self.assertEqual((row["dev"], row["dev_name"], row["port"]), ("r4", "R4", "Gi0/1"))
        self.assertEqual(database.get_device("r4")["ports"][0]["oper"], "up")
        database.save_device({**database.get_device("r4"), "name": "Branch"})
        self.assertEqual(database.get_events()[0]["dev_name"], "Branch")

    async def test_discovered_only_neighbor_has_name_without_mutating_observed_port(self):
        neighbor, _ = database.record_discovered_neighbor({"identity": "R-CDP", "name": "R-CDP",
                         "management_ip": "192.0.2.5", "port": "Gi0/1", "ttl": 180})
        _, broadcast, _ = await self.receive(packet(agent_ip="192.0.2.5"))
        self.assertEqual(broadcast.call_args_list[0].args[0]["event"]["dev"], neighbor["id"])
        self.assertEqual(database.get_events()[0]["dev_name"], "R-CDP")
        observed = next(d for d in database.get_all_devices() if d["id"] == neighbor["id"])
        self.assertEqual(observed["ports"][0]["oper"], "unknown")

    def test_shared_nat_without_identity_cannot_be_guessed_from_identical_interfaces(self):
        self.assertIsNone(match_trap_device(database.get_all_devices(), "198.51.100.9"))
        database.save_device({**device(), "id": "gateway", "ip": "198.51.100.9"})
        self.assertIsNone(match_trap_device(database.get_all_devices(), "198.51.100.9", "192.0.2.99"))
        database.save_device({**device(), "id": "dup", "ip": "192.0.2.9", "name": "R2.example"})
        self.assertIsNone(match_trap_device(database.get_all_devices(), "198.51.100.9", agent_name="R2"))

    def test_interface_address_and_status_oid_index_fallback(self):
        self.assertEqual(match_trap_device(database.get_all_devices(), "192.0.2.22")["id"], "r2")
        self.assertEqual(trap_interface_index({"1.3.6.1.2.1.2.2.1.8.2": "2"}), 2)

    def test_legacy_schema_migration_preserves_history_and_reads_identity_from_varbinds(self):
        conn = database.get_db()
        conn.execute("DROP TABLE events")
        conn.execute("CREATE TABLE events (id TEXT PRIMARY KEY, timestamp TEXT, device_id TEXT, source_ip TEXT, port_name TEXT, type TEXT, oid TEXT, raw_varbinds TEXT)")
        conn.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     ("legacy", "2026-01-01T00:00:00", "unknown", "198.51.100.9", "Gi0/1", "linkUp",
                      trap_receiver.OID_LINK_UP, json.dumps({"1.3.6.1.2.1.1.5.0": "R2"})))
        conn.commit()
        conn.close()
        database.init_db()
        database.init_db()
        row = database.get_events()[0]
        self.assertEqual((row["id"], row["t"], row["dev"]), ("legacy", "2026-01-01T00:00:00", "r2"))
