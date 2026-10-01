# งานเพิ่มการตรวจพบอุปกรณ์ที่ไม่มี Management IP

## วิเคราะห์ก่อนแก้

- Discovery เดิมต้องอ่าน SNMP ผ่าน IP และทิ้ง CDP neighbor ที่ยังไม่ได้ลงทะเบียน
- ตาราง devices บังคับ IP ไม่ซ้ำ จึงใช้ IP ว่างเก็บหลายอุปกรณ์ไม่ได้โดยตรง
- หน้าเว็บ merge อุปกรณ์ด้วย IP จึงต้องเปลี่ยนเป็น stable ID สำหรับอุปกรณ์ที่ไม่มี IP
- การพบ CDP ยืนยันเพียงข้อมูลที่อุปกรณ์ประกาศ ไม่ยืนยัน SNMP, สถานะทุก interface หรือความสามารถ Config
- Direct CDP capture รับได้เฉพาะเฟรมที่ถึงการ์ดเครือข่าย backend; Windows ต้องมี Npcap
- คงหน้าจอ/เมนู/ตาราง/Port Panel/Topology เดิม เพิ่มข้อความสถานะและปุ่มตรวจสถานะ CDP เล็กน้อย

## Tasks และเกณฑ์ Test

- [x] T1 เพิ่ม CDP Ethernet parser และ background capture พร้อม health/error status
  - Test: CDPv1/v2, ไม่มี IP, address/management-address, VLAN, packet เสีย, protocol อื่น, TTL
  - Capture ไม่ส่ง packet และไม่เปลี่ยน config อุปกรณ์
- [x] T2 เก็บ discovery observations แยกจาก SNMP inventory แล้วรวมใน API เดิม
  - Test: หลายอุปกรณ์ IP ว่าง, พบซ้ำไม่ซ้ำรายการ, หลายพอร์ต, TTL หมด, reload DB, ไม่เขียนทับ SNMP inventory
- [x] T3 อ่าน CDP-MIB neighbors ที่ยังไม่มี IP และแสดงใน Topology
  - Test: neighbor ใหม่ไม่มี IP, advertised IP ที่ยังไม่ยืนยัน, ชื่อพอร์ตย่อ/เต็ม, dedup กับ managed device
  - แก้ WALK API ที่เป็น dependency ของ Discovery
- [x] T4 บล็อก SNMP Config/Poll/Traffic ของ discovery-only device และรองรับเพิ่ม IP ภายหลัง
  - Test: API ปฏิเสธ SET โดยไม่ส่ง SNMP; poller ข้าม; promotion ต้อง probe สำเร็จ; ID และ links คงเดิม
- [x] T5 เพิ่มสถานะ/คำเตือนใน UI เดิมและรับ WebSocket updates
  - Test: ไม่มี IP ไม่ถูกรวมรายการ, มี warning, control ถูกปิด, unknown ports ไม่แสดง up, TypeScript/build ผ่าน
- [x] T6 ตรวจ regression และเขียนวิธีใช้งาน
  - Test: backend suite, parser กับ Scapy packet/pcap, frontend build, ตรวจ diff ว่าโครง UI เดิมยังอยู่

## สิ่งที่ต้องตรวจต่อกับอุปกรณ์จริง

- เปิด CDP บนพอร์ตที่ต่อกับ NIC ของ backend และรอ advertisement
- Windows: ติดตั้ง Npcap และใช้สิทธิ์ capture ที่เหมาะสม; เลือก NIC ผ่าน NETFIX_CDP_INTERFACES ได้
- ตรวจอุปกรณ์ไม่มี IP ปรากฏ พร้อม warning; เพิ่ม Management IP แล้วทดสอบ SNMP ก่อน Config
- เมื่อเป็น neighbor หลัง switch ที่ backend ไม่เห็นเฟรมโดยตรง ให้ใช้ CDP-MIB ของ switch ที่ monitor ผ่าน SNMP

## ผลตรวจ 1 ตุลาคม 2026

| รายการ | ผล | ขอบเขต |
|---|---|---|
| Backend regression | ผ่าน 34/34 | temporary SQLite, synthetic frame/pcap, mock SNMP, CDP-MIB, API guards, promotion, queue → DB → WebSocket, Trap regression |
| Frontend regression | ผ่าน 7/7 | render component จริงผ่าน React SSR, merge ด้วย ID, warning, control disabled, unknown link, ตารางยังมี 8 columns เดิม |
| Production build | ผ่าน | TypeScript และ Vite |
| เปิด passive capture บน NIC ของเครื่องนี้ | ผ่าน | สถานะ listening, ไม่พบ error, dropped_packets=0, ปิด thread ได้ |
| CDP จาก Router/Switch จริง | ยังไม่ยืนยัน | ช่วง smoke test ไม่มี advertisement เข้ามา (neighbors_received=0) |

เพิ่ม `backend/requirements-dev.txt` และ `npm run test:discovery` สำหรับรันซ้ำ คำสั่งอยู่ใน README

UI ใช้หน้า/เมนู/ตาราง/Port Panel/Topology เดิม เพิ่มปุ่ม CDP, badge/คำเตือน และเส้น unknown เท่านั้น อุปกรณ์ CDP ที่มี IP แต่ยังไม่ผ่าน SNMP ก็ยัง Config ไม่ได้ การบันทึก IP จะรอ SNMP probe + IF-MIB และไม่ปิดหน้าต่างเมื่อบันทึกไม่สำเร็จ

ปรับ dependency ของ feature ที่พบจาก audit ด้วย: ใช้ PySNMP `walk_cmd`, รองรับชื่อพอร์ตที่มี `/` ใน URL และป้องกัน poller เขียนสถานะพอร์ตเก่าทับ Trap งานนี้ยังไม่ใช่การแก้ทุกประเด็นจาก system audit ก่อนหน้า

ผลตรวจจริงและ Tests รอบที่ 2 อัปเดตใน TASKS_AUTO_TOPOLOGY.md: ยืนยัน CDP จริงจาก lab และ Topology ครบ 3 nodes / 4 neighbor links แล้ว (65 backend tests, 14 frontend tests, build ผ่าน)
