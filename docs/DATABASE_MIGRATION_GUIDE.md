# 🗄️ คู่มือการย้ายฐานข้อมูล (Database Migration) ไปยัง DigitalOcean VPS
_จัดทำเพื่อเป็นบันทึกสำหรับย้อนกลับมาอ่าน กรณีต้องการล้างข้อมูลเก่าบนเซิร์ฟเวอร์ และนำฐานข้อมูลใหม่จากเครื่อง Dev ขึ้นไปทับทั้งหมด_

---

## 🛑 คำเตือนก่อนเริ่ม
การทำตามคู่มือนี้ **จะลบข้อมูล Database เดิมบนเซิร์ฟเวอร์ทิ้งทั้งหมด** หากมั่นใจว่าต้องการใช้ข้อมูลชุดเดียวกับในเครื่องคุณ (Windows) ให้ทำตามลำดับด้านล่างนี้ได้เลย

---

## 💻 ขั้นตอนที่ 1: ดึงข้อมูล (Backup) จากเครื่อง Windows ของคุณ

เราจะใช้โปรแกรม `pg_dump` เพื่อดึงข้อมูลออกเป็นไฟล์ `bmr_backup.sql` 

1. เปิดโปรแกรม **Windows PowerShell** บนเครื่องของคุณ
2. รันคำสั่งนี้เพื่อดึงข้อมูล (แนะนำให้เซฟไว้ที่ `C:\Users\Purchase` เพื่อไม่ให้ติดปัญหา Permission):
   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres -d database_bmr -F p -f C:\Users\Purchase\bmr_backup.sql
   ```
   *(หมายเหตุ: หากคุณใช้ PostgreSQL เวอร์ชั่นอื่น ให้เปลี่ยนเลข `16` เป็นเวอร์ชั่นที่ถูกต้องของเครื่องคุณ)*
3. **ใส่รหัสผ่าน** Database ของเครื่องคุณตอนระบบถาม
4. เมื่อคำสั่งขึ้นบรรทัดใหม่ `PS C:\...` แปลว่าสำรองข้อมูลเสร็จสิ้นแล้ว ไฟล์ขนาดใหญ่จะถูกสร้างไว้

---

## 📤 ขั้นตอนที่ 2: อัปโหลดไฟล์ขึ้นเซิร์ฟเวอร์ (VPS)

ยังคงอยู่ใน **Windows PowerShell** ให้ส่งไฟล์ `.sql` ขึ้นไปบน DigitalOcean:

1. รันคำสั่งอัปโหลด (SCP):
   ```powershell
   scp C:\Users\Purchase\bmr_backup.sql bmr@api.bmrpog.com:~/
   ```
2. ใส่รหัสผ่านของเซิร์ฟเวอร์
3. รอจนกว่าระบบจะโชว์ว่าแบนด์วิธโหลดถึง 100%

---

## 🌐 ขั้นตอนที่ 3: นำข้อมูลไปทับของเดิมบน VPS

เปิดโปรแกรมสวมรอย (SSH) เพื่อเข้าเซิร์ฟเวอร์ DigitalOcean:

```bash
ssh bmr@api.bmrpog.com
```

จากนั้นรันคำสั่งเหล่านี้ทีละกล่อง:

### 3.1 ปิดแอปเพื่อป้องกันฐานข้อมูลพัง
```bash
pm2 stop bmr-backend
```

### 3.2 เคลียร์ของเก่า และสร้างฐานข้อมูลเปล่าๆ มารอไว้
```bash
sudo -u postgres psql -c "DROP DATABASE bmr_db;"
sudo -u postgres psql -c "CREATE DATABASE bmr_db OWNER bmr;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE bmr_db TO bmr;"
```

### 3.3 เตรียมไฟล์ Backup ให้พร้อมอ่าน (แก้ปัญหา Permission Denied)
การใช้โปรแกรมฐานข้อมูลอ่านไฟล์ตรงๆ จากโฟลเดอร์ User จะติดปัญหา Permission เราจึงต้องก๊อปไฟล์ไปพักไว้ที่ `/tmp/` ก่อน:
```bash
cp ~/bmr_backup.sql /tmp/
chmod 644 /tmp/bmr_backup.sql
```

### 3.4 นำข้อมูลยัดลงตาราง (Restore)
```bash
sudo -u postgres psql -d bmr_db -f /tmp/bmr_backup.sql
```
*(ขั้นตอนนี้จะรัวตัวหนังสือลงจออย่างรวดเร็ว ปล่อยให้ระบบวิ่งจนหยุดทำงาน)*

### 3.5 เปิดแอปพลิเคชันกลับมาทำงานเป็นปกติ
```bash
pm2 restart bmr-backend
```

🎉 **เสร็จสิ้นการ Migration!** ฐานข้อมูลออนไลน์จะเหมือนกับฐานข้อมูลบนเครื่อง Dev ของคุณแบบ 100%

---

## 🚨 การแก้ปัญหาเฉพาะหน้า (Troubleshooting)

### ปัญหา: Error `permission denied for schema public`
หากหลังจากการย้ายข้อมูลเสร็จแล้ว แอปเกิด Error ดึงข้อมูลไม่ได้ และใน Log แจ้งเตือนเกี่ยวกับ **permission denied for schema public** (เนื่องจาก Owner ของ Schema อาจยึดติดกับชื่อ `postgres` เดิมตอนที่เราดึงมา)

**วิธีแก้คือให้รัน 3 คำสั่งมอบสิทธิ์ใหม่ใน VPS ตามนี้ครับ:**
```bash
sudo -u postgres psql -d bmr_db -c "GRANT ALL ON SCHEMA public TO bmr;"
sudo -u postgres psql -d bmr_db -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bmr;"
sudo -u postgres psql -d bmr_db -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bmr;"
```
แล้วสั่ง `pm2 restart bmr-backend` อีกครั้งครับ
