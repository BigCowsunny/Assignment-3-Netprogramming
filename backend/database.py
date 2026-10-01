"""
Database module for SNMP Network Monitor
Uses SQLite with WAL mode for fast concurrency between Poller, Trap Receiver, and API
"""

import sqlite3
import json
import time
import os
import hashlib
import ipaddress
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "snmp_monitor.db")


def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ip TEXT NOT NULL UNIQUE,
        snmp_version TEXT DEFAULT 'v2c',
        community TEXT DEFAULT 'public',
        snmp_port INTEGER DEFAULT 161,
        device_type TEXT DEFAULT 'switch',
        vendor TEXT,
        sys_descr TEXT,
        status TEXT DEFAULT 'online',
        up_time TEXT,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS interfaces (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        if_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        speed INTEGER DEFAULT 1000,
        admin_status TEXT DEFAULT 'up',
        oper_status TEXT DEFAULT 'up',
        errors INTEGER DEFAULT 0,
        mac TEXT,
        alias TEXT,
        virtual INTEGER DEFAULT 0,
        ip TEXT,
        FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS traffic_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        port_name TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        in_octets INTEGER,
        out_octets INTEGER,
        in_bps REAL,
        out_bps REAL
    );

    CREATE INDEX IF NOT EXISTS idx_traffic_dev_port ON traffic_samples(device_id, port_name, timestamp);

    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_ip TEXT NOT NULL,
        port_name TEXT NOT NULL,
        type TEXT NOT NULL,
        oid TEXT NOT NULL,
        raw_varbinds TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp DESC);

    CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        user TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        result TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topology_links (
        id TEXT PRIMARY KEY,
        device_a TEXT NOT NULL,
        port_a TEXT NOT NULL,
        device_b TEXT NOT NULL,
        port_b TEXT NOT NULL,
        protocol TEXT DEFAULT 'LLDP'
    );

    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discovered_neighbors (
        id TEXT PRIMARY KEY,
        identity TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        source_mac TEXT DEFAULT '',
        management_ip TEXT DEFAULT '',
        device_type TEXT DEFAULT 'switch',
        platform TEXT DEFAULT '',
        description TEXT DEFAULT '',
        protocol TEXT DEFAULT 'CDP',
        capture_interface TEXT DEFAULT '',
        ports_json TEXT DEFAULT '[]',
        last_seen REAL NOT NULL,
        expires_at REAL NOT NULL
    );
    """)

    device_columns = {row[1] for row in cursor.execute("PRAGMA table_info(devices)").fetchall()}
    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS neighbor_aliases (
        alias TEXT NOT NULL, device_id TEXT NOT NULL, PRIMARY KEY (alias, device_id));
    CREATE TABLE IF NOT EXISTS topology_observations (
        observer_id TEXT NOT NULL, protocol TEXT NOT NULL, link_key TEXT NOT NULL,
        device_a TEXT NOT NULL, port_a TEXT NOT NULL, device_b TEXT NOT NULL, port_b TEXT NOT NULL,
        last_seen REAL NOT NULL, expires_at REAL NOT NULL,
        PRIMARY KEY (observer_id, protocol, link_key));
    """)
    neighbor_columns = {row[1] for row in cursor.execute("PRAGMA table_info(discovered_neighbors)")}
    for column in ("device_identity", "chassis_id"):
        if column not in neighbor_columns:
            cursor.execute(f"ALTER TABLE discovered_neighbors ADD COLUMN {column} TEXT DEFAULT ''")
    cursor.execute("UPDATE discovered_neighbors SET device_identity=identity WHERE device_identity=''")
    for row in cursor.execute("SELECT * FROM discovered_neighbors").fetchall():
        for alias in (f"ip:{row['management_ip']}" if row["management_ip"] else "",
                      f"mac:{normalize_mac(row['source_mac'])}" if normalize_mac(row["source_mac"]) else "",
                      f"chassis:{row['chassis_id']}" if row["chassis_id"] else ""):
            if alias:
                cursor.execute("INSERT OR IGNORE INTO neighbor_aliases VALUES (?,?)", (alias, row["id"]))
    # Upgrade older permanent discovery edges to expiring observations once.
    # Keep the data visible during migration without renewing it on each restart.
    now = time.time()
    for row in cursor.execute("SELECT * FROM topology_links WHERE protocol IN ('CDP','LLDP')").fetchall():
        key = json.dumps(sorted(((row["device_a"], normalize_port_name(row["port_a"]).lower()),
                                 (row["device_b"], normalize_port_name(row["port_b"]).lower()))))
        cursor.execute("INSERT OR IGNORE INTO topology_observations VALUES (?,?,?,?,?,?,?,?,?)",
                       (row["device_a"], row["protocol"], key, row["device_a"], row["port_a"],
                        row["device_b"], row["port_b"], now, now + 180))
        cursor.execute("DELETE FROM topology_links WHERE id=?", (row["id"],))
    if "snmp_port" not in device_columns:
        cursor.execute("ALTER TABLE devices ADD COLUMN snmp_port INTEGER DEFAULT 161")

    # Default settings
    cursor.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('poll_interval', '60')")
    cursor.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('retry_enabled', 'true')")
    cursor.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('downsampling_enabled', 'true')")

    conn.commit()

    # A fresh database starts empty; inventory and history must come from real SNMP.
    conn.close()


def seed_initial_data(conn: sqlite3.Connection):
    """Seed initial network devices, interfaces, topology, and historical traffic matching initialData.ts"""
    cursor = conn.cursor()

    devices_data = [
        ("d1", "Core-SW-01", "192.168.10.1", "v2c", "private", "switch", "Cisco C2960X-24TS-L",
         "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(4)E10", "online", "45 วัน 14:22:08"),
        ("d2", "Dist-SW-01", "192.168.10.2", "v2c", "private", "switch", "Cisco Catalyst 3850-24T",
         "Cisco IOS Software, IOS-XE Software, Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 03.07.05E", "online", "18 วัน 02:11:44"),
        ("d3", "Edge-RTR-01", "192.168.10.254", "v2c", "private", "router", "Cisco ISR 4331",
         "Cisco IOS XE Software, Version 16.06.05 (c4300e-universalk9.16.06.05)", "online", "92 วัน 08:04:19"),
        ("d4", "Access-SW-02", "192.168.10.12", "v2c", "private", "switch", "Cisco C2960-24TC-L",
         "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11", "online", "3 วัน 19:40:02"),
        ("d5", "Branch-RTR-02", "10.20.0.1", "v2c", "public", "router", "Cisco 2911/K9",
         "Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.4(3)M10", "offline", "0 วัน 00:00:00"),
        ("d6", "Access-SW-03", "192.168.10.13", "v2c", "private", "switch", "Cisco C1000-24T",
         "Cisco IOS Software, C1000 Software (C1000-LANBASEK9-M), Version 15.2(7)E7", "online", "11 วัน 01:15:33"),
    ]

    for dev in devices_data:
        cursor.execute("""
        INSERT INTO devices (id, name, ip, snmp_version, community, device_type, vendor, sys_descr, status, up_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, dev)

    # Insert interfaces for each device
    # Switch ports (24 FastEthernet + 2 GigabitEthernet)
    for dev_id in ["d1", "d2", "d4", "d6"]:
        ports = []
        for i in range(1, 25):
            pname = f"Fa0/{i}"
            is_up = not (dev_id == "d4" and i == 14) and not (dev_id == "d1" and i in (18, 22))
            ports.append((
                f"{dev_id}_{pname}", dev_id, i, pname, 100,
                "up" if is_up else "down", "up" if is_up else "down",
                0, f"00:1e:bd:{i:02x}:10:aa", f"Access Port {i}", 0, ""
            ))
        # Uplink ports
        ports.append((f"{dev_id}_Gi0/1", dev_id, 25, "Gi0/1", 10000, "up", "up", 0, "00:1e:bd:fe:10:01", "Uplink Core", 0, ""))
        ports.append((f"{dev_id}_Gi0/2", dev_id, 26, "Gi0/2", 10000, "up", "up", 0, "00:1e:bd:fe:10:02", "Uplink Backup", 0, ""))
        # Virtual VLAN
        ports.append((f"{dev_id}_Vlan1", dev_id, 100, "Vlan1", 1000, "up", "up", 0, "00:1e:bd:00:00:01", "Management SVI", 1, "192.168.10.1"))

        cursor.executemany("""
        INSERT INTO interfaces (id, device_id, if_index, name, speed, admin_status, oper_status, errors, mac, alias, virtual, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, ports)

    # Router ports (d3, d5)
    rtr_ports = [
        ("d3_Gi0/0", "d3", 1, "GigabitEthernet0/0", 1000, "up", "up", 0, "00:50:56:a1:01:01", "WAN Uplink to ISP", 0, "203.0.113.2/30"),
        ("d3_Gi0/1", "d3", 2, "GigabitEthernet0/1", 1000, "up", "up", 0, "00:50:56:a1:01:02", "LAN Gateway", 0, "192.168.10.254/24"),
        ("d3_Gi0/2", "d3", 3, "GigabitEthernet0/2", 1000, "up", "up", 0, "00:50:56:a1:01:03", "DMZ Network", 0, "172.16.1.1/24"),
        ("d3_Se0/0", "d3", 4, "Serial0/0/0", 2, "up", "down", 0, "00:50:56:a1:01:04", "Backup Serial Link", 0, "10.0.0.1/30"),
        ("d3_Lo0", "d3", 5, "Loopback0", 10000, "up", "up", 0, "", "Router ID", 1, "1.1.1.1/32"),

        ("d5_Gi0/0", "d5", 1, "GigabitEthernet0/0", 1000, "down", "down", 0, "00:50:56:b2:01:01", "WAN Link", 0, "10.20.0.1/30"),
        ("d5_Gi0/1", "d5", 2, "GigabitEthernet0/1", 1000, "down", "down", 0, "00:50:56:b2:01:02", "LAN Link", 0, "10.20.1.1/24"),
    ]
    cursor.executemany("""
    INSERT INTO interfaces (id, device_id, if_index, name, speed, admin_status, oper_status, errors, mac, alias, virtual, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rtr_ports)

    # Topology links
    links = [
        ("l1", "d3", "GigabitEthernet0/1", "d1", "Gi0/1", "CDP"),
        ("l2", "d1", "Gi0/2", "d2", "Gi0/1", "LLDP"),
        ("l3", "d1", "Fa0/1", "d4", "Fa0/1", "LLDP"),
        ("l4", "d2", "Fa0/1", "d6", "Fa0/1", "LLDP"),
    ]
    cursor.executemany("""
    INSERT INTO topology_links (id, device_a, port_a, device_b, port_b, protocol)
    VALUES (?, ?, ?, ?, ?, ?)
    """, links)

    # Seed initial events
    now_iso = datetime.now().isoformat()
    events = [
        ("e1", now_iso, "d4", "192.168.10.12", "Fa0/14", "linkDown", "1.3.6.1.6.3.1.1.5.3", json.dumps({"ifIndex": 14, "ifDescr": "Fa0/14"})),
        ("e2", now_iso, "d1", "192.168.10.1", "Fa0/18", "linkDown", "1.3.6.1.6.3.1.1.5.3", json.dumps({"ifIndex": 18, "ifDescr": "Fa0/18"})),
        ("e3", now_iso, "d2", "192.168.10.2", "Fa0/4", "linkUp", "1.3.6.1.6.3.1.1.5.4", json.dumps({"ifIndex": 4, "ifDescr": "Fa0/4"})),
    ]
    cursor.executemany("""
    INSERT INTO events (id, timestamp, device_id, source_ip, port_name, type, oid, raw_varbinds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, events)

    # Audit logs
    audit = [
        ("a1", now_iso, "admin", "เพิ่มอุปกรณ์", "192.168.10.1", "สำเร็จ"),
        ("a2", now_iso, "admin", "เพิ่มอุปกรณ์", "192.168.10.2", "สำเร็จ"),
        ("a3", now_iso, "admin", "สั่ง Shutdown Fa0/14", "Access-SW-02", "สำเร็จ"),
    ]
    cursor.executemany("""
    INSERT INTO audit_logs (id, timestamp, user, action, target, result)
    VALUES (?, ?, ?, ?, ?, ?)
    """, audit)

    # Generate initial traffic samples for key ports (last 2 hours)
    now_ms = int(time.time() * 1000)
    samples = []
    for step in range(120, -1, -1):
        ts = now_ms - step * 60 * 1000
        # Port Gi0/1 on d1
        in_bps = 45000000 + (ts % 10000000)
        out_bps = 22000000 + (ts % 5000000)
        samples.append(("d1", "Gi0/1", ts, int(in_bps * 60 / 8), int(out_bps * 60 / 8), in_bps, out_bps))
        # Port GigabitEthernet0/0 on d3
        in_bps3 = 75000000 + (ts % 15000000)
        out_bps3 = 38000000 + (ts % 8000000)
        samples.append(("d3", "GigabitEthernet0/0", ts, int(in_bps3 * 60 / 8), int(out_bps3 * 60 / 8), in_bps3, out_bps3))

    cursor.executemany("""
    INSERT INTO traffic_samples (device_id, port_name, timestamp, in_octets, out_octets, in_bps, out_bps)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, samples)

    conn.commit()


# Helper query functions
def get_all_devices() -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM devices ORDER BY name")
    devices = [dict(row) for row in cursor.fetchall()]

    for dev in devices:
        cursor.execute("SELECT * FROM interfaces WHERE device_id = ? ORDER BY if_index", (dev["id"],))
        ports = []
        for row in cursor.fetchall():
            ports.append({
                "idx": row["if_index"],
                "name": row["name"],
                "speed": row["speed"],
                "admin": row["admin_status"],
                "oper": row["oper_status"],
                "errors": row["errors"],
                "mac": row["mac"] or "",
                "alias": row["alias"] or "",
                "virtual": bool(row["virtual"]),
                "ip": row["ip"] or "",
            })
        dev["ports"] = ports
        dev["rw"] = (dev["community"] == "private" or "rw" in (dev["community"] or "").lower())
        dev["ver"] = dev["snmp_version"]
        dev["type"] = dev["device_type"]
        dev["up"] = dev["up_time"] or "0 วัน 00:00:00"
        dev["descr"] = dev["sys_descr"] or ""
        dev["discovery_only"] = False
        dev["can_configure"] = True
    cursor.execute("SELECT * FROM discovered_neighbors ORDER BY name")
    observations = [dict(row) for row in cursor.fetchall()]
    conn.close()
    for row in observations:
        if _match_managed_neighbor(row, devices) or _match_captured_neighbor(row, observations, devices):
            continue
        devices.append(_neighbor_device(row))
    return devices


def management_ip(value: str) -> str:
    """Only usable IPv4 addresses may be passed to this app's SNMP transport."""
    try:
        address = ipaddress.IPv4Address(value)
        if not (address.is_unspecified or address.is_multicast or address.is_loopback or str(address) == "255.255.255.255"):
            return str(address)
    except (ValueError, TypeError):
        pass
    return ""


def normalize_port_name(name: str) -> str:
    """Expand only abbreviations followed by a port number, never full names."""
    for short, full in (("Gi", "GigabitEthernet"), ("Gig", "GigabitEthernet"),
                        ("Fa", "FastEthernet"), ("Fas", "FastEthernet"),
                        ("Eth", "Ethernet"), ("Et", "Ethernet"), ("Te", "TenGigabitEthernet")):
        if re.match(rf"^{short}\s*(?=\d)", name, re.IGNORECASE):
            return re.sub(rf"^{short}\s*", full, name, flags=re.IGNORECASE)
    return name.strip()


def _match_managed_neighbor(row: dict, devices: list) -> Optional[dict]:
    managed = [device for device in devices if not device.get("discovery_only")]
    exact = [device for device in managed if device["id"] == row["id"] or
             (row.get("management_ip") and device["ip"] == row["management_ip"])]
    if exact:
        return exact[0]
    mac = normalize_mac(row.get("source_mac", ""))
    if mac:
        matching = [device for device in managed if any(normalize_mac(port.get("mac", "")) == mac for port in device.get("ports", []))]
        if len(matching) == 1:
            return matching[0]
    identity = (row.get("device_identity") or row["identity"]).strip().lower()
    if identity in ("switch", "router", "device", "localhost"):
        return None
    named = [device for device in managed if identity in
             {str(device.get("name", "")).lower(), str(device.get("name", "")).lower().split(".")[0]}]
    if mac:
        named = [device for device in named if not any(normalize_mac(p.get("mac", "")) for p in device.get("ports", []))]
    # Do not attach a neighbor to an arbitrary device when names are ambiguous.
    return named[0] if len(named) == 1 else None


def _match_captured_neighbor(row: dict, observations: list, devices: list) -> Optional[dict]:
    """Resolve a weak CDP cache ID using advertisements on the reporter's segment.

    Require the reporter's exact local-port MAC in a captured advertisement,
    then an unambiguous Device ID + remote Port ID on that same capture NIC.
    Neither hostname alone nor a shared IP subnet establishes this relation.
    Preserve both observations so a later ambiguity can undo the association.
    """
    if row.get("source_mac") or row.get("chassis_id") or row.get("management_ip"):
        return None
    scope = re.fullmatch(r"(switch|router|device|localhost)\|observer:([^|]+)\|local:(.+)",
                         row["identity"], re.IGNORECASE)
    if not scope:
        return None
    observer = next((device for device in devices if device["id"] == scope[2] and
                     not device.get("discovery_only")), None)
    if not observer:
        return None
    local_macs = {normalize_mac(port.get("mac", "")) for port in observer.get("ports", [])
                  if normalize_port_name(port["name"]).lower() == normalize_port_name(scope[3]).lower()}
    local_macs.discard("")
    interfaces = {item["capture_interface"] for item in observations
                  if item["capture_interface"] and normalize_mac(item["source_mac"]) in local_macs}
    if not interfaces:
        return None
    remote_ports = {normalize_port_name(port).lower() for port in json.loads(row["ports_json"])}
    candidates = [item for item in observations if normalize_mac(item["source_mac"]) and
                  item["capture_interface"] in interfaces and
                  (item.get("device_identity") or item["identity"]).casefold() ==
                  (row.get("device_identity") or row["identity"]).casefold() and
                  remote_ports & {normalize_port_name(port).lower() for port in json.loads(item["ports_json"])}]
    return candidates[0] if len(candidates) == 1 else None


def _neighbor_device(row: dict) -> dict:
    ip = row["management_ip"] or ""
    reason = ("ยังไม่มี Management IP จึงไม่สามารถ Config หรืออ่าน Traffic ผ่าน SNMP ได้"
              if not ip else f"พบ IP จาก {row['protocol']} แต่ยังไม่ได้ยืนยัน SNMP จึงยังไม่สามารถ Config ได้")
    ports = [{"idx": 0, "name": name, "speed": 0, "admin": "unknown", "oper": "unknown",
              "errors": 0, "mac": "", "alias": f"พอร์ตที่ประกาศผ่าน {row['protocol']}; ยังไม่ทราบสถานะ SNMP",
              "virtual": False, "ip": "", "observed_only": True}
             for name in json.loads(row["ports_json"])]
    return {"id": row["id"], "name": row["name"], "ip": ip, "type": row["device_type"],
            "vendor": row["platform"] or row["protocol"], "descr": row["description"],
            "ver": "v2c", "community": "", "snmp_port": 161, "rw": False,
            "status": "discovered" if row["expires_at"] > time.time() else "offline",
            "up": "—", "ports": ports, "discovery_only": True, "can_configure": False,
            "config_unavailable_reason": reason, "discovery_protocol": row["protocol"],
            "discovery_identity": row.get("device_identity") or row["identity"], "source_mac": row["source_mac"],
            "chassis_id": row.get("chassis_id", ""),
            "capture_interface": row["capture_interface"], "last_seen": row["last_seen"]}


def normalize_mac(value: str) -> str:
    value = re.sub(r"[^0-9a-f]", "", str(value).lower())
    return ":".join(value[index:index + 2] for index in range(0, 12, 2)) if len(value) == 12 else ""


def record_discovered_neighbor(neighbor: dict) -> tuple[dict, bool]:
    """Persist advertisements separately; never treat them as verified SNMP inventory."""
    identity = str(neighbor.get("identity") or neighbor.get("name") or "").strip()[:512]
    if not identity:
        raise ValueError("Neighbor Device/Chassis ID is required")
    protocol = str(neighbor.get("protocol", "CDP"))
    ip = management_ip(neighbor.get("management_ip", ""))
    mac = normalize_mac(neighbor.get("chassis_mac") or neighbor.get("source_mac", ""))
    chassis = str(neighbor.get("chassis_id", ""))
    aliases = [value for value in (f"ip:{ip}" if ip else "",
               f"mac:{mac}" if mac else "", f"chassis:{chassis}" if chassis else "") if value]
    key = (aliases[-1] if chassis else f"{protocol.lower()}:{identity.casefold()}|mac:{mac}" if mac
           else f"ip:{ip}" if ip else identity.casefold())
    if not aliases and identity.lower() in ("switch", "router", "device", "localhost"):
        key += f"|observer:{neighbor.get('observer_id', '')}|local:{neighbor.get('local_port', '')}"
    neighbor_id = "cdp_" + hashlib.sha256(key.encode()).hexdigest()[:24]
    now = time.time()
    ttl = max(0, min(int(neighbor.get("ttl", 180)), 65535))
    conn = get_db()
    try:
        cursor = conn.cursor()
        old = cursor.execute("SELECT * FROM discovered_neighbors WHERE identity = ?", (key,)).fetchone()
        if not old:
            # Chassis/MAC are stronger than an address that DHCP may reuse.
            for alias in sorted(aliases, key=lambda value: value.startswith("ip:")):
                matches = cursor.execute(
                    "SELECT n.* FROM discovered_neighbors n JOIN neighbor_aliases a ON a.device_id=n.id WHERE a.alias=?",
                    (alias,)).fetchall()
                matches = [item for item in matches if not (
                    alias.startswith("ip:") and (
                        (chassis and item["chassis_id"] and chassis != item["chassis_id"]) or
                        (mac and item["source_mac"] and mac != normalize_mac(item["source_mac"]))
                    ))]
                if len(matches) == 1:
                    old = matches[0]
                    break
        if not old:
            candidates = cursor.execute("SELECT * FROM discovered_neighbors WHERE lower(device_identity)=?", (identity.lower(),)).fetchall()
            candidates = [item for item in candidates if
                          not (mac and item["source_mac"] and normalize_mac(item["source_mac"]) != mac) and
                          not (chassis and item["chassis_id"] and item["chassis_id"] != chassis) and
                          not (ip and item["management_ip"] and item["management_ip"] != ip)]
            if len(candidates) == 1 and identity.lower() not in ("switch", "router", "device", "localhost"):
                old = candidates[0]
        if old:
            neighbor_id, key = old["id"], old["identity"]
        names = json.loads(old["ports_json"]) if old else []
        port = normalize_port_name(str(neighbor.get("port") or "").strip())
        if port and port not in names:
            names.append(port)
        ip = management_ip(neighbor.get("management_ip", ""))
        cursor.execute("""
        INSERT INTO discovered_neighbors
        (id, identity, name, source_mac, management_ip, device_type, platform, description,
         protocol, capture_interface, ports_json, last_seen, expires_at, device_identity, chassis_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(identity) DO UPDATE SET
            name=excluded.name, source_mac=excluded.source_mac,
            management_ip=excluded.management_ip, device_type=excluded.device_type,
            platform=excluded.platform, description=excluded.description, protocol=excluded.protocol,
            capture_interface=excluded.capture_interface, ports_json=excluded.ports_json,
            last_seen=excluded.last_seen, expires_at=excluded.expires_at,
            device_identity=excluded.device_identity, chassis_id=excluded.chassis_id
        """, (neighbor_id, key, neighbor.get("name") or identity,
              neighbor.get("source_mac") or mac or (old["source_mac"] if old else ""), ip,
              neighbor.get("device_type", "switch"), neighbor.get("platform") or (old["platform"] if old else ""),
              neighbor.get("description") or (old["description"] if old else ""), neighbor.get("protocol", "CDP"),
              neighbor.get("capture_interface") or (old["capture_interface"] if old else ""),
              json.dumps(names), now, now + ttl, identity, chassis or (old["chassis_id"] if old else "")))
        cursor.execute("DELETE FROM neighbor_aliases WHERE device_id=? AND alias LIKE 'ip:%'", (neighbor_id,))
        for alias in aliases:
            cursor.execute("INSERT OR IGNORE INTO neighbor_aliases(alias,device_id) VALUES (?,?)", (alias, neighbor_id))
        conn.commit()
        row = dict(cursor.execute("SELECT * FROM discovered_neighbors WHERE id = ?", (neighbor_id,)).fetchone())
    finally:
        conn.close()
    devices = get_all_devices()
    managed = _match_managed_neighbor(row, devices)
    conn = get_db()
    try:
        observations = [dict(item) for item in conn.execute("SELECT * FROM discovered_neighbors")]
    finally:
        conn.close()
    captured = _match_captured_neighbor(row, observations, devices)
    return (managed or (_neighbor_device(captured) if captured else
            next(device for device in devices if device["id"] == neighbor_id))), old is None


def get_device(dev_id: str) -> Optional[Dict[str, Any]]:
    devices = get_all_devices()
    for d in devices:
        if d["id"] == dev_id or d["ip"] == dev_id:
            return d
    return None


def save_device(dev: Dict[str, Any]):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO devices (id, name, ip, snmp_version, community, snmp_port, device_type, vendor, sys_descr, status, up_time, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, ip=excluded.ip,
    snmp_version=excluded.snmp_version, community=excluded.community, snmp_port=excluded.snmp_port,
    device_type=excluded.device_type, vendor=excluded.vendor, sys_descr=excluded.sys_descr,
    status=excluded.status, up_time=excluded.up_time, last_seen=excluded.last_seen
    """, (
        dev["id"], dev["name"], dev["ip"], dev.get("ver", dev.get("snmp_version", "v2c")),
        dev.get("community", "public"), dev.get("snmp_port", dev.get("port", 161)), dev.get("type", dev.get("device_type", "switch")),
        dev.get("vendor", ""), dev.get("descr", dev.get("sys_descr", "")),
        dev.get("status", "online"), dev.get("up", dev.get("up_time", ""))
    ))

    if "ports" in dev:
        cursor.execute("DELETE FROM interfaces WHERE device_id = ?", (dev["id"],))
        for p in dev["ports"]:
            port_id = f"{dev['id']}_{p['name']}"
            cursor.execute("""
            INSERT OR REPLACE INTO interfaces (id, device_id, if_index, name, speed, admin_status, oper_status, errors, mac, alias, virtual, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                port_id, dev["id"], p["idx"], p["name"], p["speed"],
                p["admin"], p["oper"], p.get("errors", 0),
                p.get("mac", ""), p.get("alias", ""),
                1 if p.get("virtual") else 0, p.get("ip", "")
            ))
    conn.commit()
    conn.close()


def delete_device(dev_id: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM traffic_samples WHERE device_id = ?", (dev_id,))
    cursor.execute("DELETE FROM interfaces WHERE device_id = ?", (dev_id,))
    cursor.execute("DELETE FROM topology_links WHERE device_a = ? OR device_b = ?", (dev_id, dev_id))
    cursor.execute("DELETE FROM devices WHERE id = ?", (dev_id,))
    cursor.execute("DELETE FROM discovered_neighbors WHERE id = ?", (dev_id,))
    cursor.execute("DELETE FROM neighbor_aliases WHERE device_id = ?", (dev_id,))
    cursor.execute("DELETE FROM topology_observations WHERE observer_id=? OR device_a=? OR device_b=?", (dev_id, dev_id, dev_id))
    conn.commit()
    conn.close()


def save_topology_link(device_a: str, port_a: str, device_b: str, port_b: str, protocol: str):
    """Persist a neighbor relationship discovered from LLDP or CDP."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """DELETE FROM topology_links WHERE
           (device_a = ? AND port_a = ? AND device_b = ? AND port_b = ?) OR
           (device_a = ? AND port_a = ? AND device_b = ? AND port_b = ?)""",
        (device_a, port_a, device_b, port_b, device_b, port_b, device_a, port_a),
    )
    cursor.execute(
        "INSERT INTO topology_links (id, device_a, port_a, device_b, port_b, protocol) VALUES (?, ?, ?, ?, ?, ?)",
        (f"link_{device_a}_{port_a}_{device_b}_{port_b}", device_a, port_a, device_b, port_b, protocol),
    )
    conn.commit()
    conn.close()


def replace_topology_observations(observer_id: str, protocol: str, links: list, ttl: int = 180):
    """Replace a successful table snapshot. Do not call this after a failed walk."""
    now = time.time()
    conn = get_db()
    try:
        conn.execute("DELETE FROM topology_observations WHERE observer_id=? AND protocol=?", (observer_id, protocol))
        conn.execute("DELETE FROM topology_links WHERE device_a=? AND protocol=?", (observer_id, protocol))
        for link in links:
            key = json.dumps(sorted(((link["a"], normalize_port_name(link["pa"]).lower()),
                                     (link["b"], normalize_port_name(link["pb"]).lower()))))
            conn.execute("INSERT INTO topology_observations VALUES (?,?,?,?,?,?,?,?,?)",
                         (observer_id, protocol, key, link["a"], link["pa"], link["b"], link["pb"], now, now + ttl))
        conn.commit()
    finally:
        conn.close()


def get_topology_links() -> list:
    conn = get_db()
    try:
        rows = [dict(row) for row in conn.execute("SELECT * FROM topology_links")]
        rows += [dict(row) for row in conn.execute("SELECT * FROM topology_observations WHERE expires_at>? ORDER BY last_seen", (time.time(),))]
        observations = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM discovered_neighbors")}
    finally:
        conn.close()
    devices = get_all_devices()
    by_id = {device["id"]: device for device in devices}
    def canonical_id(value):
        if value in by_id:
            return value
        matched = _match_managed_neighbor(observations[value], devices) if value in observations else None
        captured = _match_captured_neighbor(observations[value], list(observations.values()), devices) if value in observations else None
        return matched["id"] if matched else captured["id"] if captured else value
    links = {}
    for row in rows:
        a, b = canonical_id(row["device_a"]), canonical_id(row["device_b"])
        if a not in by_id or b not in by_id or a == b:
            continue
        if any(by_id[value].get("discovery_only") and by_id[value]["status"] == "offline" for value in (a, b)):
            continue
        pa, pb = row["port_a"], row["port_b"]
        pa = next((p["name"] for p in by_id[a]["ports"] if normalize_port_name(p["name"]).lower() == normalize_port_name(pa).lower()), pa)
        pb = next((p["name"] for p in by_id[b]["ports"] if normalize_port_name(p["name"]).lower() == normalize_port_name(pb).lower()), pb)
        key = tuple(sorted(((a, normalize_port_name(pa).lower()), (b, normalize_port_name(pb).lower()))))
        links[key] = {"a": a, "pa": pa, "b": b, "pb": pb, "proto": row.get("protocol", "CDP")}
    return list(links.values())


def update_interface_status(device_id: str, port_name: str, admin: Optional[str] = None, oper: Optional[str] = None):
    conn = get_db()
    cursor = conn.cursor()
    if admin is not None and oper is not None:
        cursor.execute("UPDATE interfaces SET admin_status = ?, oper_status = ? WHERE device_id = ? AND name = ?",
                       (admin, oper, device_id, port_name))
    elif admin is not None:
        cursor.execute("UPDATE interfaces SET admin_status = ? WHERE device_id = ? AND name = ?",
                       (admin, device_id, port_name))
    elif oper is not None:
        cursor.execute("UPDATE interfaces SET oper_status = ? WHERE device_id = ? AND name = ?",
                       (oper, device_id, port_name))
    conn.commit()
    conn.close()


def add_event(evt_id: str, device_id: str, source_ip: str, port_name: str, trap_type: str, oid: str, raw_varbinds: str = ""):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO events (id, timestamp, device_id, source_ip, port_name, type, oid, raw_varbinds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (evt_id, datetime.now().isoformat(), device_id, source_ip, port_name, trap_type, oid, raw_varbinds))
    conn.commit()
    conn.close()


def get_events(limit: int = 100) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "t": r["timestamp"],
            "dev": r["device_id"],
            "src": r["source_ip"],
            "port": r["port_name"],
            "type": r["type"],
            "oid": r["oid"],
        }
        for r in rows
    ]


def add_audit_log(user: str, action: str, target: str, result: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO audit_logs (id, timestamp, user, action, target, result)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (f"a_{int(time.time()*1000)}", datetime.now().isoformat(), user, action, target, result))
    conn.commit()
    conn.close()


def get_audit_logs(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_traffic_history(device_id: str, port_name: str, range_type: str = "day") -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    # Calculate time threshold based on range
    now_ms = int(time.time() * 1000)
    range_ms_map = {
        "live": 10 * 60 * 1000,           # 10 minutes
        "day": 24 * 60 * 60 * 1000,       # 24 hours
        "week": 7 * 24 * 60 * 60 * 1000,  # 7 days
        "month": 30 * 24 * 60 * 60 * 1000,# 30 days
        "year": 365 * 24 * 60 * 60 * 1000 # 365 days
    }
    threshold = now_ms - range_ms_map.get(range_type, 24 * 60 * 60 * 1000)

    bucket_ms_map = {
        "live": 5_000,
        "day": 300_000,
        "week": 1_800_000,
        "month": 7_200_000,
        "year": 86_400_000,
    }
    bucket_ms = bucket_ms_map.get(range_type, bucket_ms_map["day"])
    cursor.execute("""
    SELECT (timestamp / ?) * ? AS timestamp, AVG(in_bps) AS in_bps, AVG(out_bps) AS out_bps
    FROM traffic_samples
    WHERE device_id = ? AND port_name = ? AND timestamp >= ?
    GROUP BY (timestamp / ?) * ?
    ORDER BY timestamp ASC
    """, (bucket_ms, bucket_ms, device_id, port_name, threshold, bucket_ms, bucket_ms))

    rows = cursor.fetchall()
    conn.close()
    return [{"t": r["timestamp"], "in": r["in_bps"], "out": r["out_bps"]} for r in rows]


def get_aggregate_traffic(range_type: str = "day") -> List[Dict[str, Any]]:
    now_ms = int(time.time() * 1000)
    range_ms_map = {
        "live": 10 * 60 * 1000,
        "day": 24 * 60 * 60 * 1000,
        "week": 7 * 24 * 60 * 60 * 1000,
        "month": 30 * 24 * 60 * 60 * 1000,
        "year": 365 * 24 * 60 * 60 * 1000,
    }
    bucket_ms_map = {"live": 5_000, "day": 300_000, "week": 1_800_000, "month": 7_200_000, "year": 86_400_000}
    threshold = now_ms - range_ms_map.get(range_type, range_ms_map["day"])
    bucket_ms = bucket_ms_map.get(range_type, bucket_ms_map["day"])
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT (timestamp / ?) * ? AS timestamp, SUM(in_bps) AS in_bps, SUM(out_bps) AS out_bps
    FROM traffic_samples
    WHERE timestamp >= ?
    GROUP BY (timestamp / ?) * ?
    ORDER BY timestamp ASC
    """, (bucket_ms, bucket_ms, threshold, bucket_ms, bucket_ms))
    rows = cursor.fetchall()
    conn.close()
    return [{"t": r["timestamp"], "in": r["in_bps"], "out": r["out_bps"]} for r in rows]


def get_latest_traffic() -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT s.device_id, s.port_name, s.timestamp, s.in_bps, s.out_bps
    FROM traffic_samples s
    INNER JOIN (
      SELECT device_id, port_name, MAX(timestamp) AS latest
      FROM traffic_samples GROUP BY device_id, port_name
    ) latest ON latest.device_id = s.device_id AND latest.port_name = s.port_name AND latest.latest = s.timestamp
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def save_traffic_sample(device_id: str, port_name: str, in_octets: int, out_octets: int, in_bps: float, out_bps: float):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO traffic_samples (device_id, port_name, timestamp, in_octets, out_octets, in_bps, out_bps)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (device_id, port_name, int(time.time() * 1000), in_octets, out_octets, in_bps, out_bps))
    conn.commit()
    conn.close()
