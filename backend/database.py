"""
Database module for SNMP Network Monitor
Uses SQLite with WAL mode for fast concurrency between Poller, Trap Receiver, and API
"""

import sqlite3
import json
import time
import os
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
    """)

    device_columns = {row[1] for row in cursor.execute("PRAGMA table_info(devices)").fetchall()}
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
    conn.close()
    return devices


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
    INSERT OR REPLACE INTO devices (id, name, ip, snmp_version, community, snmp_port, device_type, vendor, sys_descr, status, up_time, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    """, (
        dev["id"], dev["name"], dev["ip"], dev.get("ver", dev.get("snmp_version", "v2c")),
        dev.get("community", "public"), dev.get("snmp_port", dev.get("port", 161)), dev.get("type", dev.get("device_type", "switch")),
        dev.get("vendor", ""), dev.get("descr", dev.get("sys_descr", "")),
        dev.get("status", "online"), dev.get("up", dev.get("up_time", ""))
    ))

    if "ports" in dev:
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
