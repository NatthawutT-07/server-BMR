# 📖 บริหารจัดการชั้นวางสินค้า - ระบบหลังบ้าน (Backend BMR)

โปรเจคนี้คือระบบ **Backend / API Server** สำหรับจัดการแอปพลิเคชันบริหารจัดการชั้นวางสินค้า (Planogram & BMR) ซึ่งเชื่อมต่อกับทั้งหน้าเว็บ (Web Admin) และแอปพลิเคชันมือถือ (Mobile App)

---

## 🚀 เทคโนโลยีที่ใช้ (Tech Stack)

*   **Runtime & Framework:** Node.js, Express.js (v5)
*   **Database:** PostgreSQL
*   **ORM (Object-Relational Mapping):** Prisma Client (v6.16.2)
*   **Authentication & Security:** JWT (JSON Web Token), bcryptjs, Helmet, CORS, CSRF Protection, express-rate-limit
*   **Caching & Workers:** Redis (ioredis)
*   **File Upload & Processing:** Multer, ExcelJS, CSV-Parser, json2csv, xlsx
*   **Process Manager / Deployment:** PM2, Docker

---

## 📁 โครงสร้างโปรเจค (Project Structure)

```text
backend-BMR/
├── prisma/               # ไฟล์ Config ฐานข้อมูลและ Schema (schema.prisma)
├── controllers/          # ที่เก็บลอจิกการทำงานของ API 各หน้างาน (admin, user, worker, auth.js)
├── router/               # จัดการ Routing (แบ่งเป็น auth, admin, user, userMobile)
├── middlewares/          # ฟังก์ชันที่คั่นกลาง (เช่น จัดการ CSRF, เช็ค Token)
├── utils/                # ฟังก์ชันตัวช่วยต่างๆ (Helpers)
├── workers/              # Service ที่ทำงานเบื้องหลัง (Background Jobs / Redis)
├── config/               # ไฟล์ตั้งค่าทั่วไปของระบบ
├── uploads/              # โฟลเดอร์สำหรับเก็บไฟล์ที่ถูกอัปโหลด
├── docs/                 # เอกสารคู่มือต่างๆ ของเซิร์ฟเวอร์
├── ecosystem.config.js   # ไฟล์ตั้งค่าสำหรับการรันระบบด้วย PM2
├── Dockerfile            # การตั้งค่าสำหรับนำแอปไปรันบน Docker
├── docker-compose.yml    # จัดการส่วนย่อยของ Database และ Server ให้เชื่อมกัน
├── server.js             # ⭐️ จุดเริ่มต้นของแอปพลิเคชัน (Entry point)
└── package.json          # กำหนด Dependencies และ Scripts การรัน
```

---

## 🛠️ การติดตั้งและรันโปรเจคเครื่องตัวเอง (Local Development)

### สิ่งที่ต้องเตรียม
1.  **Node.js** (แนะนำเวอร์ชัน 18 หรือ 20 ขึ้นไป)
2.  **PostgreSQL** (ติดตั้งในเครื่อง หรือใช้ Docker)
3.  **Redis** (สำหรับระบบ Message Queue / Workers)

### ขั้นตอนการรัน
1.  **เปิด Terminal และเข้าไปที่โฟลเดอร์ \`backend-BMR\`:**
    ```bash
    cd c:\BrightMindRetail\brightmind_project\planogram_project\backend-BMR
    ```

2.  **ติดตั้งไลบรารีที่จำเป็น (Dependencies):**
    ```bash
    npm install
    ```

3.  **คัดลอกไฟล์ตั้งค่า Environment:**
    สร้างไฟล์ `.env` ในโฟลเดอร์นี้ โดยมีค่าหลักๆ ที่ต้องกรอก (ดูตัวอย่างใน `.env.example` ถ้ามี):
    ```env
    DATABASE_URL="postgresql://user:password@localhost:5432/bmr_db?schema=public"
    SECRET="your_jwt_secret_key"
    REFRESH_SECRET="your_jwt_refresh_key"
    PORT=5001
    NODE_ENV=development
    ```

4.  **สั่งสร้าง Prisma Client และรัน Migration (เตรียมตารางฐานข้อมูล):**
    ```bash
    npx prisma generate
    npx prisma migrate dev
    ```

5.  **เปิดเซิร์ฟเวอร์แบบนักพัฒนา (Watch mode):**
    ```bash
    npm run dev
    ```
    เซิร์ฟเวอร์จะเริ่มต้นทำงานที่ (โดยปกติ) `http://localhost:5001`

---

## 💻 Script คำสั่งที่สำคัญ (Available Scripts)

*   `npm run dev` : เปิดเซิร์ฟเวอร์สำหรับการพัฒนา (ใช้ nodemon จะรีเฟรชออโต้เมื่อเซฟโค้ด)
*   `npm start` : เปิดเซิร์ฟเวอร์สำหรับใช้งานจริง (รันไฟล์ server.js โดยตรง)
*   `npm run build` : สั่งให้ Prisma อัปเดต Client (ใช้งานบ่อยหลังเปลี่ยน schema.prisma)
*   `npm run migrate` : รัน `prisma migrate deploy` เพื่ออัปเดตโครงสร้าง Database บนโฮสต์จริง
*   `npm run postinstall` : รัน `prisma generate` อัตโนมัติหลังติดตั้ง dependencies

---

## 🌐 การนำระบบขึ้นใช้งานจริง (Deployment - VPS)

ระบบสามารถ Deploy ขึ้น DigitalOcean หรือ VPS Linux อื่น ๆ ได้โดยใช้ **PM2** เพื่อรักษาให้แอปไม่หลุดหรือดับ

**คำสั่งพื้นฐานสำหรับการ Deploy ใหม่ด้วย PM2:**
```bash
# 1. ติดตั้ง Dependencies และรัน Prisma ให้เสร็จ
npm install
npm run build
npm run migrate

# 2. ปล่อยแอปพลิเคชันทำงานด้วย PM2 (อ้างอิงไฟล์ ecosystem.config.js)
pm2 start ecosystem.config.js --env production

# 3. เซฟสถานะให้ PM2 รันขึ้นมาใหม่ตอนที่ลีนุกซ์หรือเครื่องค้าง (Reboot)
pm2 save
pm2 startup
```

_(หรือจะใช้วิธีรันผ่าน **Docker Compose** ก็ได้ โดยพิมพ์คำสั่ง `docker-compose up -d --build` ในเทอร์มินัล)_

---

## 🔑 ข้อมูล API และ Security เพิ่มเติม
- ระบบหลังบ้านนี้รองรับผู้เข้าใช้งานจากหน้าเว็บหลัก (CORS ถูกอนุญาตแค่โดเมนอย่างเว็บจริงและโดเมน Localhost สำหรับนักพัฒนา รวมถึง Mobile App และ Expo Dev Server) 
- มีการใช้ระบบ `Helmet` ป้องกัน HTTP headers ทะลุ รวมทั้ง `express-rate-limit` ป้องกันการโจมตีแบบรัวๆ (Brute Force)
- มีระบบ CSRF Protection (Double-Submit Cookie) สำหรับเพิ่มความปลอดภัย
- มี Custom Logging Middleware สำหรับบันทึกระยะเวลาการตอบสนองของแต่ละ API Request
- โค้ดทั้งหมดของการ Response API จะอยู่ในรูปแบบสากล `{ ok: boolean, code: string, message: string }`
- มี Health Check Endpoint `/health` สำหรับให้ Docker/Kubernetes เช็คสถานะการทำงานของเซิร์ฟเวอร์
