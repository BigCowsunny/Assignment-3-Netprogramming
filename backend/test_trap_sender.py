"""
Test SNMP Trap Sender Utility
Sends real SNMPv2c linkDown / linkUp Traps via UDP 162
Can be run from command line to verify the Trap Receiver and real-time WebUI push

Usage examples:
    python test_trap_sender.py --type linkDown --if-name GigabitEthernet0/1 --if-index 1
    python test_trap_sender.py --type linkUp --if-name GigabitEthernet0/1 --if-index 1
    python test_trap_sender.py --target 192.168.1.50 --port 162 --type linkDown
"""

import argparse
import asyncio
import sys
from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine,
    CommunityData,
    UdpTransportTarget,
    ContextData,
    NotificationType,
    ObjectIdentity,
    ObjectType,
    send_notification,
)
from pysnmp.proto.rfc1902 import Integer32, OctetString

OID_LINK_DOWN = "1.3.6.1.6.3.1.1.5.3"
OID_LINK_UP = "1.3.6.1.6.3.1.1.5.4"


async def send_snmp_trap(target_ip: str, port: int, trap_type: str, if_index: int, if_name: str, community: str):
    is_down = trap_type.lower() == "linkdown"
    trap_oid = OID_LINK_DOWN if is_down else OID_LINK_UP
    admin_val = 2 if is_down else 1
    oper_val = 2 if is_down else 1

    print(f"[*] Sending SNMPv2c {trap_type} Trap to {target_ip}:{port}...")
    print(f"    - Trap OID: {trap_oid}")
    print(f"    - Community: {community}")
    print(f"    - Interface: {if_name} (ifIndex={if_index})")
    print(f"    - OperStatus: {oper_val} ({'down' if is_down else 'up'})")

    try:
        engine = SnmpEngine()
        transport = await UdpTransportTarget.create((target_ip, port), timeout=2.0, retries=1)

        errorIndication, errorStatus, errorIndex, varBinds = await send_notification(
            engine,
            CommunityData(community),
            transport,
            ContextData(),
            "trap",
            NotificationType(
                ObjectIdentity(trap_oid)
            ).add_varbinds(
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.1." + str(if_index)), Integer32(if_index)),
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.7." + str(if_index)), Integer32(admin_val)),
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.8." + str(if_index)), Integer32(oper_val)),
                ObjectType(ObjectIdentity("1.3.6.1.2.1.2.2.1.2." + str(if_index)), OctetString(if_name)),
            )
        )

        if errorIndication:
            print(f"[!] Error sending trap: {errorIndication}")
            return False

        print(f"[+] Successfully sent {trap_type} Trap to {target_ip}:{port}!")
        return True
    except Exception as e:
        print(f"[!] Exception during trap transmission: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="SNMP Test Trap Sender for Network Monitor")
    parser.add_argument("--target", default="127.0.0.1", help="Target IP running SNMP Monitor (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=162, help="Target UDP port (default: 162)")
    parser.add_argument("--type", choices=["linkDown", "linkUp"], default="linkDown", help="Trap type: linkDown or linkUp")
    parser.add_argument("--if-index", type=int, default=1, help="Interface Index (default: 1)")
    parser.add_argument("--if-name", default="Gi0/1", help="Interface name (default: Gi0/1)")
    parser.add_argument("--community", default="public", help="SNMP community string (default: public)")

    args = parser.parse_args()
    success = asyncio.run(send_snmp_trap(args.target, args.port, args.type, args.if_index, args.if_name, args.community))
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
