# Assignment-3-Netprogramming
งาน Assignment 3 

## เชื่อมต่ออุปกรณ์จริงและ EVE-NG

- เพิ่มอุปกรณ์จากหน้า **เพิ่มด้วย IP** โดยใส่ Management IP, SNMP community และ UDP port (ปกติ 161) ระบบทดสอบ `sysDescr` และอ่าน interface จาก IF-MIB ก่อนบันทึก
- ไม่เชื่อมต่อ EVE-NG API หรือ console Telnet; EVE-NG node และอุปกรณ์จริงถูกค้นพบด้วย SNMP เท่านั้น โดย node ต้องมี Management IP ที่เครื่อง Backend เข้าถึงได้และเปิด SNMP
- ปุ่ม **Network Scan / Discover** สแกน subnet ด้วย SNMP GET และ IF-MIB walk เพื่อแสดงเฉพาะอุปกรณ์ที่ตอบกลับพร้อมรายการ interface จริง
- Trap จาก IP ที่ยังไม่เคยลงทะเบียนจะเพิ่มอุปกรณ์ให้อัตโนมัติเมื่อ Trap Receiver ตรวจสอบด้วย SNMP GET และอ่าน IF-MIB จาก IP นั้นสำเร็จ อุปกรณ์ต้องส่ง linkUp/linkDown Trap และ community ใน Trap ต้องอ่าน SNMP ของ node ได้ จากนั้นอุปกรณ์จะแสดงทันทีผ่าน WebSocket
- ตั้งค่าอุปกรณ์ให้ส่ง linkUp/linkDown Trap ไปยัง IP ของเครื่อง Backend และ UDP port ของ Trap Receiver (ปกติ 162; อาจเป็น 1162 หาก bind 162 ไม่ได้) และอนุญาต UDP ขาเข้าที่ firewall
- การสั่ง interface up/down ต้องใช้ community ที่มีสิทธิ์เขียน (`RW`) ระบบจะส่ง SNMP SET และอ่าน `ifAdminStatus` กลับมาตรวจ การแก้ไข community/UDP port จะ probe และอ่าน interface จริงอีกครั้ง
- กราฟ In/Out มาจาก SNMP octet counters และเริ่มมีจุดหลัง poller อ่าน counter ได้อย่างน้อยสองรอบ (poll ทุก 60 วินาที) ช่วงวัน/สัปดาห์/เดือน/ปีแสดงเท่าที่เก็บข้อมูลจริงไว้
- Auto Discovery สแกน subnet ของ Management IP แล้วอ่าน LLDP/CDP เพื่อสร้างเส้นเชื่อมต่อระหว่างอุปกรณ์ที่ระบบ monitor รู้จัก ควรเปิด LLDP หรือ CDP บนลิงก์ที่ต้องการแสดง
