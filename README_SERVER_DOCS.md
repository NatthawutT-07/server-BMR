# 🖥️ Server-BMR Architecture & Documentation

## 🎯 ภาพรวม (Overview)
**Server-BMR** เป็น Backend Server ที่พัฒนาด้วย **Node.js**:
- ทำหน้าที่เป็น API Gateway สำหรับจัดการข้อมูลสินค้า, สต็อก, ยอดขาย, และผู้ใช้งาน
- เชื่อมต่อกับ Database ผ่าน **Prisma ORM**
- ให้บริการ RESTful API สำหรับ Frontend (Web & Mobile)
- มีระบบ Authentication & Authorization ที่ปลอดภัย (JWT + Cookies)

---

## 🛠️ เทคโนโลยี (Tech Stack)

| Category | Technology | Description |
|----------|------------|-------------|
| **Framework** | Express.js | Web Framework หลัก |
| **Database** | Prisma ORM | ใช้ติดต่อ Database (MySQL / PostgreSQL) |
| **Auth** | JWT (JsonWebToken) | ใช้ระบุตัวตนผู้ใช้ (Access Token) |
| **Security** | Helmet, CORS, CSRF | ป้องกันการโจมตีพื้นฐาน |
| **Logging** | Morgan | บันทึก Request Logs |
| **File Upload** | Multer | จัดการการอัปโหลดไฟล์ Excel/Images |

---

## 📂 โครงสร้างโปรเจค (Folder Structure)

```
server-BMR/
├── config/             # ตั้งค่าระบบ (Database, Multer, Proxy)
├── controllers/        # Logic การทำงานหลัก (แยกตาม module)
│   ├── auth.js         # Login, Register, Refresh Token
│   ├── admin/          # Admin features (User manage, shelf, sales)
│   └── user/           # User features (POG request)
├── middlewares/        # ตัวกลางระหว่าง Request (Auth Check, Rate Limit)
├── prisma/             # Schema และ Migration files
├── router/             # กำหนด Endpoint URL
│   ├── auth.js         # /api/login, /api/register
│   ├── admin.js        # /api/shelf-*, /api/sales-*
│   └── user.js         # /api/pog-*
├── uploads/            # ที่เก็บไฟล์ที่อัปโหลด
├── utils/              # ฟังก์ชันเสริม (Logger, Formatter)
└── server.js           # Entry Point (Start Server)
```

---

## 🔐 ระบบ Authentication (Login Flow)

ระบบใช้ **JWT (JSON Web Token)** คู่กับ **HttpOnly Cookie**:

1. **Login:** User ส่ง username/password → Server ตรวจสอบ
   - ✅ ถูกต้อง: คืนค่า `Access Token` (Response Body) และฝัง `Refresh Token` (Cookie)
2. **Access Token:** ใช้แนบไปกับ Header `Authorization: Bearer <token>` เพื่อเรียก API
   - ⏳ อายุสั้น (เช่น 15 นาที) เพื่อความปลอดภัย
3. **Refresh Token:** ใช้ขอ Access Token ใหม่เมื่อหมดอายุ
   - 🍪 เก็บใน **HttpOnly Cookie** (JavaScript อ่านไม่ได้, ป้องกัน XSS)
4. **Auth Check Middleware:** ตรวจสอบ Token ก่อนเข้าถึง API สำคัญ

---

## 📡 API Endpoints ที่สำคัญ

### 1. Authentication (`/router/auth.js`)
| Method | Endpoint | รายละเอียด |
|--------|----------|------------|
| `POST` | `/api/login` | เข้าสู่ระบบ (Rate Limit ป้องกัน Brute force) |
| `POST` | `/api/refresh-token` | ขอ token ใหม่ |
| `POST` | `/api/logout` | ล้าง Cookie |
| `POST` | `/api/current-user` | ดึงข้อมูล User ปัจจุบัน |

### 2. Shelf Management (`/router/admin.js`)
| Method | Endpoint | รายละเอียด |
|--------|----------|------------|
| `GET` | `/api/shelf-template` | ดึงโครงสร้างชั้นวาง |
| `POST` | `/api/shelf-sku` | ดึงสินค้าใน shelf |
| `POST` | `/api/shelf-add` | เพิ่มสินค้าลง shelf |
| `DELETE` | `/api/shelf-delete` | ลบสินค้าออกจาก shelf |

### 3. POG Requests (`/router/user.js`)
| Method | Endpoint | รายละเอียด |
|--------|----------|------------|
| `GET` | `/api/pog-request` | ดึงประวัติคำขอ (User) |
| `POST` | `/api/pog-request` | สร้างคำขอใหม่ |
| `PATCH` | `/api/pog-request/:id/cancel` | ยกเลิกคำขอ |

---

## 🛡️ Security Features

1. **Helmet:** ซ่อน Header ที่บอกข้อมูล Server และป้องกัน XSS
2. **CORS:** จำกัดโดเมนที่เรียก API ได้ (Whitelist Web & Mobile)
3. **Rate Limiting:** จำกัดจำนวน Login ผิดพลาด (ป้องกัน Brute Force)
4. **CSRF Protection:** ใช้ Cookie คู่กับ Token เพื่อป้องกันการปลอมแปลง Request

---

## 🚦 Error Handling (การจัดการข้อผิดพลาด)

ทุก Controller จะส่ง Error ในรูปแบบมาตรฐาน JSON:

```json
{
  "ok": false,
  "code": "ERROR_CODE",
  "message": "Human readable error message"
}
```

- **400 Bad Request:** ข้อมูลไม่ครบ, Validation ผิดพลาด
- **401 Unauthorized:** Token หมดอายุ, ไม่ได้ Login
- **403 Forbidden:** ไม่มีสิทธิ์เข้าถึง (เช่น User พยายามใช้ API Admin)
- **500 Server Error:** ข้อผิดพลาดภายในระบบ

---

## 🚀 การรัน Server

```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. ตั้งค่า .env
# DATABASE_URL=...
# SECRET=...

# 3. รัน Server (Dev Mode)
npm run dev
# หรือ Production
npm start
```
