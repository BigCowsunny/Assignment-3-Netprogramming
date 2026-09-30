# Product Requirements Document (PRD)

## SNMP Network Monitor

ระบบ Monitor อุปกรณ์เครือข่าย (Router / Switch) ผ่านเว็บ ด้วยโปรโตคอล SNMP

**เวอร์ชัน:** 1.0

---

# ส่วนที่ 1: สรุป Function ตามโจทย์

| # | ความต้องการในโจทย์ | Function ที่ต้องทำ | วิธีการทางเทคนิค (SNMP) |
|---|---|---|---|
| 1 | แสดงผลผ่านเว็บ | Web Dashboard | Backend API + Frontend |
| 2 | เชื่อมต่ออุปกรณ์ผ่าน IP (EVE-NG และของจริง) | Device Management (เพิ่ม/ลบ/แก้ไข/ทดสอบการเชื่อมต่อ) | SNMP GET `sysDescr`, `sysName`, `sysUpTime` |
| 3 | แสดงรูป Port ทั้งหมดของอุปกรณ์ | Port Panel View (วาดหน้าตา Port เป็นรูป, สีตามสถานะ) | อ่าน `ifTable` / `ifXTable` |
| 4 | Up/Down Interface ได้ | Interface Control | SNMP SET `ifAdminStatus` (1=up, 2=down) |
| 5 | กราฟ Traffic ราย Port (วัน/สัปดาห์/เดือน/ปี) | Traffic Graph แบบ PRTG | Poll `ifHCInOctets`/`ifHCOutOctets` เก็บลง DB แล้วคำนวณ bps |
| 6 | รับ Trap (Link up/down) | Trap Receiver + Event Log | ฟัง UDP 162 รับ `linkDown`/`linkUp` |
| 7 | โบนัส: Auto Discovery + Topology | Discovery Engine + Topology Map คลิกโหนดแล้วดู Port Panel ได้ | LLDP-MIB / CDP-MIB / ARP |

**ข้อสังเกตสำคัญของโจทย์**

- ข้อ Trap ระบุว่า "ต้องส่งด้วยวิธี trap เท่านั้น" หมายความว่าการแจ้ง Link up/down บนหน้าเว็บต้องมาจาก Trap ที่อุปกรณ์ส่งมาจริง ห้ามใช้วิธี Poll สถานะแล้วสร้าง event เอง (แต่ยัง Poll สถานะปกติเพื่อแสดงสีของ Port ได้)
- การ Up/Down ต้องใช้ SNMP SET จึงต้องมี Community แบบ Read-Write (v2c) หรือ SNMPv3 ที่มีสิทธิ์เขียน

---

# ส่วนที่ 2: PRD

## 1. ภาพรวมผลิตภัณฑ์

- **ชื่อโปรเจกต์:** SNMP Network Monitor (ชื่อชั่วคราว)
- **ประเภท:** Web Application สำหรับ Monitor อุปกรณ์เครือข่ายด้วย SNMP
- **วัตถุประสงค์:** ให้ผู้ดูแลเครือข่ายเพิ่มอุปกรณ์ (Router/Switch) ด้วย IP แล้วเห็นสถานะ Port แบบภาพ ควบคุม Port ได้ ดูกราฟ Traffic ย้อนหลัง และเห็นเหตุการณ์ Link up/down แบบเรียลไทม์จาก Trap
- **ขอบเขต (In Scope):** Device management, Port panel, Interface up/down, Traffic graph, Trap receiver, (โบนัส) Auto discovery + Topology
- **นอกขอบเขต (Out of Scope):** การตั้งค่า config อุปกรณ์อื่นนอกจาก up/down, การแจ้งเตือนทางอีเมล/Line, Multi-tenant, Mobile app

## 2. ผู้ใช้งาน (Personas)

- **Network Admin:** เพิ่มอุปกรณ์, ดูสถานะ, สั่ง up/down Port, ดู Event
- **Viewer (ตัวเลือกเสริม):** ดูอย่างเดียว ไม่มีสิทธิ์ up/down
- **ผู้ตรวจ/อาจารย์:** ทดสอบกับ EVE-NG และอุปกรณ์จริงตามเกณฑ์คะแนน

## 3. สถาปัตยกรรมที่แนะนำ

```
[Router/Switch] --SNMP GET/SET (UDP 161)--> [Poller/SNMP Service] --> [Database]
[Router/Switch] --SNMP Trap (UDP 162)-----> [Trap Receiver] --> [Database] --> [WebSocket/SSE] --> [Browser]
[Browser] <--REST API-- [Backend API] <-- [Database]
```

**Tech stack ที่แนะนำ (เลือกเปลี่ยนได้)**

- **Backend:** Python (FastAPI หรือ Flask) + `pysnmp` (หรือเรียก `net-snmp` CLI)
- **Trap Receiver:** `pysnmp` หรือ `snmptrapd` ส่งต่อเข้า Backend
- **Database:** SQLite/PostgreSQL สำหรับ metadata และ Event; ตารางแยก (หรือ InfluxDB/RRDtool) สำหรับ Time-series
- **Frontend:** React หรือ HTML+JS ธรรมดา, กราฟใช้ Chart.js/ECharts, รูป Port ใช้ SVG, Topology ใช้ vis-network หรือ Cytoscape.js
- **Scheduler:** APScheduler หรือ Celery สำหรับ Poll ทุก N วินาที
- **การรัน:** Docker Compose (Backend + DB + Frontend)

## 4. Functional Requirements

### FR-1 Device Management

- FR-1.1 เพิ่มอุปกรณ์โดยกรอก: ชื่อ (ไม่บังคับ), IP Address, SNMP Version (v2c/v3), Community หรือ v3 credentials, Port SNMP (ค่าเริ่มต้น 161)
- FR-1.2 ปุ่ม "Test Connection" ทำ SNMP GET `sysDescr` ถ้าสำเร็จจึงบันทึก ถ้า Timeout แสดงข้อความที่เข้าใจง่าย
- FR-1.3 เมื่อเพิ่มสำเร็จ ระบบดึงข้อมูลอัตโนมัติ: hostname, รุ่น/OS, uptime, จำนวน Interface และจัดประเภท Router/Switch
- FR-1.4 แก้ไข/ลบอุปกรณ์ได้ (ลบแล้วถามยืนยัน)
- FR-1.5 หน้ารายการอุปกรณ์แสดงสถานะ Online/Offline (จาก Poll `sysUpTime`), uptime, จำนวน Port up/down

**Acceptance:** เพิ่ม Router ใน EVE-NG ด้วย IP แล้วเห็นชื่อ/รุ่นภายใน 5 วินาที; ใช้ได้เหมือนกันกับ Switch จริง

### FR-2 Port Panel View (แสดงรูป Port)

- FR-2.1 เข้าหน้าอุปกรณ์แล้วเห็นรูปตัวเครื่องและ Port ทั้งหมดที่ดึงจาก `ifTable`
- FR-2.2 สีของ Port: เขียว = oper up, แดง = oper down (admin up), เทา = admin down, เหลือง (ไม่บังคับ) = มี error
- FR-2.3 Switch: วาด Port เป็นแถวตามลำดับ (เช่น Fa0/1–24, Gi0/1–2); Router: วาด Interface ตามชื่อ (Gi0/0, Se0/0, Loopback ฯลฯ)
- FR-2.4 Hover แสดง Tooltip: ชื่อ, ความเร็ว, สถานะ Admin/Oper, MAC, Alias/Description, IP (ถ้ามี)
- FR-2.5 กรอง Interface เสมือนที่ไม่ใช่กายภาพ (เช่น Null0, Vlan) ให้เปิด/ปิดการแสดงได้
- FR-2.6 รีเฟรชสีอัตโนมัติทุก 10–30 วินาที และทันทีเมื่อมี Trap เข้ามา

**Acceptance:** จำนวน Port ในภาพตรงกับ `show ip interface brief` บนอุปกรณ์

### FR-3 Interface Control (Up/Down)

- FR-3.1 คลิกขวา/ปุ่มบน Port แล้วเลือก "Shutdown" หรือ "No Shutdown"
- FR-3.2 ระบบส่ง SNMP SET `ifAdminStatus` (`1.3.6.1.2.1.2.2.1.7.<ifIndex>`) ค่า 1 = up, 2 = down
- FR-3.3 มีกล่องยืนยันก่อนสั่ง โดยเฉพาะ Port ที่เป็น Uplink/Management
- FR-3.4 หลังสั่ง ให้อ่านค่ากลับมาตรวจว่าเปลี่ยนจริง แล้วอัปเดตสีบนหน้าจอ; ถ้าล้มเหลวแจ้งสาเหตุ (เช่น community เป็น read-only)
- FR-3.5 บันทึก Audit Log: ใคร, เมื่อไร, อุปกรณ์/Port ไหน, สั่งอะไร, ผลลัพธ์

**Acceptance:** สั่ง down บน EVE-NG แล้ว Port เปลี่ยนเป็นสีเทาในเว็บ และ `show interface` บนอุปกรณ์เป็น administratively down

### FR-4 Traffic Graph

- FR-4.1 คลิก Port แล้วเปิดหน้า/หน้าต่างกราฟเส้น 2 เส้น: Received (In) และ Sent (Out) หน่วย bps (Kbps/Mbps/Gbps อัตโนมัติ)
- FR-4.2 ปุ่มเลือกช่วงเวลา: **Live, Daily, Weekly, Monthly, Yearly** (ตามแบบ PRTG/MRTG)
- FR-4.3 Poller อ่าน `ifHCInOctets` (`1.3.6.1.2.1.31.1.1.1.6`) และ `ifHCOutOctets` (`...1.10`) ตามรอบเวลา (แนะนำ 60 วินาที; ถ้าอุปกรณ์ไม่รองรับ 64-bit ใช้ `ifInOctets`/`ifOutOctets` แบบ 32-bit)
- FR-4.4 คำนวณอัตรา = (octets ปัจจุบัน − octets ก่อนหน้า) × 8 ÷ ช่วงเวลา (วินาที) **ต้องจัดการ Counter Wrap** และกรณีอุปกรณ์รีบูต (ตัวนับรีเซ็ต) ให้ข้ามจุดนั้น
- FR-4.5 เก็บข้อมูลแบบ Downsampling เพื่อไม่ให้ DB โตเกินไป:
  - Daily: จุดละ 1–5 นาที
  - Weekly: เฉลี่ยจุดละ 30 นาที
  - Monthly: เฉลี่ยจุดละ 2 ชั่วโมง
  - Yearly: เฉลี่ยจุดละ 1 วัน
- FR-4.6 แสดงค่า Min/Avg/Max/Current และ Tooltip เมื่อ Hover; ถ้ามีช่วงข้อมูลขาดให้แสดงเป็นช่องว่าง ไม่ลากเส้นมั่ว
- FR-4.7 (เสริม) แสดง Error/Discard, Utilization %, ส่งออก CSV/PNG

**Acceptance:** สร้าง Traffic ใน EVE-NG (เช่น ping ขนาดใหญ่ หรือ iperf) แล้วกราฟสูงขึ้นตรงกับเวลา; ทั้ง 4 ช่วงเวลาเปิดได้ (ช่วงที่ข้อมูลยังไม่ครบให้แสดงเท่าที่มี)

### FR-5 SNMP Trap Receiver

- FR-5.1 ฟัง UDP port 162 (ต้องใช้สิทธิ์ root หรือฟังที่ 1162 แล้ว redirect) รองรับ SNMPv2c Trap (และ v3 ถ้าทำ)
- FR-5.2 รองรับ `linkDown` (`1.3.6.1.6.3.1.1.5.3`) และ `linkUp` (`1.3.6.1.6.3.1.1.5.4`) แกะ varbind `ifIndex`, `ifAdminStatus`, `ifOperStatus`, `ifDescr` เพื่อระบุว่า Port ไหนเปลี่ยน
- FR-5.3 ระบุอุปกรณ์จาก Source IP ของ Trap เทียบกับอุปกรณ์ที่ลงทะเบียน; ถ้าไม่รู้จักให้เก็บเป็น "Unknown Source" ไม่ทิ้ง
- FR-5.4 บันทึกลงตาราง Event: เวลา, อุปกรณ์, Port, ชนิด (Link Up/Down), รายละเอียดดิบ (raw varbinds)
- FR-5.5 หน้า Event Log แบบเรียลไทม์ (WebSocket/SSE) มี Toast แจ้งเตือนเมื่อเกิดเหตุ และกรองตามอุปกรณ์/ชนิด/ช่วงเวลาได้
- FR-5.6 เมื่อได้รับ Trap ให้อัปเดตสี Port บน Panel ทันที
- FR-5.7 มีหน้า/ขั้นตอนตั้งค่า แนะนำคำสั่งบนอุปกรณ์ (ดูภาคผนวก B)

**Acceptance:** สั่ง `shutdown` Port จริงบน EVE-NG แล้วภายใน 2–3 วินาทีมี Event "Link Down" ขึ้นในเว็บ โดยไม่ต้องกด Refresh และ Event มาจาก Trap ไม่ใช่การ Poll

### FR-6 (โบนัส +3) Auto Discovery & Topology

- FR-6.1 ผู้ใช้ระบุ Seed Device (IP + Credential) หรือช่วง Subnet (เช่น 192.168.1.0/24) แล้วกด "Discover"
- FR-6.2 อ่านข้อมูลเพื่อนบ้านจาก **LLDP-MIB** (`lldpRemTable` `1.0.8802.1.1.2.1.4.1.1`) และ **CDP** (`cdpCacheTable` `1.3.6.1.4.1.9.9.23.1.2.1.1`) แล้ว Recursive ไปหาอุปกรณ์ถัดไป (มีตัวป้องกันวนลูป, จำกัดความลึก)
- FR-6.3 เสริมด้วย ARP/MAC table หรือ Ping sweep + SNMP probe สำหรับอุปกรณ์ที่ไม่รองรับ LLDP/CDP
- FR-6.4 สร้างกราฟ Node = อุปกรณ์, Edge = Link พร้อมป้ายชื่อ Port ปลายทางทั้งสองด้าน (เช่น `Gi0/1 ↔ Gi0/2`)
- FR-6.5 แสดงเป็นรูป Topology ลาก/ซูมได้ ไอคอนต่างกันระหว่าง Router/Switch, สีเส้น Link ตามสถานะ (เขียว/แดง)
- FR-6.6 คลิก Node เพื่อเข้าหน้า Port Panel ของอุปกรณ์นั้น (ใช้ FR-2 ซ้ำ) และคลิก Port ดูกราฟได้ต่อ
- FR-6.7 อุปกรณ์ที่ค้นเจอกด "Add to monitoring" ได้; บันทึกตำแหน่ง Node ที่ผู้ใช้ลากจัดไว้
- FR-6.8 Link ที่ Down จาก Trap ต้องเปลี่ยนสีบน Topology ทันที

**Acceptance:** ต่อ Lab EVE-NG 3–5 อุปกรณ์ (เปิด LLDP/CDP) กด Discover แล้วได้แผนภาพตรงกับการต่อจริง

### FR-7 การยืนยันตัวตนและความปลอดภัย (แนะนำ)

- Login ด้วย username/password (รหัสผ่านเก็บแบบ hash), แยกสิทธิ์ Admin/Viewer
- เข้ารหัส/ปกปิด Community และ v3 key ใน DB, ไม่แสดงกลับบนหน้าเว็บ
- เฉพาะ Admin ที่สั่ง SET ได้

## 5. Non-Functional Requirements

| หมวด | ข้อกำหนด |
|---|---|
| ประสิทธิภาพ | รองรับอย่างน้อย 20 อุปกรณ์ / 1,000 Port ที่ Poll ทุก 60 วินาที; หน้า Port Panel โหลดภายใน 3 วินาที |
| ความน่าเชื่อถือ | Poll ล้มเหลว/Timeout ต้องไม่ทำให้ระบบล่ม; Retry 2 ครั้ง; ทำเครื่องหมายอุปกรณ์เป็น Offline |
| ความถูกต้อง | คำนวณ Counter wrap ถูกต้อง; เวลาเก็บเป็น UTC แสดงตาม Timezone ผู้ใช้ |
| ความปลอดภัย | Credential ไม่ปรากฏใน Log; ป้องกัน SQL Injection/XSS; แนะนำ HTTPS |
| การใช้งาน | UI ภาษาไทย/อังกฤษ, ใช้ได้บน Chrome/Edge/Firefox, Responsive ระดับพื้นฐาน |
| การติดตั้ง | `docker compose up` แล้วใช้งานได้; มี README และไฟล์ตัวอย่างการตั้งค่า |
| การขยายตัว | เพิ่ม Vendor ใหม่ได้โดยใช้ MIB มาตรฐาน (IF-MIB) เป็นหลัก ไม่ผูกกับ Cisco อย่างเดียว |

## 6. Data Model (ร่าง)

- **devices:** id, name, ip, snmp_version, community/credentials (เข้ารหัส), device_type, sys_descr, status, last_seen
- **interfaces:** id, device_id, if_index, name, alias, type, speed, mac, admin_status, oper_status
- **traffic_samples:** interface_id, timestamp, in_octets, out_octets, in_bps, out_bps (พร้อมตาราง aggregate แยกตามช่วงเวลา)
- **events:** id, device_id, interface_id, type (link_up/link_down/…), timestamp, source_ip, raw_varbinds
- **audit_logs:** id, user, action, device_id, interface_id, result, timestamp
- **topology_links:** id, device_a, port_a, device_b, port_b, protocol (LLDP/CDP), discovered_at
- **users:** id, username, password_hash, role

## 7. REST API (ร่าง)

| Method | Endpoint | หน้าที่ |
|---|---|---|
| POST | `/api/devices` | เพิ่มอุปกรณ์ |
| GET | `/api/devices` | รายการอุปกรณ์ |
| POST | `/api/devices/test` | ทดสอบ SNMP |
| DELETE | `/api/devices/{id}` | ลบอุปกรณ์ |
| GET | `/api/devices/{id}/interfaces` | ข้อมูล Port ทั้งหมด |
| POST | `/api/interfaces/{id}/admin-status` | สั่ง up/down (`{"status":"down"}`) |
| GET | `/api/interfaces/{id}/traffic?range=day\|week\|month\|year` | ข้อมูลกราฟ |
| GET | `/api/events?device=&type=&from=&to=` | Event log |
| WS | `/ws/events` | Push Trap/สถานะแบบเรียลไทม์ |
| POST | `/api/discovery` | เริ่ม Discovery |
| GET | `/api/topology` | ข้อมูล Node/Link |

## 8. หน้าจอ (UI Screens)

1. **Login**
2. **Dashboard:** จำนวนอุปกรณ์ Online/Offline, Event ล่าสุด
3. **Device List:** ตาราง + ปุ่ม Add
4. **Device Detail:** Port Panel (รูป), ข้อมูลระบบ, ปุ่ม Up/Down ต่อ Port
5. **Port Detail / Traffic Graph:** กราฟ + ตัวเลือก Live/Day/Week/Month/Year
6. **Event Log:** ตารางเรียลไทม์ + ตัวกรอง
7. **Topology (โบนัส):** แผนภาพ + ปุ่ม Discover
8. **Settings:** รอบ Poll, Trap listener, จัดการผู้ใช้

## 9. แผนการทดสอบ (Test Plan)

| ทดสอบ | วิธี | ผลที่คาดหวัง |
|---|---|---|
| เชื่อมต่ออุปกรณ์ EVE-NG | เพิ่ม IP Router/Switch (IOL/vIOS) | ได้ข้อมูลระบบ |
| เชื่อมต่ออุปกรณ์จริง | เพิ่ม Switch จริง | ได้ข้อมูลระบบ |
| Community ผิด/IP ไม่ตอบ | ใส่ค่าผิด | แจ้ง error ชัดเจน ไม่ค้าง |
| Port Panel | เปรียบเทียบกับ `show ip int brief` | ตรงกัน |
| Up/Down | สั่งผ่านเว็บ | สถานะเปลี่ยนจริงบนอุปกรณ์ |
| Traffic Graph | สร้าง Traffic ด้วย ping/iperf | กราฟตรงเวลา ค่า bps สมเหตุสมผล |
| Counter Wrap/รีบูต | Reload อุปกรณ์ | ไม่มี Spike ผิดปกติ |
| Trap | shutdown/no shutdown Port ที่อุปกรณ์ | Event ขึ้นภายในไม่กี่วินาที |
| Discovery | Lab หลายอุปกรณ์ | Topology ตรงกับการต่อจริง |

## 10. Milestones (ตัวอย่างสำหรับโปรเจกต์นักศึกษา ~4–6 สัปดาห์)

| ช่วงเวลา | งาน |
|---|---|
| สัปดาห์ 1 | ตั้ง Lab EVE-NG + เปิด SNMP บนอุปกรณ์, ทดสอบ `snmpwalk`, ออกแบบ DB |
| สัปดาห์ 2 | Device Management + Interface list + Port Panel |
| สัปดาห์ 3 | Poller + Traffic Graph (Live → Daily → Weekly/Monthly/Yearly) |
| สัปดาห์ 4 | Up/Down (SNMP SET) + Trap Receiver + Event Log |
| สัปดาห์ 5 | (โบนัส) Discovery + Topology |
| สัปดาห์ 6 | ทดสอบกับอุปกรณ์จริง, แก้บั๊ก, ทำเอกสาร/สไลด์/Demo |

## 11. ความเสี่ยงและข้อควรระวัง

- **Trap ไม่เข้า:** เช็ค Firewall/Routing ระหว่างอุปกรณ์กับเครื่อง Monitor, IP ปลายทางของ `snmp-server host`, สิทธิ์ port 162
- **SET ไม่ผ่าน:** Community ต้องเป็น RW, ตรวจ ACL ของ SNMP บนอุปกรณ์
- **ข้อมูลรายปีต้องรอเวลา:** ควรเตรียมข้อมูลจำลอง (seed data) สำหรับ Demo กราฟรายเดือน/รายปี และแจ้งอาจารย์ว่าเป็นข้อมูลจำลอง
- **`ifIndex` เปลี่ยนหลังรีบูต:** บน Cisco ใช้ `snmp-server ifindex persist`
- **อุปกรณ์ที่มี counter 32-bit:** Port ความเร็วสูงจะ Wrap เร็ว ให้ Poll ถี่ขึ้นหรือใช้ 64-bit
- **การเปิดสิทธิ์ SET:** เสี่ยงด้านความปลอดภัย ควรจำกัดด้วย ACL ในการใช้งานจริง

---

# ภาคผนวก A: OID ที่ต้องใช้

| ข้อมูล | OID |
|---|---|
| sysDescr / sysUpTime / sysName | `1.3.6.1.2.1.1.1.0` / `1.3.6.1.2.1.1.3.0` / `1.3.6.1.2.1.1.5.0` |
| ifIndex / ifDescr / ifType / ifSpeed | `1.3.6.1.2.1.2.2.1.1` / `.2` / `.3` / `.5` |
| ifPhysAddress | `1.3.6.1.2.1.2.2.1.6` |
| ifAdminStatus (SET ได้) / ifOperStatus | `1.3.6.1.2.1.2.2.1.7` / `.8` |
| ifInErrors / ifOutErrors | `1.3.6.1.2.1.2.2.1.14` / `.20` |
| ifName / ifAlias | `1.3.6.1.2.1.31.1.1.1.1` / `.18` |
| ifHCInOctets / ifHCOutOctets | `1.3.6.1.2.1.31.1.1.1.6` / `.10` |
| linkDown / linkUp (Trap) | `1.3.6.1.6.3.1.1.5.3` / `.5.4` |
| LLDP Remote (ชื่ออุปกรณ์ / พอร์ตปลายทาง) | `1.0.8802.1.1.2.1.4.1.1.9` / `.7` |
| CDP Device ID / Port | `1.3.6.1.4.1.9.9.23.1.2.1.1.6` / `.7` |

# ภาคผนวก B: ตัวอย่างการตั้งค่าบน Cisco (IOS)

```
snmp-server community public RO
snmp-server community private RW
snmp-server ifindex persist
snmp-server enable traps snmp linkdown linkup
snmp-server host <IP เครื่อง Monitor> version 2c public
lldp run
! CDP เปิดอยู่เป็นค่าเริ่มต้น (cdp run)
```

> หมายเหตุ: ใน Lab ควรใช้ community ที่เดายากขึ้นและใช้ ACL จำกัด เพราะ RW community สามารถเปลี่ยน config อุปกรณ์ได้
