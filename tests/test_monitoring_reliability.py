"""Regression coverage for SNMP telemetry, real UDP traps and discovery races.

Uses an isolated SQLite file and synthetic SNMP packets; never changes a router.
"""
import asyncio
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import database
import discovery
import poller
import snmp_engine
import trap_receiver
from device_types import classify_device
from pyasn1.codec.ber import encoder
from pysnmp.proto import api
from pysnmp.proto.rfc1902 import Integer32, ObjectIdentifier, ObjectName, OctetString
from pysnmp.proto.rfc1905 import NoSuchObject
from pysnmp.smi.view import MibViewController


def device():
    return {"id": "r1", "ip": "192.0.2.1", "name": "R1", "community": "saved-rw",
            "snmp_port": 161, "type": "router", "status": "online", "ports": [
                {"idx": 2, "name": "Gi0/1", "admin": "up", "oper": "up", "speed": 1000,
                 "ip": "127.0.0.1"}]}


def packet(version=1, up=False, index=True):
    proto = api.v1 if version == 0 else api.v2c
    pdu = proto.TrapPDU() if version == 0 else proto.SNMPv2TrapPDU()
    helper = proto.apiTrapPDU if version == 0 else proto.apiPDU
    helper.set_defaults(pdu)
    values = [("1.3.6.1.2.1.2.2.1.7.2", Integer32(1)),
              ("1.3.6.1.2.1.2.2.1.8.2", Integer32(1 if up else 2))]
    if index:
        values.insert(0, ("1.3.6.1.2.1.2.2.1.1.2", Integer32(2)))
    if version == 0:
        helper.set_generic_trap(pdu, 3 if up else 2)
    else:
        values.insert(0, (trap_receiver.OID_SNMP_TRAP_OID,
                          ObjectIdentifier(trap_receiver.OID_LINK_UP if up else trap_receiver.OID_LINK_DOWN)))
    helper.set_varbinds(pdu, values)
    msg = proto.Message()
    proto.apiMessage.set_defaults(msg)
    proto.apiMessage.set_community(msg, "notification-community")
    proto.apiMessage.set_pdu(msg, pdu)
    return encoder.encode(msg)


class DatabaseCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.original = database.DB_PATH
        database.DB_PATH = str(Path(self.folder.name) / "monitor.db")
        database.init_db()
        database.save_device(device())
        poller._prev_counters.clear()
        poller._prev_uptime.clear()

    def tearDown(self):
        database.DB_PATH = self.original
        self.folder.cleanup()

    async def test_poll_does_not_overwrite_new_credential_or_recreate_deleted_device(self):
        for remove in (False, True):
            database.save_device(device())
            old = database.get_device("r1")
            async def probe(*args, **kwargs):
                if remove:
                    database.delete_device("r1")
                else:
                    database.save_device({**old, "community": "new-rw"})
                return {"ok": True, "uptime_ticks": 100}
            with patch.object(poller, "snmp_get_system_info", probe), \
                 patch.object(poller, "snmp_poll_octets", new_callable=AsyncMock) as octets:
                await poller.poll_device_metrics(old)
                octets.assert_not_awaited()
            self.assertEqual(database.get_device("r1") is None, remove)
            if not remove:
                self.assertEqual(database.get_device("r1")["community"], "new-rw")

    async def poll_samples(self, samples, uptimes, speed=1000):
        dev = database.get_device("r1")
        dev["ports"][0]["speed"] = speed
        database.save_device(dev)
        with patch.object(poller, "snmp_get_system_info", new=AsyncMock(side_effect=[
                {"ok": True, "uptime_ticks": value} for value in uptimes])), \
             patch.object(poller, "snmp_poll_octets", new=AsyncMock(side_effect=[{2: s} for s in samples])), \
             patch.object(poller.time, "monotonic", side_effect=[100 + 10 * i for i in range(len(samples))]), \
             patch.object(poller, "save_traffic_sample") as save:
            for _ in samples:
                await poller.poll_device_metrics(dev)
        return save

    def sample(self, value, bits=64, disc=0):
        return {"in_octets": value, "out_octets": value,
                "in_octets_bits": bits, "out_octets_bits": bits, "discontinuity": disc}

    async def test_valid_delta_and_reboot_discontinuity_do_not_spike(self):
        save = await self.poll_samples([self.sample(100), self.sample(300), self.sample(1),
                                        self.sample(10, disc=2), self.sample(110, disc=2)],
                                       [1000, 2000, 5, 1005, 2005])
        self.assertEqual(save.call_count, 2)
        self.assertEqual([c.args[-2:] for c in save.call_args_list], [(160.0, 160.0), (80.0, 80.0)])

    async def test_64bit_drop_is_not_mistaken_for_32bit_wrap(self):
        save = await self.poll_samples([self.sample(10000), self.sample(100)], [100, 1100])
        save.assert_not_called()

    async def test_real_32bit_wrap_and_ambiguous_multiple_wrap(self):
        save = await self.poll_samples([self.sample(2**32 - 100, 32), self.sample(100, 32)], [100, 1100], speed=100)
        self.assertEqual(save.call_args.args[-2:], (160.0, 160.0))
        poller._prev_counters.clear()
        save = await self.poll_samples([self.sample(100, 32), self.sample(200, 32)], [2100, 3100], speed=10000)
        save.assert_not_called()

    async def test_aggregate_averages_each_port_before_summing(self):
        with patch.object(database.time, "time", return_value=1800000000):
            for value in (100, 100, 100):
                database.save_traffic_sample("r1", "Gi0/1", 0, 0, value, value)
            database.save_traffic_sample("r1", "Gi0/2", 0, 0, 200, 200)
            self.assertEqual(database.get_aggregate_traffic()[0]["in"], 300)

    async def test_duplicate_normalized_link_in_one_snapshot(self):
        database.save_device({**device(), "id": "r2", "ip": "192.0.2.2"})
        link = {"a": "r1", "pa": "Gi0/1", "b": "r2", "pb": "Gi0/1"}
        database.replace_topology_observations("r1", "CDP", [link, {**link, "pa": "GigabitEthernet0/1"}])
        self.assertEqual(len(database.get_topology_links()), 1)

    async def test_discovery_does_not_replace_rw_with_fallback_ro(self):
        with patch.object(discovery, "snmp_get_system_info", new=AsyncMock(side_effect=[{"ok": False}, {"ok": True}])), \
             patch.object(discovery, "snmp_walk_interfaces", new=AsyncMock(return_value=device()["ports"])), \
             patch.object(discovery, "read_neighbors", new=AsyncMock(return_value=[])):
            await discovery.discover_network(community="fallback-ro")
        self.assertEqual(database.get_device("r1")["community"], "saved-rw")

    async def test_discovery_skips_stale_settings_and_partial_interfaces(self):
        async def ports(*args):
            database.save_device({**device(), "community": "edited-rw"})
            return device()["ports"]
        with patch.object(discovery, "snmp_get_system_info", new=AsyncMock(return_value={"ok": True})), \
             patch.object(discovery, "snmp_walk_interfaces", ports), \
             patch.object(discovery, "read_neighbors", new_callable=AsyncMock) as read:
            result = await discovery.discover_network()
            read.assert_not_awaited()
        self.assertEqual(result["issues"][0]["code"], "settings_changed")
        self.assertEqual(database.get_device("r1")["community"], "edited-rw")
        with patch.object(discovery, "snmp_get_system_info", new=AsyncMock(return_value={"ok": True})), \
             patch.object(discovery, "snmp_walk_interfaces", new=AsyncMock(return_value=snmp_engine.InterfaceRows(device()["ports"], False))):
            result = await discovery.discover_network()
        self.assertEqual(result["issues"][0]["code"], "interfaces_unavailable")

    async def test_udp_v1_v2_receipt_persists_and_broadcasts_using_interface_source_ip(self):
        loop = asyncio.get_running_loop()
        receiver, protocol = await loop.create_datagram_endpoint(trap_receiver.SnmpTrapProtocol, local_addr=("127.0.0.1", 0))
        sender, _ = await loop.create_datagram_endpoint(asyncio.DatagramProtocol, remote_addr=receiver.get_extra_info("sockname"))
        try:
            with patch.object(trap_receiver.ws_manager, "broadcast", new_callable=AsyncMock) as broadcast, \
                 patch.object(trap_receiver, "_discover_from_trap", new_callable=AsyncMock) as enroll:
                for version, up in ((0, False), (1, True)):
                    delivered = asyncio.Event()
                    async def receive(message):
                        delivered.set()
                    broadcast.side_effect = receive
                    sender.sendto(packet(version, up))
                    await asyncio.wait_for(delivered.wait(), timeout=2)
                    port = database.get_device("r1")["ports"][0]
                    self.assertEqual(port["oper"], "up" if up else "down")
                    self.assertEqual(broadcast.call_args.args[0]["event"]["dev"], "r1")
                enroll.assert_not_awaited()
                self.assertEqual(len(database.get_events()), 2)
        finally:
            sender.close()
            receiver.close()
            await asyncio.sleep(0)

    async def test_unknown_sender_event_survives_failed_enrollment(self):
        parsed = trap_receiver.SnmpTrapProtocol().parse_trap(packet(), "192.0.2.99")
        async def enroll(*args):
            self.assertEqual(len(database.get_events()), 1)
            return None
        with patch.object(trap_receiver, "_discover_from_trap", enroll), \
             patch.object(trap_receiver.ws_manager, "broadcast", new_callable=AsyncMock):
            await trap_receiver.SnmpTrapProtocol().handle_parsed_trap(parsed)
        self.assertEqual(database.get_events()[0]["src"], "192.0.2.99")


class SnmpReadTests(unittest.IsolatedAsyncioTestCase):
    def test_cisco_router_with_switch_capability_keeps_router_type(self):
        self.assertEqual(classify_device("Cisco CISCO2901/K9", 0x29), "router")
        self.assertEqual(classify_device("Cisco vios_l2", 0x29), "switch")
        self.assertEqual(classify_device("unknown", 8), "switch")

    async def test_missing_system_oids_is_not_success(self):
        with patch.object(snmp_engine.UdpTransportTarget, "create", new=AsyncMock(return_value=object())), \
             patch.object(snmp_engine, "get_cmd", new=AsyncMock(return_value=(None, 0, 0, [
                 (ObjectName(snmp_engine.OID_SYS_DESCR), NoSuchObject())]))):
            result = await snmp_engine.snmp_get_system_info("192.0.2.1")
        self.assertFalse(result["ok"])

    async def test_32bit_fallback_without_explicit_indices_preserves_width(self):
        async def walk(engine, credentials, target, context, obj, **kwargs):
            obj.resolve_with_mib(MibViewController(engine.get_mib_builder()))
            oid = str(obj[0])
            if oid in (snmp_engine.OID_IF_IN_OCTETS, snmp_engine.OID_IF_OUT_OCTETS):
                yield None, 0, 0, [(ObjectName(oid + ".2"), Integer32(123))]
        with patch.object(snmp_engine.UdpTransportTarget, "create", new=AsyncMock(return_value=object())), \
             patch.object(snmp_engine, "walk_cmd", walk):
            result = await snmp_engine.snmp_poll_octets("192.0.2.1")
        self.assertEqual(result[2]["in_octets"], 123)
        self.assertEqual(result[2]["out_octets_bits"], 32)

    async def test_high_speed_ip_mapping_and_partial_walk(self):
        failed = False
        async def walk(engine, credentials, target, context, obj, **kwargs):
            obj.resolve_with_mib(MibViewController(engine.get_mib_builder()))
            oid = str(obj[0])
            data = {snmp_engine.OID_IF_DESCR: OctetString("GigabitEthernet0/1"),
                    snmp_engine.OID_IF_ADMIN_STATUS: Integer32(1),
                    snmp_engine.OID_IF_OPER_STATUS: Integer32(1),
                    snmp_engine.OID_IF_HIGH_SPEED: Integer32(10000)}
            if oid == snmp_engine.OID_IF_DESCR and failed:
                yield "timeout", 0, 0, []
            elif oid in data:
                yield None, 0, 0, [(ObjectName(oid + ".2"), data[oid])]
            elif oid == snmp_engine.OID_IP_IFINDEX:
                yield None, 0, 0, [(ObjectName(oid + ".192.0.2.1"), Integer32(2))]
        with patch.object(snmp_engine.UdpTransportTarget, "create", new=AsyncMock(return_value=object())), \
             patch.object(snmp_engine, "walk_cmd", walk):
            rows = await snmp_engine.snmp_walk_interfaces("192.0.2.1")
            self.assertTrue(rows.complete)
            self.assertEqual(rows[0]["speed"], 10000)
            self.assertEqual(rows[0]["ip"], "192.0.2.1")
            failed = True
            self.assertFalse((await snmp_engine.snmp_walk_interfaces("192.0.2.1")).complete)

    async def test_trap_index_from_status_suffix_and_malformed_packet(self):
        receiver = trap_receiver.SnmpTrapProtocol()
        for version in (0, 1):
            self.assertEqual(receiver.parse_trap(packet(version, index=False), "192.0.2.1")["if_index"], 2)
        for raw in (b"invalid", packet()[:-3], packet() + b"extra"):
            self.assertIsNone(receiver.parse_trap(raw, "192.0.2.1"))


if __name__ == "__main__":
    unittest.main()
