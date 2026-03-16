# BMR Backend - DigitalOcean Deployment Guide

คู่มือ Deploy `server-BMR` ไปยัง DigitalOcean VPS ด้วย PM2 เบื้องต้น

## 📋 สารบัญ
1. [สร้าง Droplet](#1-สร้าง-droplet)
2. [ตั้งค่า Server เบื้องต้น](#2-ตั้งค่า-server-เบื้องต้น)
3. [ติดตั้ง Dependencies](#3-ติดตั้ง-dependencies)
4. [ตั้งค่า PostgreSQL](#4-ตั้งค่า-postgresql)
5. [Deploy Application](#5-deploy-application)
6. [ตั้งค่า PM2](#6-ตั้งค่า-pm2)
7. [ตั้งค่า Nginx (Reverse Proxy)](#7-ตั้งค่า-nginx-reverse-proxy)
8. [ตั้งค่า SSL (HTTPS)](#8-ตั้งค่า-ssl-https)
9. [Firewall & Security](#9-firewall--security)

---

## 1. สร้าง Droplet
ไปที่ DigitalOcean -> กด Create → Droplets
เลือก:
- **OS:** Ubuntu 24.04 LTS
- **Plan:** Basic $12/mo (2GB RAM, 1 vCPU) หรือสูงกว่า
- **Region:** Singapore (sgp1) - ใกล้ไทยที่สุด
- **Authentication:** SSH Keys (แนะนำ) หรือ Password

กด **Create Droplet** และจด IP Address

---

## 2. ตั้งค่า Server เบื้องต้น
```bash
# SSH เข้า server
ssh root@YOUR_IP_ADDRESS

# อัปเดต system
apt update && apt upgrade -y

# สร้าง user ใหม่ (ไม่ใช้ root)
adduser bmr
usermod -aG sudo bmr

# ตั้งค่า SSH สำหรับ user ใหม่
rsync --archive --chown=bmr:bmr ~/.ssh /home/bmr

# ออกและ login ใหม่ด้วย user bmr
exit
ssh bmr@YOUR_IP_ADDRESS
```

---

## 3. ติดตั้ง Dependencies
```bash
# ติดตั้ง Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# ตรวจสอบ version
node -v   # ควรเป็น v20.x.x
npm -v    # ควรเป็น 10.x.x

# ติดตั้ง PM2
sudo npm install -g pm2

# ติดตั้ง Git
sudo apt install -y git
```

---

## 4. ตั้งค่า PostgreSQL
```bash
# ติดตั้ง PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# เข้า PostgreSQL
sudo -u postgres psql
```
ในหน้าต่าง PostgreSQL (SQL prompt):
```sql
CREATE USER bmr WITH PASSWORD 'YOUR_SECURE_PASSWORD';
CREATE DATABASE bmr_db OWNER bmr;
GRANT ALL PRIVILEGES ON DATABASE bmr_db TO bmr;
\q
```

---

## 5. Deploy Application
```bash
# สร้างโฟลเดอร์
mkdir -p ~/apps
cd ~/apps

# Clone repository (หรือ upload ไฟล์)
git clone https://github.com/YOUR_USERNAME/server-BMR.git
cd server-BMR

# สร้าง .env
nano .env
```
ใส่เนื้อหาใน `.env`:
```env
NODE_ENV=production
PORT=5001
DATABASE_URL=postgresql://bmr:YOUR_SECURE_PASSWORD@localhost:5432/bmr_db?schema=public
JWT_SECRET=YOUR_SUPER_SECRET_JWT_KEY_HERE
```
กลับมาที่ Terminal รันคำสั่ง:
```bash
# ติดตั้ง dependencies
npm install

# สร้างโฟลเดอร์ logs และ uploads
mkdir -p logs uploads

# Run Prisma migration
npx prisma migrate deploy

# Generate Prisma Client
npx prisma generate
```

---

## 6. ตั้งค่า PM2
```bash
# Start application
pm2 start ecosystem.config.js --env production

# ตรวจสอบ status
pm2 status

# ดู logs
pm2 logs bmr-backend

# บันทึก process list
pm2 save

# ตั้งค่า auto-start เมื่อ reboot
pm2 startup
# (อย่าลืมรัน command ที่ PM2 สร้างให้แสดงขึ้นมาใน terminal)

# ทดสอบ
curl http://localhost:5001/health
```

---

## 7. ตั้งค่า Nginx (Reverse Proxy)
```bash
# ติดตั้ง Nginx
sudo apt install -y nginx

# สร้าง config
sudo nano /etc/nginx/sites-available/bmr-api
```
ใส่เนื้อหา:
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    # Upload size limit (สำหรับ XLSX files)
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout สำหรับ long-running requests (XLSX upload)
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```
รันคำสั่ง:
```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/bmr-api /etc/nginx/sites-enabled/

# ทดสอบ config ว่าถูกต้องไหม
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## 8. ตั้งค่า SSL (HTTPS)
```bash
# ติดตั้ง Certbot
sudo apt install -y certbot python3-certbot-nginx

# ขอ SSL Certificate (ต้องชี้ Domain Name มาที่ IP นี้ก่อน)
sudo certbot --nginx -d YOUR_DOMAIN

# Auto-renew (ทดสอบ)
sudo certbot renew --dry-run
```

---

## 9. Firewall & Security
```bash
# ตั้งค่า UFW Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# ตรวจสอบ
sudo ufw status

# (Optional) ปิด PostgreSQL จากภายนอก
# ไม่ต้องทำอะไร - default PostgreSQL บน Ubuntu จะ bind แค่ localhost เท่านั้น
```

---

## ✅ ตรวจสอบว่า Deploy สำเร็จ
```bash
# 1. ตรวจสอบ PM2
pm2 status

# 2. ตรวจสอบ API (ควรเปลี่ยนเป็น https ถ้าติดตั้ง SSL แล้ว)
curl http://YOUR_IP/health

# 3. ตรวจสอบ Nginx logs
sudo tail -f /var/log/nginx/error.log

# 4. ตรวจสอบ Application logs
pm2 logs bmr-backend
```

---

## 🔄 คำสั่งที่ใช้บ่อย
| คำสั่ง | ความหมาย |
|--------|----------|
| `pm2 status` | ดู status ทั้งหมด |
| `pm2 logs bmr-backend` | ดู logs |
| `pm2 restart bmr-backend` | Restart server |
| `pm2 reload bmr-backend` | Reload แบบ zero-downtime |
| `git pull && npm install && pm2 restart bmr-backend` | Update code |

---

## 📝 หมายเหตุ
- **RAM:** 2GB เพียงพอสำหรับ ~50 users พร้อมกัน
- **Upload Timeout:** สำหรับไฟล์ XLSX ใหญ่ๆ มีการตั้งค่า Nginx timeout ไว้ 5 นาที (300s) แล้ว
- **Backup Database:** ควรตั้ง cron job สำหรับรัน `pg_dump` สำรองข้อมูลเป็นระยะ
