# ภาพประกอบ NetSmonitor จากเว็บจริง

แคปวันที่ 7 ตุลาคม 2026 ช่วง 10:21–10:37 น. (Asia/Bangkok) จาก http://localhost:5173/

R1.localdomain (192.168.213.131) ตอบ SNMPv2c และมี Traffic samples จริง ส่วน Router.localdomain (192.168.213.132) เป็นอุปกรณ์ที่ค้นพบจาก Neighbor และยังไม่ยืนยัน SNMP

| สไลด์ | ภาพหลัก | สิ่งที่ใช้พูดประกอบ |
| --- | --- | --- |
| 3 Dashboard | slide-03-dashboard.jpg | ออนไลน์ 1/2 อุปกรณ์ พอร์ตใช้งาน 1/4 และโหลดล่าสุด |
| 4 อุปกรณ์ | slide-04-add-device.jpg | แบบฟอร์ม IP / SNMP / Community ที่ปกปิด |
| 4 อุปกรณ์ | slide-04-devices.jpg | R1 ออนไลน์ และ Router ที่ยังเป็น Discovered only |
| 5 รายละเอียด | slide-05-port-panel.jpg | Et0/0 Admin/Oper up; Et0/1–3 Admin down |
| 5 รายละเอียด | slide-05-device-detail.jpg | IP, Uptime, รายละเอียดระบบ และพอร์ต |
| 6 SNMP SET | slide-06-port-menu.jpg | เมนูเปิดพอร์ต Et0/3; ภาพนี้ยังไม่ได้ส่ง SET |
| 7 Traffic | slide-07-traffic-live.jpg | กราฟ Live จริงของ R1 Et0/0 พร้อม In/Out และสถิติ |
| 7 Traffic | slide-07-traffic.jpg | กราฟช่วงวันและข้อมูลย้อนหลังที่มีจริง |
| 8 Trap | slide-08-traps-history.jpg | ประวัติ 14 เหตุการณ์; Source ไม่ตรงกับ R1 |
| 9 Discovery | slide-09-discovery.jpg | Seed .131 ตรวจ 2 nodes และพบ 1 Neighbor link |
| 10 Topology | slide-10-topology-link.jpg | R1 Et0/0 ↔ Router Ethernet0/0 |
| 10 Topology | slide-10-topology-map.jpg | แผนที่จริงพร้อมชื่อและ IP |
| 11 ตั้งค่า | slide-11-polling-dialog.jpg | รอบ Polling ปัจจุบัน 60 วินาที ช่วง 10–3,600 วินาที |
| 11 Audit | slide-11-settings-audit.jpg | บริการพร้อม UDP 162 และ Audit ของ Discovery |

ภาพ full / control เพิ่มเติมเป็นภาพหน้าจอเต็มสำหรับเลือกใช้ รูปต้นฉบับไม่มีการเปลี่ยนข้อมูลหรือแต่งภาพ

## คำบรรยายที่ต้องใช้ให้ตรงหลักฐาน

- กราฟ Traffic และ Topology เป็นข้อมูลจริงจาก Lab ที่เปิดอยู่
- ภาพ SNMP SET แสดงเมนูคำสั่งเท่านั้น ไม่ใช่หลักฐานว่าคำสั่งสำเร็จ
- ภาพ Trap เป็นประวัติเดิม ไม่ใช่ Trap ใหม่จาก R1 ในรอบแคปนี้
- Backend ฟัง Trap ที่ UDP 162; IP ฝั่ง VMnet8 คือ 192.168.213.1
- Community ไม่ปรากฏเป็นข้อความอ่านได้ในรูปที่เลือก

งาน Canva: https://canva.link/9m7cgr6wy2yg5dq
บันทึกภาพจริงหน้า 3–11 ลง Canva แล้วตามการอนุมัติ

layout-white.svg เป็นพื้นหลังจัดเลย์เอาต์ใน Canva ไม่ใช่ภาพหน้าจอและไม่รวมในชุดภาพ JPG
