"""SNMP SET checks with mocked transport; these tests never contact a device."""

from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from pysnmp.proto.rfc1902 import Integer32, ObjectName
from pysnmp.proto.rfc1905 import NoSuchInstance
import snmp_engine
import main


def status_error(name):
    error = MagicMock()
    error.prettyPrint.return_value = name
    return error


def response(oid, value):
    return (None, 0, 0, [(ObjectName(oid), value)])


class InterfaceControlTests(unittest.IsolatedAsyncioTestCase):
    async def send(self, set_result, reads=()):
        engine = MagicMock()
        with patch.object(snmp_engine, "SnmpEngine", return_value=engine), \
             patch.object(snmp_engine.UdpTransportTarget, "create", new=AsyncMock(return_value=object())), \
             patch.object(snmp_engine, "set_cmd", new=AsyncMock(return_value=set_result)) as setter, \
             patch.object(snmp_engine, "get_cmd", new=AsyncMock(side_effect=reads)) as getter:
            result = await snmp_engine.snmp_set_admin_status("192.0.2.1", "test-community", 2, 1)
        setter.assert_awaited_once()
        engine.close_dispatcher.assert_called_once()
        return result, getter

    async def test_access_denied_explains_community_and_view(self):
        for code in ("noAccess", "authorizationError"):
            with self.subTest(code=code):
                result, getter = await self.send((None, status_error(code), 1, []))
                self.assertFalse(result["ok"])
                self.assertEqual(result["error_code"], code)
                self.assertIn("RW", result["error"])
                self.assertIn("ACL/SNMP View", result["error"])
                self.assertNotIn("test-community", result["error"])
                getter.assert_not_awaited()

    async def test_unwritable_interface_reports_agent_error(self):
        for code in ("notWritable", "noSuchName", "noCreation"):
            with self.subTest(code=code):
                result, getter = await self.send((None, status_error(code), 1, []))
                self.assertFalse(result["ok"])
                self.assertEqual(result["error_code"], code)
                self.assertIn("ifIndex", result["error"])
                getter.assert_not_awaited()

    async def test_timeout_is_not_success(self):
        result, getter = await self.send(("No SNMP response received before timeout", 0, 0, []))
        self.assertFalse(result["ok"])
        self.assertIn("timeout", result["error"])
        getter.assert_not_awaited()

    async def test_admin_up_and_oper_down_is_successfully_enabled(self):
        result, getter = await self.send((None, 0, 0, []), [
            response(snmp_engine.OID_IF_ADMIN_STATUS + ".2", Integer32(1)),
            response(snmp_engine.OID_IF_OPER_STATUS + ".2", Integer32(2)),
        ])
        self.assertTrue(result["ok"])
        self.assertEqual(result["admin"], "up")
        self.assertEqual(result["oper"], "down")
        self.assertEqual(getter.await_count, 2)

    async def test_readback_mismatch_is_not_success(self):
        result, getter = await self.send((None, 0, 0, []), [
            response(snmp_engine.OID_IF_ADMIN_STATUS + ".2", Integer32(2)),
        ])
        self.assertFalse(result["ok"])
        self.assertIn("ifAdminStatus", result["error"])
        self.assertEqual(getter.await_count, 1)

    async def test_readback_timeout_is_not_success(self):
        result, _ = await self.send((None, 0, 0, []), [("timeout", 0, 0, [])])
        self.assertFalse(result["ok"])

    async def test_missing_admin_oid_is_not_success(self):
        result, _ = await self.send((None, 0, 0, []), [
            response(snmp_engine.OID_IF_ADMIN_STATUS + ".2", NoSuchInstance()),
        ])
        self.assertFalse(result["ok"])

    async def test_unknown_agent_error_is_preserved(self):
        result, getter = await self.send((None, status_error("resourceUnavailable"), 1, []))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_code"], "resourceUnavailable")
        getter.assert_not_awaited()

    async def test_api_access_denial_does_not_change_stored_port(self):
        device = {"id": "router-test", "ip": "192.0.2.1", "name": "Router", "community": "test-community",
                  "ports": [{"name": "Gi0/1", "idx": 2, "admin": "down", "oper": "down"}]}
        denial = {"ok": False, "error": "Access denied", "error_code": "noAccess"}
        with patch.object(main, "get_device", return_value=device), \
             patch.object(main, "snmp_set_admin_status", new=AsyncMock(return_value=denial)), \
             patch.object(main, "update_interface_status") as update, \
             patch.object(main, "add_audit_log") as audit, \
             patch.object(main.ws_manager, "broadcast", new_callable=AsyncMock) as broadcast:
            result = await main.set_port_admin_status("router-test", "Gi0/1", main.InterfaceAdminRequest(status="up"))
        self.assertFalse(result["ok"])
        update.assert_not_called()
        broadcast.assert_not_awaited()
        self.assertIn("noAccess", audit.call_args.args[-1])
        self.assertEqual(device["ports"][0]["admin"], "down")

    async def test_api_persists_readback_and_broadcasts_oper_down(self):
        device = {"id": "router-test", "ip": "192.0.2.1", "name": "Router", "community": "test-community",
                  "ports": [{"name": "Gi0/1", "idx": 2, "admin": "down", "oper": "down"}]}
        with patch.object(main, "get_device", return_value=device), \
             patch.object(main, "snmp_set_admin_status", new=AsyncMock(return_value={"ok": True, "admin": "up", "oper": "down"})), \
             patch.object(main, "update_interface_status") as update, \
             patch.object(main, "add_audit_log"), \
             patch.object(main.ws_manager, "broadcast", new_callable=AsyncMock) as broadcast:
            result = await main.set_port_admin_status("router-test", "Gi0/1", main.InterfaceAdminRequest(status="up"))
        self.assertTrue(result["ok"])
        update.assert_called_once_with("router-test", "Gi0/1", admin="up", oper="down")
        self.assertEqual(broadcast.await_args.args[0]["oper"], "down")


if __name__ == "__main__":
    unittest.main(verbosity=2)
