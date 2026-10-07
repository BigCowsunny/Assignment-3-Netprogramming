# SNMP Network Monitor
## ระบบตรวจสอบและจัดการอุปกรณ์เครือข่าย

---

## 📋 ภาพรวมโปรเจค

**ชื่อโปรเจค:** SNMP Network Monitor  
**วัตถุประสงค์:** ระบบเว็บแอปพลิเคชันสำหรับตรวจสอบและควบคุมอุปกรณ์เครือข่าย (Router/Switch) ผ่านโปรโตคอล SNMP

**เทคโนโลยีหลัก:**
- **Backend:** Python FastAPI + pysnmp
- **Frontend:** React + TypeScript + Vite
- **Database:** SQLite
- **Communication:** REST API + WebSocket

---

## 🎯 ฟังก์ชันการทำงานหลัก

### 1. การจัดการอุปกรณ์ (Device Management)
- **เพิ่มอุปกรณ์:** ใส่ IP Address + SNMP Community
- **Auto-Probe:** ระบบดึงข้อมูลอัตโนมัติ (ชื่อ, รุ่น, ประเภท, จำนวน Port)
- **Test Connection:** ทดสอบการเชื่อมต่อ SNMP ก่อนบันทึก
- **แก้ไข/ลบ:** จัดการอุปกรณ์ที่บันทึกไว้
- **Auto Scan:** สแกนหาอุปกรณ์ในเครือข่ายอัตโนมัติ (Network + Serial COM)

**วิธีการทางเทคนิค:**
- SNMP GET: `sysDescr`, `sysName`, `sysUpTime`
- SNMP WALK: `ifTable` / `ifXTable` เพื่ออ่าน interface

---

### 2. การแสดงสถานะ Port (Port Panel View)
- **แสดงรูป Port:** วาด Port Panel แบบ visual ตามจำนวนจริง
- **สีสถานะ:**
  - 🟢 เขียว = oper up (ทำงานปกติ)
  - 🔴 แดง = oper down (admin up แต่ไม่มีสัญญาณ)
  - ⚫ เทา = admin down (ถูกปิดโดยผู้ดูแล)
  - 🟡 เหลือง = มี error
- **Tooltip:** แสดงรายละเอียด (ชื่อ, ความเร็ว, MAC, IP, สถานะ)
- **Real-time Update:** อัพเดทสีอัตโนมัติทุก 30 วินาที และทันทีเมื่อได้รับ Trap

**วิธีการทางเทคนิค:**
- อ่าน `ifAdminStatus`, `ifOperStatus` จาก IF-MIB
- Poll ทุก 30-60 วินาที เพื่ออัพเดทสถานะ

---

### 3. การควบคุม Interface (Up/Down Control)
- **Shutdown/No Shutdown:** คลิกขวา Port เพื่อสั่ง up/down
- **Confirmation:** ขอยืนยันก่อนทำการเปลี่ยนแปลง
- **Verify Status:** อ่านค่ากลับเพื่อยืนยันผลลัพธ์
- **Audit Log:** บันทึกประวัติการสั่งงาน (ใคร, เมื่อไร, Port ไหน)

**วิธีการทางเทคนิค:**
- SNMP SET: `ifAdminStatus` (1=up, 2=down)
- ต้องใช้ Community แบบ Read-Write (RW)

---

### 4. กราฟ Traffic (Traffic Graph)
- **แสดงกราฟ:** In/Out bandwidth แบบเรียลไทม์
- **หน่วย:** bps (Kbps/Mbps/Gbps อัตโนมัติ)
- **ช่วงเวลา:**
  - 📊 Live (เรียลไทม์)
  - 📅 Daily (รายวัน)
  - 📆 Weekly (รายสัปดาห์)
  - 🗓️ Monthly (รายเดือน)
  - 📈 Yearly (รายปี)
- **ข้อมูล:** Min/Avg/Max/Current bandwidth

**วิธีการทางเทคนิค:**
- Poll `ifHCInOctets` / `ifHCOutOctets` ทุก 60 วินาที
- คำนวณ: (octets ปัจจุบัน − octets ก่อนหน้า) × 8 ÷ ช่วงเวลา
- จัดการ Counter Wrap และ Downsampling

---

### 5. รับ SNMP Trap (Event Log)
- **Real-time Notification:** แจ้งเตือนเหตุการณ์แบบทันที
- **ประเภท Event:**
  - Link Down (สาย/Port ขาด)
  - Link Up (สาย/Port กลับมาทำงาน)
- **WebSocket Push:** ส่งข้อมูลไปหน้าเว็บโดยไม่ต้อง refresh
- **Event History:** บันทึกประวัติเหตุการณ์ทั้งหมด
- **Filter:** กรองตามอุปกรณ์/ประเภท/เวลา

**วิธีการทางเทคนิค:**
- ฟัง UDP port 162 (SNMP Trap receiver)
- แกะ `linkDown` / `linkUp` trap
- ระบุ `ifIndex`, `ifOperStatus` จาก varbind

---

### 6. Auto Discovery & Topology (โบนัส)
- **Network Scan:** สแกนหาอุปกรณ์ในเครือข่ายผ่าน SNMP
- **CDP/LLDP Discovery:** อ่าน neighbor table เพื่อหาการเชื่อมต่อ
- **Topology Map:** แสดงแผนภาพเครือข่ายแบบ interactive
- **Passive CDP Capture:** รับ CDP/LLDP frame โดยตรงจาก NIC
- **No-IP Device Support:** แสดงอุปกรณ์ที่ยังไม่มี IP (จาก CDP)
- **Shared Network:** จัดกลุ่มอุปกรณ์ที่ต่อกัน hub/shared segment

**วิธีการทางเทคนิค:**
- อ่าน LLDP-MIB / CDP-MIB neighbor table
- Recursive discovery (มี loop prevention)
- Packet capture สำหรับ passive CDP/LLDP
- ARP/MAC table analysis

---

### 7. Serial Console Support
- **Web Serial API:** เชื่อมต่อผ่าน USB-to-Serial (Console Cable)
- **Auto Scan COM Port:** สแกน COM port อัตโนมัติ
- **Parse Interface:** อ่าน `show ip interface brief`
- **CDP Neighbor:** อ่าน `show cdp neighbors detail`
- **Topology Integration:** เพิ่มอุปกรณ์และสายจาก CDP ลง Topology
- **Hostname Detection:** ดึงชื่อจาก Router prompt/config

**ข้อจำกัด:**
- ใช้ได้เฉพาะ Chrome/Edge (Web Serial API)
- ไม่รองรับการสั่ง Up/Down (ต้องใช้ SNMP)

---

## 📊 สถาปัตยกรรมระบบ

```
┌──────────────────────────────────────────────────────────┐
│                    Browser (Frontend)                     │
│  React + TypeScript + Chart.js + WebSocket Client       │
└───────────┬────────────────────────────────┬─────────────┘
            │ REST API                       │ WebSocket
            ↓                                ↓
┌───────────────────────────────────────────────────────────┐
│              Backend Server (FastAPI)                     │
│  ┌──────────────┬──────────────┬─────────────────────┐  │
│  │ REST API     │ SNMP Poller  │ Trap Receiver       │  │
│  │ Handler      │ (60s cycle)  │ (UDP 162)           │  │
│  └──────────────┴──────────────┴─────────────────────┘  │
└───────────────────────────┬───────────────────────────────┘
                            ↓
                    ┌───────────────┐
                    │ SQLite        │
                    │ Database      │
                    └───────────────┘
                            ↑
                            │ SNMP GET/SET/WALK
                            │ (UDP 161)
┌───────────────────────────┴───────────────────────────────┐
│              Router / Switch / Network Devices            │
│         (Physical Hardware / EVE-NG / Console)            │
└───────────────────────────────────────────────────────────┘
```

---

## 🔧 การติดตั้งและใช้งาน

### ความต้องการระบบ
- Python 3.8+ 
- Node.js 16+
- Chrome/Edge (สำหรับ Serial Console)
- Npcap (Windows, สำหรับ CDP capture)

### วิธีติดตั้ง (Windows)
```bash
# ดับเบิลคลิก run.bat
# หรือใช้คำสั่ง:

# Backend
cd backend
python -m pip install -r requirements.txt
python run_backend.py

# Frontend
npm install
npm run dev
```

### การเข้าใช้งาน
- Frontend: http://localhost:5173/
- Backend API: http://localhost:8000/
- API Docs: http://localhost:8000/docs

---

## 🎨 ส่วนติดต่อผู้ใช้ (UI)

### หน้าหลัก (Dashboard)
- ภาพรวมสถานะอุปกรณ์
- จำนวนอุปกรณ์ Online/Offline
- Event ล่าสุด
- Traffic Overview

### หน้าอุปกรณ์ (Devices)
- รายการอุปกรณ์ทั้งหมด
- สถานะเรียลไทม์
- ปุ่ม: Auto Scan All, Refresh, Network Scan, COM Port Scan

### หน้า Device Detail
- Port Panel แบบภาพ
- ข้อมูลระบบ (hostname, uptime, version)
- สถานะแต่ละ Port

### หน้า Traffic
- กราฟ Real-time
- เลือกช่วงเวลา
- Traffic statistics

### หน้า Topology
- แผนภาพเครือข่าย
- ลาก/ซูมได้
- คลิกโหนดเพื่อดูรายละเอียด
- แสดงสาย Link + Port

### หน้า Events
- รายการเหตุการณ์แบบเรียลไทม์
- กรองตามอุปกรณ์/ประเภท
- แจ้งเตือนแบบ Toast

---

## 🔐 ความปลอดภัย

- **SNMP Community:** เข้ารหัสใน Database
- **Audit Log:** บันทึกการกระทำทั้งหมด
- **Confirmation:** ขอยืนยันก่อนสั่ง Shutdown
- **ACL Support:** รองรับ SNMP Access Control List
- **Read-Only Mode:** รองรับ Community แบบ RO

---

## 📈 ผลการทดสอบ

### สิ่งที่ทดสอบแล้ว
✅ เชื่อมต่อ EVE-NG Router/Switch  
✅ เชื่อมต่อ Serial Console (COM port)  
✅ อ่านสถานะ Port ทั้งหมด  
✅ สั่ง Shutdown/No Shutdown  
✅ รับ SNMP Trap แบบเรียลไทม์  
✅ แสดงกราฟ Traffic  
✅ Network Scan (SNMP)  
✅ Auto Discovery (CDP/LLDP)  
✅ Passive CDP Capture  
✅ Topology Visualization  
✅ No-IP Device Detection  

### อุปกรณ์ที่รองรับ
- Cisco Router (IOS/IOSv)
- Cisco Switch (IOS/IOL L2)
- อุปกรณ์ที่รองรับ SNMP v2c/v3
- อุปกรณ์ที่รองรับ CDP/LLDP

---

## 🎯 การใช้งานจริง

### กรณีใช้งาน 1: เพิ่มอุปกรณ์จาก EVE-NG
1. ไปหน้า Devices
2. กด "เพิ่มด้วย IP"
3. ใส่ IP: `192.168.213.131`
4. กด "Test Connection"
5. ระบบดึงข้อมูลอัตโนมัติ (ชื่อ, ประเภท, vendor)
6. กด "บันทึกอุปกรณ์"

### กรณีใช้งาน 2: Shutdown Port
1. คลิกอุปกรณ์เพื่อดู Port Panel
2. คลิกขวาที่ Port
3. เลือก "Shutdown"
4. ยืนยัน
5. Port เปลี่ยนเป็นสีเทาทันที

### กรณีใช้งาน 3: ดูกราฟ Traffic
1. คลิก Port ที่ต้องการ
2. กราฟแสดงอัตโนมัติ
3. เลือกช่วงเวลา (Live/Day/Week/Month/Year)

### กรณีใช้งาน 4: Auto Discovery
1. ไปหน้า Topology
2. ใส่ IP seed device หรือเว้นว่าง
3. ใส่ SNMP community
4. กด "Discover"
5. รอสักครู่ แผนภาพจะแสดงอุปกรณ์ทั้งหมด

### กรณีใช้งาน 5: Serial Console
1. เสียบสาย Console USB
2. เปิดหน้า Devices
3. กด "Auto Scan All" หรือ "Scan COM Port"
4. ระบบจะหาอุปกรณ์อัตโนมัติ

---

## 📚 OID ที่ใช้ใน SNMP

### System Information
- `sysDescr`: `1.3.6.1.2.1.1.1.0`
- `sysName`: `1.3.6.1.2.1.1.5.0`
- `sysUpTime`: `1.3.6.1.2.1.1.3.0`

### Interface (IF-MIB)
- `ifIndex`: `1.3.6.1.2.1.2.2.1.1`
- `ifDescr`: `1.3.6.1.2.1.2.2.1.2`
- `ifAdminStatus`: `1.3.6.1.2.1.2.2.1.7`
- `ifOperStatus`: `1.3.6.1.2.1.2.2.1.8`

### High Capacity Counters
- `ifHCInOctets`: `1.3.6.1.2.1.31.1.1.1.6`
- `ifHCOutOctets`: `1.3.6.1.2.1.31.1.1.1.10`

### Trap
- `linkDown`: `1.3.6.1.6.3.1.1.5.3`
- `linkUp`: `1.3.6.1.6.3.1.1.5.4`

### Discovery
- LLDP Remote: `1.0.8802.1.1.2.1.4.1.1`
- CDP Cache: `1.3.6.1.4.1.9.9.23.1.2.1.1`

---

## 🚀 ฟีเจอร์เด่น

### 1. Auto-Detection
- ใส่แค่ IP เดียว ระบบดึงข้อมูลทั้งหมดเอง
- ไม่ต้องใส่ชื่อ ประเภท หรือจำนวน Port

### 2. Real-time Update
- ใช้ WebSocket ส่งข้อมูลแบบ push
- ไม่ต้องกด Refresh
- แสดงผลทันทีเมื่อมีการเปลี่ยนแปลง

### 3. Visual Port Panel
- แสดง Port เป็นรูปภาพ
- สีสะท้อนสถานะจริง
- Tooltip แสดงรายละเอียดครบ

### 4. Multiple Detection Methods
- SNMP (standard)
- Serial Console (USB cable)
- Network Scan (subnet)
- CDP/LLDP (passive + active)

### 5. No-IP Support
- แสดงอุปกรณ์ที่ยังไม่มี IP
- ตรวจพบผ่าน CDP/LLDP
- อัพเดท IP ภายหลังได้

---

## 📝 สรุป

SNMP Network Monitor เป็นระบบเว็บแอปพลิเคชันที่ช่วยให้ผู้ดูแลเครือข่ายสามารถ:

✅ **ตรวจสอบ** สถานะอุปกรณ์และ Port แบบเรียลไทม์  
✅ **ควบคุม** Interface (Shutdown/No Shutdown)  
✅ **วิเคราะห์** Traffic ด้วยกราฟแบบหลายช่วงเวลา  
✅ **รับแจ้ง** เหตุการณ์ผ่าน SNMP Trap แบบทันที  
✅ **ค้นพบ** อุปกรณ์และ Topology อัตโนมัติ  
✅ **เชื่อมต่อ** ผ่าน SNMP, Serial Console, CDP/LLDP  

**ข้อดี:**
- ใช้งานง่าย ไม่ซับซ้อน
- รองรับหลายวิธีในการเชื่อมต่อ
- แสดงผลแบบ real-time
- รองรับอุปกรณ์ที่ไม่มี IP
- ทำงานกับ EVE-NG และอุปกรณ์จริง

---

## 👥 Credits

**โปรเจค:** Assignment 3 - Network Programming  
**เทคโนโลジี:** Python, FastAPI, React, TypeScript, SNMP  
**GitHub:** https://github.com/BigCowsunny/Assignment-3-Netprogramming

---

# ขอบคุณ
## Thank You!
