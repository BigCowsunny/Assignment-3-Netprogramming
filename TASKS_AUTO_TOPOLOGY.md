# Auto Discovery / Topology — งานรอบที่ 2

## วิเคราะห์

- ปุ่ม Discover ปัจจุบันสแกน CIDR เป็นหลัก จึงต้องใส่ subnet และไม่ได้ไล่ neighbor
- รับ CDP ได้เพียง node ที่ส่งเฟรมมาถึง NIC; เส้นระหว่างอุปกรณ์ต้องอ่าน neighbor table
- LLDP ต้อง map lldpLocPortNum ผ่าน local-port table ไปยัง IF-MIB ไม่ใช้เลขนั้นเป็น ifIndex โดยตรง
- CDP Device ID / hostname อย่างเดียวอาจซ้ำ ต้องประกอบ MAC, chassis ID, management IP และขอบเขตของข้อมูล
- สายที่เก็บแบบถาวรไม่สะท้อนการถอด/ย้ายสาย ต้องเก็บ reporter, เวลาที่พบ และ TTL พร้อม reconcile เฉพาะ snapshot ที่อ่านสำเร็จ
- ยังไม่เปิด SNMP: เก็บ node จาก CDP/LLDP ได้ แต่ต้องแสดง missing credentials/timeout และไม่สร้างสายที่ไม่มีหลักฐาน

## Tasks

- [x] T1 Discover รองรับ seed IP, CIDR ทางเลือก, หรืออุปกรณ์ที่พบแล้ว โดยไม่มี subnet บังคับ
- [x] T2 bounded neighbor crawl ผ่าน SNMP พร้อม visited set, credential fallback และอ่านซ้ำอัตโนมัติ
- [x] T3 map CDP/LLDP local/remote ports จริง และคืน diagnostics เมื่อ map ไม่ได้
- [x] T4 เพิ่ม unknown neighbor ไม่มี IP ทั้ง CDP และ LLDP พร้อมบล็อก Config ตามเดิม
- [x] T5 dedup ด้วย strong identity และ snapshot/TTL สำหรับสายเก่าหรือสายที่ย้าย
- [x] T6 progress/results ใน toolbar เดิม พร้อม job status, cancel on shutdown และจำกัดงานซ้อน

## Test ที่ต้องผ่าน

- lab จำลอง 3 nodes พบครบ, วงวนไม่ถูกอ่านซ้ำ และสายตรงกับพอร์ต
- seed IP / auto seeds ไม่เรียก subnet sweep
- CDP/LLDP neighbor ไม่มี IP ยังมี node + สายจาก reporter และ Config ไม่ได้
- LLDP local port number แตกต่างจาก ifIndex ก็ map ได้
- hostname Switch ซ้ำแต่ MAC/chassis ต่างต้องไม่รวมเป็นตัวเดียว
- SNMP ไม่ตอบ / ไม่มี credential ยังเก็บ node และมี diagnostics
- ถอด/ย้ายสายแล้ว snapshot สำเร็จล้างสายเก่า; timeout ไม่ล้างข้อมูลทันที; TTL หมดจึงซ่อนสาย
- API job status / input validation / frontend status และ build ผ่าน

## Hardware

ตรวจ lab จริงผ่าน SNMP GET/WALK และ passive capture; ไม่ส่ง SET และไม่เปลี่ยน config Router/Switch

## ผลทดสอบ 1 ตุลาคม 2026

| รายการ | ผล | หลักฐาน/ขอบเขต |
|---|---|---|
| Backend tests | ผ่าน 65/65 | temporary SQLite, synthetic frames/MIBs, mock SNMP, jobs, API guards และ Trap regression |
| Frontend tests | ผ่าน 14/14 | component SSR, ID merge, warning/disabled controls, blank target, progress, API polling, parallel links |
| Production build | ผ่าน | TypeScript และ Vite |
| 3-node crawl จำลอง | ผ่าน | เริ่ม IP เดียว, อ่านครบ 3 IP ครั้งเดียวแม้เป็นวงวน, 3 links ตรง IF-MIB |
| No-IP CDP/LLDP | ผ่าน | เพิ่ม node และสายจาก reporter, Config ถูกบล็อก; LLDP local number 99 map ไป ifIndex 7 |
| Identity | ผ่าน | ชื่อ Switch ซ้ำแต่ MAC ต่างแยกกัน, CDP/LLDP MAC เดียวกันรวม, ต่าง NIC/identity กำกวมไม่รวม |
| สายเก่า | ผ่าน | ย้าย/ถอดสายผ่าน snapshot, timeout ไม่ล้างทันที, TTL/withdrawal, migration ไม่ต่ออายุสายเก่าทุก restart |
| Live lab | ผ่าน 3 nodes / 4 neighbor links | R2 192.168.8.135, R3 192.168.8.136, Switch ไม่มี IP; Discover ช่องว่างทั้งสองช่องใช้ credentials ที่บันทึกไว้ |
| Passive capture จริง | ผ่าน CDP | listening, dropped_packets=0; LLDP จริงยังไม่มี packet เข้ามา จึงยืนยันด้วย synthetic tests |

### สิ่งที่พบเพิ่มระหว่างทดสอบจริง

- ตอนเริ่ม lab ยังไม่ตอบ SNMP จึงมี R3 + Switch และไม่มีสาย; ต่อมา R2/R3 เริ่มตอบ SNMP และระบบอ่านสายได้
- พบ Switch ซ้ำจาก passive CDP และ cache ของ R2/R3 จึงเพิ่มการจับคู่โดยใช้ MAC ของ local port reporter ที่ปรากฏใน advertisement บน NIC เดียวกัน ร่วมกับ Device ID/remote Port ID ที่ไม่กำกวม
- เก็บ observations เดิมไว้ หากภายหลังมีหลาย MAC ที่ตรงเงื่อนไขจะเลิกจับคู่และแสดงรายการแยก ไม่รวมจาก hostname หรือ subnet อย่างเดียว
- R2/R3 มีสอง neighbor links คนละพอร์ต จึงแยกเส้นโค้งและป้ายพอร์ตใน SVG เดิมเล็กน้อย โดยคงหน้า/เมนู/ตาราง/Port Panel เดิม
- สายแสดงความสัมพันธ์ตาม CDP/LLDP neighbor table บน shared bridge เช่น EVE Net อาจเห็นหลาย neighbors บนพอร์ตเดียวกัน ไม่ใช่การอ่านจำนวนสายจาก EVE API

### Live port pairs

| อุปกรณ์/พอร์ต | อุปกรณ์/พอร์ต | ข้อมูล |
|---|---|---|
| R2 Gi0/1 | R3 Et0/1 | CDP, interface oper up |
| R2 Gi0/0 | R3 Et0/0 | CDP บน shared management segment |
| R2 Gi0/0 | Switch Gi0/0 | CDP, Switch ยังไม่ยืนยัน SNMP |
| R3 Et0/0 | Switch Gi0/0 | CDP, Switch ยังไม่ยืนยัน SNMP |

Switch แสดงพอร์ตที่ประกาศเท่านั้นและยัง Config/Traffic ไม่ได้จนมี Management IP + SNMP ที่ตรวจสอบสำเร็จ ข้อมูลสายของ reporter อีกฝั่งอาจคงอยู่จนอ่านซ้ำสำเร็จหรือ TTL หมด (180 วินาที)

คำสั่งรันทดสอบซ้ำอยู่ใน README และ source tests อยู่ใน tests/test_auto_topology.py, tests/test_cdp_discovery.py, tests/frontend-discovery.test.mjs

## แก้การแสดงสายซ้ำ — 1 ตุลาคม 2026

### วิเคราะห์

API ของ lab คืน 4 คู่พอร์ตที่แตกต่างกัน ไม่พบคู่ device/port ซ้ำตรงกัน แต่มี 3 neighbor links ของ R2 Gi0/0, R3 Et0/0 และ Switch Gi0/0 บน Net ร่วม เมื่อวาดทุกคู่เป็นสายตรงจึงดูเหมือนสายซ้ำกับ R2 Gi0/1 ↔ R3 Et0/1 การแสดงผลต้องแยกความสัมพันธ์ neighbor ออกจากภาพเครือข่ายร่วม

### Tasks และผล

- [x] ตัดรายงานซ้ำแบบกลับด้าน A↔B, ชื่อพอร์ตย่อ/เต็ม และ CDP/LLDP ของคู่ device/port เดียวกัน
- [x] จัดกลุ่ม complete neighbor graph บนพอร์ตเดียวกันของ 3+ devices เป็น “เครือข่ายร่วม” หนึ่งเส้นต่อพอร์ต ไม่จัดกลุ่มจาก subnet หรือ hostname
- [x] เก็บสายระหว่างอุปกรณ์ที่ใช้ต่างพอร์ตไว้ ไม่รวมสายจริงหลายเส้นเป็นเส้นเดียว
- [x] ใช้ renderer เดียวกันในหน้า Topology และภาพย่อ Dashboard; วาดป้ายหลังสายทั้งหมด ป้องกันสายทับป้าย
- [x] คงโครง UI, ตำแหน่ง node, drag/zoom และข้อมูล observations ใน API/DB ตามเดิม
- [x] Frontend tests ผ่าน 18/18 และ TypeScript/Vite production build ผ่าน
- [x] ตรวจหน้าเว็บจริง: 3 device nodes, 1 จุดเครือข่ายร่วม, 3 เส้นเข้าจุดร่วม และ 1 สายตรง Gi0/1 ↔ Et0/1

Test เพิ่มครอบคลุม reverse/abbreviated duplicates, shared segment พร้อมสายตรงอีกพอร์ต, renderer ทั้งสองหน้า, incomplete neighbor tables, สามเหลี่ยมที่ใช้ต่างพอร์ต และความคงที่เมื่อสลับลำดับข้อมูล

จุดเครือข่ายร่วมเป็นการจัดกลุ่มภาพจาก neighbor table ไม่ใช่อุปกรณ์ที่พบเพิ่ม และไม่ยืนยันผังสาย EVE ผ่าน API ข้อมูลไม่ครบจะคงเส้น neighbor เดิมไว้ หลักฐานภาพรอบนี้: netfix-shared-segment.jpg ในโฟลเดอร์ artifacts ของบทสนทนา
