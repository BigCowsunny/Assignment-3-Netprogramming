# ชื่ออุปกรณ์ใน SNMP Trap

ระบบจับคู่ Trap กับอุปกรณ์ที่ค้นพบโดยใช้ Agent IP ก่อน ตามด้วย sysName ที่แนบมากับ Trap และใช้ Source IP เมื่อแพ็กเก็ตไม่มีตัวตนต้นทาง ทั้ง Management IP และ IP ของ interface ใช้จับคู่ได้ รวมถึงรายการที่พบผ่าน CDP/LLDP แต่ยังไม่ได้ยืนยัน SNMP ชื่อ hostname แบบย่อจับคู่ได้เมื่อมีอุปกรณ์ตรงเพียงตัวเดียว

หากได้รับ Trap ก่อน Discovery ประวัติรายการเดิมจะเชื่อมชื่อให้อัตโนมัติเมื่อมีข้อมูลอุปกรณ์ โดยคงเวลาและ ID ของเหตุการณ์ไว้ หน้า Events และ Dashboard อัปเดตชื่อโดยไม่สร้าง Trap เพิ่มและไม่ใช้เหตุการณ์ย้อนหลังเปลี่ยนสถานะพอร์ตปัจจุบัน

## เมื่อทุกอุปกรณ์ส่งผ่าน NAT หรือ relay

Source IP เป็นที่อยู่ของผู้ส่ง UDP ซึ่งอาจเป็น NAT/relay ร่วมกัน ระบบดึงชื่อผ่าน SNMP จากที่อยู่นี้เพียงอย่างเดียวไม่ได้ เพราะอาจเป็นคนละเครื่องกับ router ต้นทาง ไม่สามารถแยก router ด้วย ifIndex หรือชื่อพอร์ตที่ซ้ำกันได้

เลือกวิธีใดวิธีหนึ่ง:

1. ส่ง SNMPv2c Trap ตรงถึง IP ของ backend ในเครือข่าย VM ให้ Source IP ของแต่ละ router ตรงกับ Management IP หรือ IP ของ interface ที่ monitor อยู่
2. ถ้าต้องผ่าน NAT ให้ส่ง SNMPv1 Trap ซึ่งมี `agent-addr` ภายในแพ็กเก็ต ตั้งให้เป็น IP ของ router ที่ระบบรู้จัก ตัวรับรองรับทั้ง v1 และ v2c ส่วนการอ่าน SNMP ของอุปกรณ์ยังใช้ v2c ได้
3. ถ้าใช้ relay ที่แปลง v1 เป็น v2c ให้คง `snmpTrapAddress.0` (`1.3.6.1.6.3.18.1.3.0`) หรือแนบ `sysName.0` (`1.3.6.1.2.1.1.5.0`) ของ router ต้นทาง ตัวรับจะอ่านสองฟิลด์นี้เมื่อมี ไม่ถือว่า v2c Trap ทุกตัวมี sysName

รูปแบบ Agent Address และการแปลงเป็น snmpTrapAddress อ้างอิง [RFC 3584](https://www.rfc-editor.org/rfc/rfc3584.html)

ตัวอย่าง Cisco IOS สำหรับ VM ที่ส่งผ่าน NAT (แทน `<TRAP_COMMUNITY>` ด้วยค่า Trap community เดิม และเปลี่ยน interface ให้ตรงกับ Management IP ของแต่ละ router):

```text
configure terminal
snmp-server host 192.168.213.1 traps version 1 <TRAP_COMMUNITY> snmp
snmp-server trap-source Ethernet0/0
snmp-server enable traps snmp linkup linkdown
end
```

`192.168.213.1` คือ IP ของ backend บน VMnet8 ในเครื่องนี้ ตัวอย่างไม่ได้ถูกส่งไปแก้ config ใน VM อัตโนมัติ ตรวจสอบปลายทางเดิมของ relay ด้วยหากยังคงส่งไป `10.80.0.65` การตั้งค่าปลายทางอ้างอิง [Cisco SNMP Traps](https://www.cisco.com/c/en/us/support/docs/ip/simple-network-management-protocol-snmp/13506-snmp-traps.html) และ [Cisco trap-source](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/snmp/command/nm-snmp-cr-book/nm-snmp-cr-s5.html)

ทดสอบโดยให้เกิด Link up/down บนพอร์ตทดสอบที่ไม่ใช่พอร์ตเชื่อมต่อ backend แล้วดูชื่ออุปกรณ์และ Agent IP ในหน้า Events การกด Discover อ่านข้อมูลอุปกรณ์และปรับชื่อในประวัติ แต่ไม่ได้สั่ง router ให้เกิด Link Trap

## ประวัติเดิมในเครื่องนี้

ตรวจเมื่อ 7 ต.ค. 2026: มี 14 เหตุการณ์เดิม ยังไม่มี Agent IP หรือ sysName แนบมา หลายเหตุการณ์มี Source IP `10.80.0.65` ซึ่งใช้ร่วมกัน จึงยังแสดง Unknown Source การแก้ตัวรับไม่สามารถกู้ตัวตนที่ไม่มีในแพ็กเก็ตเดิมได้ Trap ใหม่ที่ส่งตัวตนมาจะจับคู่ชื่อได้
