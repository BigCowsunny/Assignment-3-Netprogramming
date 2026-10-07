# Assignment-3-Netprogramming
งาน Assignment 3 

## เปิดทั้ง API และหน้าเว็บบน Windows

ดับเบิลคลิก **`run.bat`** ในโฟลเดอร์หลัก ระบบจะเปิดหน้าต่าง FastAPI ที่พอร์ต 8000 และหน้าเว็บที่พอร์ต 5173 แยกกัน พร้อมเปิดเบราว์เซอร์เมื่อหน้าเว็บพร้อม ใช้ `Ctrl+C` ในแต่ละหน้าต่างเพื่อหยุดบริการ

- ต้องติดตั้ง Python 3 และ Node.js ก่อนใช้ ครั้งแรกไฟล์จะสร้าง `.venv` หากยังไม่มี Virtual Environment และติดตั้ง Dependencies ที่ขาดให้อัตโนมัติ จึงต้องเชื่อมต่ออินเทอร์เน็ต
- ถ้ามี Virtual Environment ใน `.venv`, `venv`, `backend/.venv` หรือ `backend/venv` จะเลือก Python ในนั้นก่อน และต้องติดตั้ง Dependencies ด้วย Python ตัวเดียวกัน
- ถ้า API หรือเว็บ NetSmonitor พร้อมอยู่แล้วจะใช้บริการเดิมและเปิดเว็บให้ หากโปรแกรมอื่นใช้พอร์ต 8000 หรือ 5173 จะแจ้งให้หยุดบริการเดิมก่อน โดยไม่หยุด Process ให้อัตโนมัติ
- ใช้ `run.bat check` เพื่อตรวจและเตรียม Dependencies โดยไม่เปิดบริการ

## เชื่อมต่ออุปกรณ์จริงและ EVE-NG

- เพิ่มอุปกรณ์จากหน้า **เพิ่มด้วย IP** โดยใส่ Management IP, SNMP community และ UDP port (ปกติ 161) ระบบทดสอบ `sysDescr` และอ่าน interface จาก IF-MIB ก่อนบันทึก
- ไม่เชื่อมต่อ EVE-NG API; การ Monitor/Config ใช้ SNMP โดย node ต้องมี Management IP ที่เครื่อง Backend เข้าถึงได้และเปิด SNMP ส่วนอุปกรณ์ที่ยังไม่มี IP สามารถแสดงเป็น CDP neighbor ได้ตามหัวข้อด้านล่าง
- ปุ่ม **Discover** เริ่มจาก Management IP หนึ่งตัว หรือเว้นว่างเพื่อใช้อุปกรณ์ที่พบแล้ว ไม่บังคับ subnet; CIDR เป็นตัวเลือกเสริมสำหรับ SNMP sweep แล้วไล่ neighbor ต่อ
- Trap จาก IP ที่ยังไม่เคยลงทะเบียนจะเพิ่มอุปกรณ์ให้อัตโนมัติเมื่อ Trap Receiver ตรวจสอบด้วย SNMP GET และอ่าน IF-MIB จาก IP นั้นสำเร็จ อุปกรณ์ต้องส่ง linkUp/linkDown Trap และ community ใน Trap ต้องอ่าน SNMP ของ node ได้ จากนั้นอุปกรณ์จะแสดงทันทีผ่าน WebSocket
- ตั้งค่าอุปกรณ์ให้ส่ง linkUp/linkDown Trap ไปยัง IP ของเครื่อง Backend และ UDP port ของ Trap Receiver (ปกติ 162; อาจเป็น 1162 หาก bind 162 ไม่ได้) และอนุญาต UDP ขาเข้าที่ firewall
- การสั่ง interface up/down ต้องใช้ community ที่มีสิทธิ์เขียน (`RW`) ระบบจะส่ง SNMP SET และอ่าน `ifAdminStatus` กลับมาตรวจ การแก้ไข community/UDP port จะ probe และอ่าน interface จริงอีกครั้ง
- กราฟ In/Out มาจาก SNMP octet counters และเริ่มมีจุดหลัง poller อ่าน counter ได้อย่างน้อยสองรอบ (poll ทุก 60 วินาที) ช่วงวัน/สัปดาห์/เดือน/ปีแสดงเท่าที่เก็บข้อมูลจริงไว้
- Auto Discovery อ่าน CDP/LLDP neighbor table ผ่าน SNMP แล้วไล่ต่อจาก neighbor ที่มี IP ใช้ community ที่กรอก/บันทึกไว้ พร้อมป้องกันวนซ้ำ จำกัดปกติ 64 IP และ 8 hops; อุปกรณ์ไม่มี IP แสดง node/สายจาก reporter ได้ แต่ค้นต่อหรือ Config ไม่ได้

## ตรวจพบอุปกรณ์ที่ไม่มี IP ด้วย CDP/LLDP

1. ติดตั้ง dependency ด้วย `python -m pip install -r backend/requirements.txt` แล้วเริ่ม backend ด้วย `python -m uvicorn main:app --app-dir backend --port 8000` และ frontend ด้วย `npm install` แล้ว `npm run dev`
2. บน Windows ต้องมี [Npcap](https://npcap.com/) และสิทธิ์เปิด packet capture ตัวรับจะเริ่มพร้อม backend หรือกด **ตรวจจับ CDP/LLDP** ในหน้าอุปกรณ์เพื่อเริ่ม/ลองใหม่ สถานะดูได้ที่ `/api/discovery/cdp/status` และ `/api/health`
3. เปิด CDP หรือ LLDP บนพอร์ต Router/Switch ที่เชื่อมถึง NIC ของ backend แล้วรอ neighbor advertisement ระบบไม่ส่ง packet หรือสั่ง config เพื่อค้นหา
4. อุปกรณ์จะปรากฏพร้อม **ไม่มี IP · Config ไม่ได้** และคำเตือนในรายละเอียด ปุ่ม Up/Down และ Traffic ถูกปิด พร้อมป้องกันที่ API ด้วย อุปกรณ์หลายตัวที่ไม่มี IP ใช้ Device/Chassis ID, MAC และ IP ประกอบการระบุตัวตน; ชื่อทั่วไปที่ไม่มี strong ID ใช้ reporter/local port แยก ไม่รวมด้วยชื่อ `Switch` อย่างเดียว
5. ใช้ปุ่ม **ตั้งค่า IP/SNMP** เมื่ออุปกรณ์มี Management IP แล้ว ระบบต้องอ่าน SNMP และ IF-MIB สำเร็จก่อนเปิดใช้งาน โดยคง ID และเส้น Topology เดิม

**ขอบเขตข้อมูล:** CDP ให้ชื่ออุปกรณ์ รุ่น และพอร์ตที่ประกาศ ไม่ใช่รายการพอร์ตทั้งหมดหรือสถานะ Up/Down/Traffic ของทุกพอร์ต รายการที่ยังไม่ได้ยืนยัน SNMP จะใช้สถานะพอร์ต `unknown` แม้ CDP ประกาศ IP มาด้วย เมื่อ advertisement TTL หมดจะเก็บรายการไว้เป็น offline

**ตำแหน่งที่ตรวจพบ:** การรับเฟรมโดยตรงเห็นเฉพาะ CDP ที่มาถึง NIC ของ backend ไม่เห็นทุกอุปกรณ์หลัง switch อัตโนมัติ หากใช้ EVE-NG ต้องเชื่อม lab กับ NIC/bridge ที่ backend รับเฟรมได้ หรือ Monitor switch/router ตัวกลางผ่าน SNMP แล้วกด Network Scan/Discover เพื่ออ่าน CDP-MIB ของตัวกลาง ไม่ใช้ EVE-NG API

ตัวเลือก environment ของ backend:

- `NETFIX_CDP_ENABLED=false` ปิด passive CDP/LLDP capture (neighbor MIB ยังใช้ได้)
- `NETFIX_CDP_INTERFACES` เลือก interface ชื่อ/ID ตาม Scapy หลายรายการคั่นด้วย comma หากไม่ระบุจะฟัง NIC ที่พบ ยกเว้น loopback

## Tests

วิธีแก้ Trap ที่ชื่ออุปกรณ์เป็น Unknown เมื่อส่งผ่าน NAT/relay และตัวอย่าง config อยู่ใน [ชื่ออุปกรณ์ใน Trap](docs/TRAP_DEVICE_NAMES_TH.md)

```powershell
python -m pip install -r backend/requirements-dev.txt
python -m unittest discover -s tests -p "test_*.py" -v
npm ci
npm run test:discovery
npm run build
```

Tests ใช้ SQLite ชั่วคราว, CDP/LLDP frame/pcap จำลอง และ mock SNMP เพื่อไม่ส่ง SET ไปอุปกรณ์จริง ครอบคลุม no-IP discovery, TTL, dedup, CDP-MIB links, API guard, การเพิ่ม IP ภายหลัง, SNMP WALK, Trap regression และ UI เดิม

## Discovery และสาย Topology

- หน้า Topology ใช้ toolbar เดิม: ช่องแรกใส่ IP / CIDR หรือปล่อยว่าง ช่องที่สองใส่ communities คั่นด้วย comma หรือใช้ของ managed devices ที่บันทึกไว้
- RO เพียงพอสำหรับ Discovery หากอ่าน IF-MIB และ CDP-MIB/LLDP-MIB ได้; RW จำเป็นสำหรับสั่ง interface up/down
- สายอ้างอิง local/remote port จริง: CDP ใช้ ifIndex; LLDP map local port ID/description/MAC ไป IF-MIB ไม่ถือว่า lldpLocPortNum เป็น ifIndex และไม่เดาสายจาก subnet เดียวกัน
- SNMP timeout / missing credentials / port ที่ map ไม่ได้ แสดงในสถานะ Discovery ขณะที่ข้อมูล passive ยังคงอยู่
- อ่าน neighbor ซ้ำอัตโนมัติทุก 60 วินาทีเมื่อมี managed device; เปลี่ยนได้ด้วย `NETFIX_DISCOVERY_INTERVAL` (ขั้นต่ำ 15 วินาที) หน้าเว็บดึง Topology ล่าสุดทุก 15 วินาที
- Snapshot ที่อ่านครบแทนที่สายของ reporter/protocol นั้น; ถ้าอ่านไม่ครบไม่ล้างทันที Observation ของสายหมดอายุหลัง 180 วินาที รายงานจากอีกฝั่งที่ยังไม่ refresh อาจคงอยู่จนอ่านสำเร็จหรือ TTL หมด
- หากมีแค่ hostname ที่ซ้ำและไม่มี MAC/chassis/address ที่ระบุตัวตนได้ ไม่สามารถพิสูจน์ว่าเป็นอุปกรณ์เดียวกันได้ ระบบเก็บแยกตามขอบเขตข้อมูล
- CDP cache ที่ไม่มี strong ID จับคู่กับ passive advertisement ได้เมื่อ MAC ของ local port reporter ยืนยัน NIC/segment เดียวกัน และ Device ID/remote Port ID ตรงกับตัวเดียว หากกำกวมจะแสดงแยกและเก็บ observations ไว้
- สายคือความสัมพันธ์จาก neighbor table; shared EVE Net/bridge อาจทำให้เห็นหลาย neighbors บนพอร์ตเดียวกัน จำนวนนี้ไม่ใช่จำนวนสายที่อ่านจาก EVE API
- การแสดงผลตัดรายงานซ้ำ A↔B ด้วย device ID + ชื่อพอร์ตที่ normalize แล้ว รวมชื่อพอร์ตย่อ/เต็มและรายงาน CDP/LLDP หากพบ neighbor ครบทุกคู่บนพอร์ตเดียวกันของอุปกรณ์ตั้งแต่ 3 ตัว จะแสดงเป็นจุด “เครือข่ายร่วม” พร้อมหนึ่งเส้นต่อพอร์ต โดยยังแสดงลิงก์ที่ใช้คนละพอร์ตแยกตามเดิม จุดนี้เป็นการจัดกลุ่มภาพจากข้อมูล neighbor ไม่ใช่อุปกรณ์ SNMP เพิ่มเติม; ข้อมูลไม่ครบหรือสามเหลี่ยมที่ใช้ต่างพอร์ตจะไม่ถูกจัดกลุ่ม
- API: `POST /api/discovery/jobs` → job ID, `GET /api/discovery/jobs/{id}` → progress/result; `/api/discovery` และ `/api/network/scan` ยังรองรับแบบรอผล ป้องกันงาน Discovery ซ้อนกัน
- Passive capture health แสดง CDP/LLDP received counters; capture ต่อเนื่องบน NIC ที่เลือก

### Lab ปัจจุบัน

ผลอ่านจริง 1 ต.ค. 2026: ตอนเริ่มรับ CDP ได้ 2 nodes และยังไม่มีสาย ต่อมา R2/R3 เริ่มตอบ SNMP จึงยืนยันผ่านหน้าเว็บได้ครบ **3 nodes / 4 neighbor links**: R2 (192.168.8.135), R3 (192.168.8.136), Switch (ไม่มี IP, Config ไม่ได้)

เพื่อให้พบครบและอ่านสาย ต้องเปิดพอร์ตที่ต่อสาย, เปิด CDP/LLDP และตั้ง SNMP RO บน seed กับอุปกรณ์ที่จะค้นต่อ จากนั้นใส่ IP/RO community ใน Discover ไม่ต้องระบุ subnet อุปกรณ์ปลายทางไม่มี IP ยังแสดงได้จาก neighbor table ของตัวกลาง ระบบไม่ใช้ EVE-NG API และไม่เปลี่ยน config ใน lab ระหว่าง Tests

รายการงานและผลทดสอบล่าสุดอยู่ใน [TASKS_AUTO_TOPOLOGY.md](TASKS_AUTO_TOPOLOGY.md)
