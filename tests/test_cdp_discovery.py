"""Regression tests; use temporary SQLite and synthetic packets, never real SETs."""

import asyncio
import ipaddress
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import database
import discovery
import main
import poller
import snmp_engine
from cdp_receiver import CDP_DESTINATION, CDP_SNAP, CdpCapture, parse_cdp_frame
from fastapi.testclient import TestClient
from pysnmp.proto import api
from pyasn1.codec.ber import encoder
from pysnmp.proto.rfc1902 import Integer32, ObjectName, OctetString, ObjectIdentifier
from trap_receiver import SnmpTrapProtocol


def tlv(kind, value):
    return struct.pack("!HH", kind, len(value) + 4) + value


def address_tlv(ip, kind=2):
    value = struct.pack("!I", 1) + b"\x01\x01\xcc\x00\x04" + ipaddress.IPv4Address(ip).packed
    return tlv(kind, value)


def frame(name="SW-No-IP", port="Gi0/1", ip="", version=2, ttl=180, vlan=False):
    payload = CDP_SNAP + bytes((version, ttl, 0, 0))
    payload += tlv(1, name.encode()) + tlv(3, port.encode()) + tlv(4, struct.pack("!I", 8))
    payload += tlv(6, b"Cisco Test Switch")
    if ip:
        payload += address_tlv(ip)
    prefix = CDP_DESTINATION + bytes.fromhex("001122334455")
    if vlan:
        prefix += bytes.fromhex("81000064")
    return prefix + struct.pack("!H", len(payload)) + payload


def managed_device(device_id="managed", name="Core", ip="192.0.2.1"):
    return {"id": device_id, "name": name, "ip": ip, "community": "test-rw",
            "status": "online", "type": "switch", "ports": [
                {"idx": 7, "name": "GigabitEthernet0/1", "speed": 1000,
                 "admin": "up", "oper": "up"}]}


class ParserTests(unittest.TestCase):
    def test_cdp_without_ip(self):
        result = parse_cdp_frame(frame(), "Ethernet")
        self.assertEqual(result["management_ip"], "")
        self.assertEqual(result["source_mac"], "00:11:22:33:44:55")
        self.assertEqual(result["device_type"], "switch")
        self.assertEqual(result["capture_interface"], "Ethernet")

    def test_v1_and_vlan(self):
        for version in (1, 2):
            with self.subTest(version=version):
                self.assertEqual(parse_cdp_frame(frame(version=version, vlan=True))["identity"], "SW-No-IP")

    def test_ipv4(self):
        self.assertEqual(parse_cdp_frame(frame(ip="192.0.2.10"))["management_ip"], "192.0.2.10")

    def test_management_address_tlv(self):
        raw = frame()
        payload = raw[14:] + address_tlv("198.51.100.2", 0x16)
        raw = raw[:12] + struct.pack("!H", len(payload)) + payload
        self.assertEqual(parse_cdp_frame(raw)["management_ip"], "198.51.100.2")

    def test_zero_address_is_unmanaged(self):
        self.assertEqual(parse_cdp_frame(frame(ip="0.0.0.0"))["management_ip"], "")

    def test_withdrawal_ttl_zero(self):
        self.assertEqual(parse_cdp_frame(frame(ttl=0))["ttl"], 0)

    def test_malformed_and_other_protocol_are_ignored(self):
        raw = frame()
        for malformed in (b"", raw[:20], raw[:-1], b"\xff" * 6 + raw[6:],
                          raw[:14] + b"\x00" * 8 + raw[22:], frame(version=3)):
            with self.subTest(length=len(malformed)):
                self.assertIsNone(parse_cdp_frame(malformed))

    def test_invalid_tlv_length(self):
        raw = frame()
        self.assertIsNone(parse_cdp_frame(raw[:28] + b"\x00\x03" + raw[30:]))

    def test_truncated_address_record(self):
        payload = frame()[14:] + tlv(2, struct.pack("!I", 1) + b"\x01")
        raw = frame()[:12] + struct.pack("!H", len(payload)) + payload
        self.assertIsNone(parse_cdp_frame(raw))

    def test_real_scapy_packet_and_offline_pcap(self):
        from scapy.all import Dot3, LLC, SNAP, sniff, wrpcap
        from scapy.contrib.cdp import CDPv2_HDR, CDPMsgDeviceID, CDPMsgPortID, CDPMsgCapabilities
        packet = (Dot3(dst="01:00:0c:cc:cc:cc", src="00:11:22:33:44:55") /
                  LLC(dsap=0xaa, ssap=0xaa, ctrl=3) / SNAP(OUI=0x00000c, code=0x2000) /
                  CDPv2_HDR(vers=2, ttl=180, msg=[CDPMsgDeviceID(val=b"Scapy-SW"),
                  CDPMsgPortID(iface=b"GigabitEthernet0/1"), CDPMsgCapabilities(cap=8)]))
        self.assertEqual(parse_cdp_frame(bytes(packet))["name"], "Scapy-SW")
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "cdp.pcap")
            wrpcap(path, [packet])
            found = []
            sniff(offline=path, store=False, prn=lambda pkt: found.append(parse_cdp_frame(bytes(pkt))))
            self.assertEqual(found[0]["name"], "Scapy-SW")


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.original_path = database.DB_PATH
        database.DB_PATH = str(Path(self.folder.name) / "test.db")
        database.init_db()

    def tearDown(self):
        database.DB_PATH = self.original_path
        self.folder.cleanup()

    def neighbor(self, name="SW-No-IP", **kwargs):
        return database.record_discovered_neighbor({"identity": name, "name": name,
                   "port": "Gi0/1", "ttl": 180, **kwargs})[0]

    def test_many_devices_with_no_ip_persist(self):
        first, second = self.neighbor("SW-A"), self.neighbor("SW-B")
        database.init_db()
        devices = database.get_all_devices()
        self.assertEqual(len(devices), 2)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual([device["ip"] for device in devices], ["", ""])

    def test_repeat_and_multiport_do_not_duplicate(self):
        first = self.neighbor()
        second = self.neighbor("sw-no-ip", port="GigabitEthernet0/2")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(database.get_all_devices()), 1)
        self.assertEqual({port["name"] for port in second["ports"]}, {"GigabitEthernet0/1", "GigabitEthernet0/2"})

    def test_discovery_never_claims_snmp_or_interface_status(self):
        device = self.neighbor()
        self.assertTrue(device["discovery_only"])
        self.assertFalse(device["can_configure"])
        self.assertEqual(device["status"], "discovered")
        self.assertIn("Management IP", device["config_unavailable_reason"])
        self.assertEqual(device["ports"][0]["oper"], "unknown")
        self.assertEqual(device["ports"][0]["idx"], 0)

    def test_advertised_ip_is_not_verified(self):
        device = self.neighbor(management_ip="192.0.2.10")
        self.assertFalse(device["can_configure"])
        self.assertIn("ยังไม่ได้ยืนยัน SNMP", device["config_unavailable_reason"])

    def test_ttl_expiry_preserves_offline_inventory(self):
        with patch.object(database.time, "time", return_value=1000):
            device = self.neighbor(ttl=30)
        with patch.object(database.time, "time", return_value=1031):
            self.assertEqual(database.get_device(device["id"])["status"], "offline")

    def test_invalid_ip_does_not_enable_config(self):
        for ip in ("0.0.0.0", "127.0.0.1", "224.0.0.1", "not-an-ip"):
            self.assertEqual(self.neighbor(management_ip=ip)["ip"], "")

    def test_known_neighbor_does_not_overwrite_inventory(self):
        database.save_device(managed_device(name="SW-No-IP"))
        discovered = self.neighbor()
        self.assertEqual(discovered["id"], "managed")
        self.assertFalse(discovered["discovery_only"])
        self.assertEqual(discovered["community"], "test-rw")
        self.assertEqual(discovered["ports"][0]["idx"], 7)
        self.assertEqual(len(database.get_all_devices()), 1)

    def test_full_interface_names_are_not_corrupted(self):
        self.assertEqual(database.normalize_port_name("GigabitEthernet0/1"), "GigabitEthernet0/1")
        self.assertEqual(database.normalize_port_name("Gi0/1"), "GigabitEthernet0/1")

    def test_delete_observation(self):
        device = self.neighbor()
        database.delete_device(device["id"])
        self.assertEqual(database.get_all_devices(), [])

    def test_api_blocks_config_before_snmp_and_handles_slash(self):
        device = self.neighbor()
        client = TestClient(main.app)
        with patch.object(main, "snmp_set_admin_status", new_callable=AsyncMock) as send:
            response = client.post(f'/api/interfaces/{device["id"]}/GigabitEthernet0%2F1/admin-status', json={"status": "down"})
            self.assertEqual(response.status_code, 409)
            send.assert_not_awaited()
        self.assertEqual(client.get(f'/api/interfaces/{device["id"]}/GigabitEthernet0%2F1/traffic').status_code, 409)

    def test_managed_slash_route_still_sends_set(self):
        database.save_device(managed_device())
        client = TestClient(main.app)
        with patch.object(main, "snmp_set_admin_status", new=AsyncMock(return_value={"ok": True, "admin": "down", "oper": "down"})) as send:
            response = client.post('/api/interfaces/managed/GigabitEthernet0%2F1/admin-status', json={"status": "down"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(send.await_args.kwargs["if_index"], 7)
        self.assertEqual(client.get('/api/interfaces/managed/GigabitEthernet0%2F1/traffic').status_code, 200)

    def test_successful_promotion_preserves_id_and_links(self):
        database.save_device(managed_device())
        device = self.neighbor()
        database.save_topology_link("managed", "GigabitEthernet0/1", device["id"], "GigabitEthernet0/1", "CDP")
        client = TestClient(main.app)
        with patch.object(main, "snmp_get_system_info", new=AsyncMock(return_value={"ok": True, "name": "SW-No-IP"})), patch.object(main, "snmp_walk_interfaces", new=AsyncMock(return_value=managed_device()["ports"])):
            response = client.put(f'/api/devices/{device["id"]}', json={"name": "New label", "ip": "192.0.2.10", "community": "test-rw"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], device["id"])
        self.assertFalse(response.json()["discovery_only"])
        self.assertTrue(response.json()["can_configure"])
        self.neighbor()
        self.assertEqual(len(database.get_all_devices()), 2)
        self.assertEqual(client.get('/api/topology').json()["links"][0]["b"], device["id"])

    def test_failed_promotion_stays_unmanaged(self):
        device = self.neighbor()
        with patch.object(main, "snmp_get_system_info", new=AsyncMock(return_value={"ok": False, "error": "timeout"})):
            response = TestClient(main.app).put(f'/api/devices/{device["id"]}', json={"name": "SW", "ip": "192.0.2.10"})
        self.assertEqual(response.status_code, 422)
        self.assertTrue(database.get_device(device["id"])["discovery_only"])

    def test_promotion_rejects_duplicate_managed_ip(self):
        database.save_device(managed_device())
        device = self.neighbor()
        with patch.object(main, "snmp_get_system_info", new_callable=AsyncMock) as probe:
            response = TestClient(main.app).put(f'/api/devices/{device["id"]}', json={"name": "SW", "ip": "192.0.2.1"})
        self.assertEqual(response.status_code, 409)
        probe.assert_not_awaited()

    def test_no_ip_requests_never_probe_snmp(self):
        device = self.neighbor()
        client = TestClient(main.app)
        with patch.object(main, "snmp_get_system_info", new_callable=AsyncMock) as probe:
            for ip in ("", "0.0.0.0", "255.255.255.255"):
                for endpoint in ("/api/devices", "/api/devices/test"):
                    self.assertEqual(client.post(endpoint, json={"ip": ip}).status_code, 422)
                self.assertEqual(client.put(f'/api/devices/{device["id"]}', json={"name": "SW", "ip": ip}).status_code, 422)
            probe.assert_not_awaited()
        self.assertTrue(database.get_device(device["id"])["discovery_only"])

    def test_captured_frame_persists_and_broadcasts_to_web(self):
        from trap_receiver import ws_manager
        async def receive():
            capture = CdpCapture()
            capture._queue = asyncio.Queue(maxsize=256)
            capture._consumer = asyncio.create_task(capture._consume())
            with patch.object(ws_manager, "broadcast", new_callable=AsyncMock) as broadcast:
                capture._enqueue(parse_cdp_frame(frame(), "test-NIC"))
                await asyncio.wait_for(capture._queue.join(), timeout=2)
                message = broadcast.await_args.args[0]
                self.assertEqual(message["type"], "NEIGHBOR_DISCOVERED")
                self.assertTrue(message["is_new"])
                self.assertEqual(message["device"]["capture_interface"], "test-NIC")
                self.assertFalse(message["device"]["can_configure"])
                self.assertEqual(message["device"]["ip"], "")
            await capture.stop()
        asyncio.run(receive())
        self.assertEqual(len(database.get_all_devices()), 1)

    def test_capture_health_is_visible_in_api(self):
        health = {"status": "unavailable", "error": "Npcap required", "interfaces": [], "dropped_packets": 0}
        with patch.object(main.cdp_capture, "health", return_value=health):
            client = TestClient(main.app)
            self.assertEqual(client.get("/api/discovery/cdp/status").json(), health)
            self.assertEqual(client.get("/api/health").json()["cdp"], health)

    def test_cdp_mib_adds_unknown_neighbor_and_real_link(self):
        source = managed_device()
        database.save_device(source)
        async def rows(ip, community, oid, port=161, raw=False):
            data = {discovery.OID_CDP_CACHE_DEVICE_ID: "SW-No-IP",
                    discovery.OID_CDP_CACHE_DEVICE_PORT: "Gi0/2",
                    discovery.OID_CDP_CACHE_CAPABILITIES: b"\x00\x00\x00\x08"}
            return [(oid + ".7.1", data[oid])] if oid in data else []
        with patch.object(discovery, "_walk_column", rows):
            links = asyncio.run(discovery.discover_topology_links(database.get_all_devices()))
        self.assertEqual(len(links), 1)
        remote = database.get_device(links[0]["b"])
        self.assertEqual(remote["ip"], "")
        self.assertEqual(links[0]["pb"], "GigabitEthernet0/2")
        self.assertEqual(remote["type"], "switch")

    def test_poller_skips_discovery_only(self):
        device = self.neighbor()
        with patch.object(poller, "snmp_get_system_info", new_callable=AsyncMock) as probe:
            asyncio.run(poller.poll_device_metrics(device))
            probe.assert_not_awaited()

    def test_liveness_update_does_not_overwrite_trap(self):
        database.save_device(managed_device())
        old = database.get_device("managed")
        async def system_info(*args, **kwargs):
            database.update_interface_status("managed", "GigabitEthernet0/1", oper="down")
            return {"ok": True}
        with patch.object(poller, "snmp_get_system_info", system_info), patch.object(poller, "snmp_poll_octets", new=AsyncMock(return_value={})):
            asyncio.run(poller.poll_device_metrics(old))
        self.assertEqual(database.get_device("managed")["ports"][0]["oper"], "down")


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_snmp_walk_reads_actual_rows_with_async_generator(self):
        async def rows(engine, credentials, transport, context, obj, **options):
            from pysnmp.smi.view import MibViewController
            obj.resolve_with_mib(MibViewController(engine.get_mib_builder()))
            oid = str(obj[0])
            values = {snmp_engine.OID_IF_DESCR: OctetString("GigabitEthernet0/1"),
                      snmp_engine.OID_IF_ADMIN_STATUS: Integer32(1),
                      snmp_engine.OID_IF_OPER_STATUS: Integer32(2),
                      snmp_engine.OID_IF_SPEED: Integer32(1000000000)}
            if oid in values:
                yield (None, 0, 0, [(ObjectName(oid + ".7"), values[oid])])
        with patch.object(snmp_engine.UdpTransportTarget, "create", new=AsyncMock(return_value=object())), patch.object(snmp_engine, "walk_cmd", rows):
            interfaces = await snmp_engine.snmp_walk_interfaces("192.0.2.1")
        self.assertEqual(interfaces[0]["idx"], 7)
        self.assertEqual(interfaces[0]["oper"], "down")

    async def test_disabled_capture(self):
        capture = CdpCapture()
        with patch.dict(os.environ, {"NETFIX_CDP_ENABLED": "false"}):
            await capture.start()
        self.assertEqual(capture.health()["status"], "disabled")
        await capture.stop()

    async def test_missing_capture_dependency_is_visible(self):
        capture = CdpCapture()
        with patch.dict(sys.modules, {"scapy.all": None}):
            capture._capture()
        self.assertEqual(capture.health()["status"], "unavailable")
        self.assertTrue(capture.health()["error"])


class TrapRegressionTests(unittest.TestCase):
    def test_link_trap_identifies_port_and_rejects_non_trap(self):
        for pdu_class, expected in ((api.v2c.SNMPv2TrapPDU, True), (api.v2c.ResponsePDU, False)):
            pdu = pdu_class()
            api.v2c.apiPDU.set_defaults(pdu)
            api.v2c.apiPDU.set_varbinds(pdu, [
                ("1.3.6.1.6.3.1.1.4.1.0", ObjectIdentifier("1.3.6.1.6.3.1.1.5.3")),
                ("1.3.6.1.2.1.2.2.1.1.7", Integer32(7)),
                ("1.3.6.1.2.1.2.2.1.8.7", Integer32(2))])
            message = api.v2c.Message()
            api.v2c.apiMessage.set_defaults(message)
            api.v2c.apiMessage.set_community(message, "public")
            api.v2c.apiMessage.set_pdu(message, pdu)
            parsed = SnmpTrapProtocol().parse_trap(encoder.encode(message), "192.0.2.1")
            if expected:
                self.assertEqual(parsed["if_index"], 7)
                self.assertEqual(parsed["oper"], "down")
            else:
                self.assertIsNone(parsed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
