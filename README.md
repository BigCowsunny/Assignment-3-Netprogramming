# Assignment-3-Netprogramming
งาน Assignment 3 

## เชื่อมต่ออุปกรณ์จริงและ EVE-NG

- เพิ่มอุปกรณ์จากหน้า **เพิ่มด้วย IP** โดยใส่ Management IP, SNMP community และ UDP port (ปกติ 161) ระบบทดสอบ `sysDescr` และอ่าน interface จาก IF-MIB ก่อนบันทึก
- อุปกรณ์ EVE-NG ต้องมี Management IP ที่เครื่องซึ่งรัน Backend เข้าถึงได้ และเปิด SNMP บน node นั้น การค้นหา EVE-NG API แสดงรายการ node/console เท่านั้น; ใช้ Management IP ของ node หรือสแกน subnet เพื่อเพิ่มอุปกรณ์เข้า SNMP monitor
- การสั่ง interface up/down ต้องใช้ community ที่มีสิทธิ์เขียน (`RW`) ระบบจะส่ง SNMP SET และอ่าน `ifAdminStatus` กลับมาตรวจ การแก้ไข community/UDP port จะ probe และอ่าน interface จริงอีกครั้ง
- กราฟ In/Out มาจาก SNMP octet counters และเริ่มมีจุดหลัง poller อ่าน counter ได้อย่างน้อยสองรอบ (poll ทุก 60 วินาที) ช่วงวัน/สัปดาห์/เดือน/ปีแสดงเท่าที่เก็บข้อมูลจริงไว้
- Trap Receiver รับ SNMP Trap ผ่าน UDP 162 (หรือ 1162 เมื่อพอร์ตหลัก bind ไม่ได้) ให้ตั้งอุปกรณ์ส่ง linkUp/linkDown trap ไปยัง IP ของ Backend และพอร์ตที่แสดงจาก `/api/health`; เปิด firewall ขาเข้า UDP พอร์ตนั้น
- Auto Discovery สแกน subnet ของ Management IP แล้วอ่าน LLDP/CDP เพื่อสร้างเส้นเชื่อมต่อระหว่างอุปกรณ์ที่ระบบ monitor รู้จัก ควรเปิด LLDP หรือ CDP บนลิงก์ที่ต้องการแสดง
