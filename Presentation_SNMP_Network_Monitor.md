# SNMP Network Monitor
## ระบบตรวจสอบและจัดการอุปกรณ์เครือข่าย

---

# สไลด์ 1: ภาพรวมโปรเจค

## SNMP Network Monitor

**ระบบเว็บแอปพลิเคชันสำหรับตรวจสอบและควบคุมอุปกรณ์เครือข่าย**

- 🌐 Monitor อุปกรณ์ Router/Switch ผ่าน SNMP
- 📊 แสดงสถานะแบบ Real-time
- 🎛️ ควบคุม Port (Up/Down)
- 📈 กราฟ Traffic วิเคราะห์ Bandwidth
- 🔔 รับ SNMP Trap แบบทันที
- 🗺️ Auto Discovery & Topology

**เทคโนโลยี:** Python FastAPI + React TypeScript

---

# สไลด์ 2: ฟีเจอร์หลัก (1/3)

## 1️⃣ Device Management
- ใส่แค่ IP เดียว → ระบบดึงข้อมูลอัตโนมัติ
- รองรับ EVE-NG และอุปกรณ์จริง
- Test Connection ก่อนบันทึก
- Auto Scan Network + Serial COM Port

## 2️⃣ Port Panel View
- แสดง Port เป็นรูปภาพ
- สีสถานะ: 🟢 Up | 🔴 Down | ⚫ Admin Down
- Tooltip รายละเอียด (MAC, Speed, IP)
- อัพเดทเรียลไทม์ทุก 30 วินาที

---

# สไลด์ 3: ฟีเจอร์หลัก (2/3)

## 3️⃣ Interface Control
- คลิกขวา Port → Shutdown / No Shutdown
- ส่ง SNMP SET command
- Verify status หลังสั่งงาน
- บันทึก Audit Log ทุกครั้ง

## 4️⃣ Traffic Graph
- แสดงกราฟ In/Out bandwidth
- ช่วงเวลา: Live, Daily, Weekly, Monthly, Yearly
- หน่วย: Kbps / Mbps / Gbps อัตโนมัติ
- แสดง Min / Avg / Max

---

# สไลด์ 4: ฟีเจอร์หลัก (3/3)

## 5️⃣ SNMP Trap Receiver
- รับ Link Up/Down แบบทันที
- WebSocket push ไปหน้าเว็บ
- ไม่ต้อง Refresh
- บันทึกประวัติเหตุการณ์

## 6️⃣ Auto Discovery
- Network Scan (SNMP)
- CDP/LLDP Discovery
- Passive CDP Capture
- Topology Visualization
- รองรับอุปกรณ์ที่ไม่มี IP

---

# สไลด์ 5: ฟีเจอร์พิเศษ

## 7️⃣ Serial Console Support
- เชื่อมต่อผ่าน USB-to-Serial (Console Cable)
- Web Serial API (Chrome/Edge)
- Auto Scan COM Port
- อ่าน Interface จาก CLI
- ดึง CDP Neighbor

**ข้อจำกัด:** ไม่รองรับการสั่ง Up/Down (ต้องใช้ SNMP)

---

# สไลด์ 6: สถาปัตยกรรม

```
┌─────────────────┐
│   Browser       │
│  React + WS     │
└────────┬────────┘
         │ REST API + WebSocket
┌────────▼────────────────┐
│   Backend (FastAPI)     │
│  ┌──────┬──────┬──────┐ │
│  │ API  │Poller│ Trap │ │
│  └──────┴──────┴──────┘ │
└────────┬────────────────┘
         │ SNMP
┌────────▼────────────────┐
│ Router / Switch         │
│ Physical / EVE-NG       │
└─────────────────────────┘
```

---

# สไลด์ 7: หน้าจอหลัก

## User Interface

1. **Dashboard** - ภาพรวมสถานะ
2. **Devices** - รายการอุปกรณ์
3. **Device Detail** - Port Panel
4. **Traffic** - กราฟแบบเรียลไทม์
5. **Topology** - แผนภาพเครือข่าย
6. **Events** - รายการเหตุการณ์
7. **Settings** - ตั้งค่าระบบ

---

# สไลด์ 8: กรณีใช้งานจริง

## ตัวอย่างการใช้งาน

### เพิ่มอุปกรณ์
1. กด "เพิ่มด้วย IP"
2. ใส่ IP: `192.168.213.131`
3. กด "Test Connection"
4. ระบบดึงข้อมูลอัตโนมัติ
5. บันทึก

### Shutdown Port
1. คลิกอุปกรณ์ → Port Panel
2. คลิกขวา Port → Shutdown
3. ยืนยัน → Port เปลี่ยนสีทันที

---

# สไลด์ 9: ผลการทดสอบ

## สิ่งที่ทดสอบแล้ว ✅

- เชื่อมต่อ EVE-NG Router/Switch
- เชื่อมต่อ Serial Console (COM port)
- อ่านสถานะ Port ทั้งหมด
- สั่ง Shutdown/No Shutdown
- รับ SNMP Trap แบบเรียลไทม์
- แสดงกราฟ Traffic
- Network Scan (SNMP)
- Auto Discovery (CDP/LLDP)
- Passive CDP Capture
- Topology Visualization
- No-IP Device Detection

---

# สไลด์ 10: เทคโนโลยีที่ใช้

## Tech Stack

**Backend:**
- Python 3.8+
- FastAPI
- pysnmp
- SQLite

**Frontend:**
- React 18
- TypeScript
- Vite
- Chart.js

**Protocol:**
- SNMP v2c/v3
- CDP/LLDP
- Web Serial API
- WebSocket

---

# สไลด์ 11: วิธีติดตั้ง

## Installation

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

**URL:**
- Frontend: http://localhost:5173/
- Backend API: http://localhost:8000/

---

# สไลด์ 12: SNMP OID ที่ใช้

## OID Reference

**System Info:**
- sysDescr: `1.3.6.1.2.1.1.1.0`
- sysName: `1.3.6.1.2.1.1.5.0`
- sysUpTime: `1.3.6.1.2.1.1.3.0`

**Interface:**
- ifAdminStatus: `1.3.6.1.2.1.2.2.1.7`
- ifOperStatus: `1.3.6.1.2.1.2.2.1.8`

**Traffic Counters:**
- ifHCInOctets: `1.3.6.1.2.1.31.1.1.1.6`
- ifHCOutOctets: `1.3.6.1.2.1.31.1.1.1.10`

---

# สไลด์ 13: ความปลอดภัย

## Security Features

✅ SNMP Community เข้ารหัสใน Database
✅ Audit Log บันทึกทุกการกระทำ
✅ Confirmation ก่อนสั่ง Shutdown
✅ รองรับ Read-Only Mode
✅ ACL Support

**Best Practice:**
- ใช้ Community แบบ Read-Write เฉพาะที่จำเป็น
- จำกัดสิทธิ์ด้วย ACL
- เข้ารหัส Credential
- Log ทุกการเปลี่ยนแปลง

---

# สไลด์ 14: ฟีเจอร์เด่น

## Highlights

🎯 **Auto-Detection** - ใส่แค่ IP เดียว
⚡ **Real-time Update** - WebSocket push
🎨 **Visual Port Panel** - แสดงเป็นรูปภาพ
🔌 **Multiple Methods** - SNMP + Serial + CDP
🌐 **No-IP Support** - แสดงอุปกรณ์ที่ยังไม่มี IP

**ข้อดี:**
- ใช้งานง่าย
- Real-time
- รองรับหลายวิธี
- ทำงานกับ EVE-NG และอุปกรณ์จริง

---

# สไลด์ 15: Demo & Q&A

## Live Demo

🔗 GitHub: https://github.com/BigCowsunny/Assignment-3-Netprogramming

📊 **สาธิต:**
1. เพิ่มอุปกรณ์แบบอัตโนมัติ
2. แสดง Port Panel
3. สั่ง Shutdown Port
4. ดูกราฟ Traffic
5. Auto Discovery
6. Topology Map

## Questions?

ขอบคุณครับ 🙏
