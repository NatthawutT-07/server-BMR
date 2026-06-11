# 🖥️ ระบบหลังบ้าน บริหารจัดการชั้นวางสินค้า (Backend BMR)

โปรเจกต์นี้คือระบบ **Backend API Server** สำหรับบริการจัดการข้อมูลชั้นวางสินค้า (Planogram / BMR) ของร้าน **BAIMIANG Healthy Shop** รองรับการทำงานร่วมกับระบบหน้าเว็บ (Web Admin Dashboard) และระบบอุปกรณ์สแกนบาร์โค้ดสาขา (Mobile Client App) เพื่อให้สาขาและสำนักงานใหญ่เชื่อมต่อการทำงานแบบเรียลไทม์

---

## 🚀 เทคโนโลยีที่ใช้ (Tech Stack)

*   **Runtime Environment:** `Node.js (v18+)`
*   **Web Framework:** `Express.js (v5)`
*   **Database & ORM:** `PostgreSQL` และ `Prisma Client (v6.16.2)` สำหรับเขียน Query เชื่อมโยงฐานข้อมูล
*   **Caching & Queue Workers:** `Redis` (ผ่าน `ioredis` library)
*   **Authentication & Security:** 
    *   `JWT` (In-memory Access Token & HttpOnly Cookies Refresh Token)
    *   `bcryptjs` สำหรับเข้ารหัสผ่าน
    *   `Helmet` สำหรับตั้งค่าความปลอดภัย HTTP Headers
    *   `CORS` สำหรับจำกัดการเข้าใช้งานเฉพาะโดเมนของแอปพลิเคชัน
    *   `CSRF Protection` ด้วยระบบ Double-Submit Cookie
    *   `express-rate-limit` เพื่อระงับคำขอรบกวนระบบ (Spam/Brute Force)
*   **File Upload & Parsing:** `Multer` (สำหรับรับไฟล์ Excel), `ExcelJS` และ `xlsx` (สำหรับแยกวิเคราะห์ไฟล์ข้อมูลขนาดใหญ่)

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

โครงสร้างโฟลเดอร์ฝั่ง Backend มีดังนี้ (ข้อมูลโครงสร้างระบบถูกตัดส่วน HQ ออก):

```
backend-BMR/
├── prisma/                 # การตั้งค่าฐานข้อมูล (schema.prisma) และการทำ Migration
├── config/                 # ค่าคอนฟิกูเรชันหลัก เช่น พอร์ต, การอัปโหลดไฟล์ (multer)
├── controllers/            # ส่วนประมวลผลโลจิกและควบคุมการส่งกลับข้อมูล (Controllers)
│   ├── admin/              # ลอจิกควบคุม Dashboard, การวิเคราะห์ข้อมูล (Analysis), การจัดการ POG, อัปโหลด Excel
│   ├── user/               # ลอจิกการดึงข้อมูลผังเชลฟ์ของพนักงานสาขา
│   ├── worker/             # ลอจิกของโปรเซสย่อยเบื้องหลัง
│   └── auth.js             # ลอจิกการเข้าใช้งาน/ลงชื่อออกจากระบบ (Authentication)
├── router/                 # ระบบระบุเส้นทางและรับ endpoints
│   ├── admin.js            # จัดการเส้นทางสำหรับแอดมิน (Dashboard, Template, POG Requests, Sync)
│   ├── auth.js             # จัดการเส้นทางล็อกอิน ต่ออายุ Token คืนสถานะผู้ใช้งาน
│   ├── user.js             # จัดการเส้นทางดูเชลฟ์สำหรับผู้ใช้สาขา
│   └── userMobile.js       # จัดการเส้นทางรองรับ Mobile Client
├── middlewares/            # ฟังก์ชันที่คั่นกลางกรองข้อมูลก่อนถึง Controller
│   ├── authCheck.js        # ตรวจสอบสิทธิ์ Access Token และสิทธิ์ Admin
│   ├── csrf.js             # ยืนยันความถูกต้องของ CSRF Token
│   └── validate.js         # ตรวจสอบความถูกต้องของโครงสร้าง Request (Schema validation)
├── workers/                # การประมวลผลงานหนักแบบ Asynchronous ด้วย Redis Queue
├── uploads/                # เก็บไฟล์ Static ที่นำเข้าชั่วคราวและรูปภาพประกอบ
├── server.js               # ⭐️ ไฟล์เริ่มต้นเซิร์ฟเวอร์หลัก (Entry Point)
├── Dockerfile              # ค่า Docker image configuration สำหรับเซิร์ฟเวอร์
├── docker-compose.yml      # ตั้งค่า Docker Compose สำหรับฐานข้อมูล PostgreSQL & Redis
└── package.json            # ไฟล์เก็บประวัติไลบรารีและคำสั่งรันระบบ
```

---

## 🛠️ การติดตั้งและรันระบบเครื่องตัวเอง (Local Development)

### สิ่งที่ต้องเตรียมก่อนเริ่มงาน
1.  **Node.js** (เวอร์ชัน 18 ขึ้นไป แนะนำ 20 LTS)
2.  **PostgreSQL Database** (ลงโปรแกรมในระบบ Windows หรือรันผ่าน Docker container)
3.  **Redis Server** (สำหรับงาน Workers)

## 🔑 โครงสร้างฐานข้อมูลหลัก (Core Planogram Models)

ตารางฐานข้อมูลหลักใน `schema.prisma` ที่ใช้ในการประมวลผลระบบ Planogram (POG):

*   **User / LoginLog:** เก็บข้อมูลผู้ใช้งานระบบ (สาขา และ แอดมิน) และเก็บประวัติล็อกอินเพื่อตรวจสอบความปลอดภัย
*   **Sku:** เก็บข้อมูลดัชนีตำแหน่งวางของบาร์โค้ดบนชั้นวางสาขาจริง ประกอบด้วย `branchCode`, `shelfCode`, `rowNo`, `codeProduct` และลำดับช่อง (`index`)
*   **Template (Template):** เก็บข้อมูลโครงสร้างความกว้างชั้นวางสินค้าของแต่ละสาขา (จำนวนแถว, รหัสตู้)
*   **PogRequest:** บันทึกประวัติคำขอเปลี่ยนแปลงสินค้าที่พนักงานสาขาส่งเข้ามา มีการเก็บตำแหน่งเดิม (`fromRow`, `fromIndex`) และตำแหน่งเป้าหมายปลายทาง (`toRow`, `toIndex`) รอการตัดสินใจจาก HQ
*   **ItemMinMax / Stock / withdraw:** เก็บข้อมูลระดับสินค้าต่ำสุด/สูงสุด, จำนวนสต็อกคงเหลือปัจจุบัน และบันทึกการเบิกสินค้าออกนอกผังจัดร้าน
*   **ListOfItemHold:** รายชื่อสินค้ากลาง (SKU Master) เพื่อค้นหา บาร์โค้ด แบรนด์ และราคาคู่ค้ารับซื้อ
*   **ShelfChangeLog:** บันทึกวันเวลาและรายชื่อพนักงานที่มีการปรับผังจริงหลังจากแอดมินอนุมัติ เพื่อใช้ยืนยันการจัดเรียง (Acknowledge)

---

## 🛰️ เส้นทางและ API Endpoints ที่สำคัญ (API Endpoints Overview)

ระบบรองรับ API แยกตามหน้าที่การเข้าถึงอย่างเป็นระบบ:

### 1. ระบบยืนยันตัวตน (Authentication)
*   `GET /api/csrf-token` — ดึงค่าคุกกี้ token มาไว้สำหรับความปลอดภัยตอนเริ่มเข้าเว็บ
*   `POST /api/login` — ตรวจสอบบัญชีผู้ใช้และมอบ Access/Refresh Tokens
*   `POST /api/logout` — ล้างข้อมูล Token และ Cookie ออกจากเซสชันเบราว์เซอร์
*   `POST /api/refresh-token` — ออก Access Token ชุดใหม่โดยอิงจาก Refresh Cookie

### 2. สำหรับแอดมินสำนักงานใหญ่ (Admin POG & Management)
*   `GET /api/pog-requests` — ดึงประวัติคำขอทั้งหมดของสาขา (สถานะ pending, completed, rejected)
*   `PATCH /api/pog-requests/:id` — เปลี่ยนสถานะรายการขยับสินค้า (อนุมัติ/ปฏิเสธคำขอ)
*   `POST /api/pog-requests/bulk-approve` — สั่งอนุมัติคำขอคราวละหลายรายการ
*   `POST /api/shelf-add` / `PUT /api/shelf-update` / `DELETE /api/shelf-delete` — ควบคุมผังสินค้าจากส่วนกลาง
*   `GET /api/branch-ack-status` — ดึงรายงานตรวจสอบสาขาที่ยืนยันการจัดชั้นวางตามผังใหม่
*   `POST /api/upload-sku` / `/upload-template` / `/upload-stock` — นำเข้าไฟล์สถิติจัดเก็บฐานข้อมูล

### 3. สำหรับพนักงานหน้าร้านและสแกนเนอร์ (Branch Client Actions)
*   `POST /api/shelf-sku` — ค้นหาตำแหน่งสินค้าบนเชลฟ์และสถานะยอดขาย
*   `GET /api/shelf-update-check/:branchCode` — ตรวจสอบว่าแอดมินเพิ่งอัปเดตผังใหม่ไปเมื่อใด
*   `POST /api/shelf-update-acknowledge/:branchCode` — กดยืนยันรับทราบและจัดเสร็จจริงหน้าร้าน
