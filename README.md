# Backend BMR

Backend API สำหรับระบบบริหาร Planogram ของ BrightMind Retail ใช้ร่วมกับเว็บ `frontend-BMR` และมี API กลุ่ม HQ อยู่ใน service เดียวกัน

ระบบหลักครอบคลุมการเข้าสู่ระบบ, ผู้ใช้และสาขา, ผังชั้นวาง, ตำแหน่งสินค้า, คำขอเปลี่ยน POG, การยืนยันการจัดชั้น, dashboard และการนำเข้าข้อมูลจาก Excel

## เทคโนโลยีหลัก

- Node.js และ Express 5
- PostgreSQL และ Prisma 6
- JWT access token และ refresh token ผ่าน HttpOnly cookie
- Zod สำหรับตรวจสอบ request
- Multer, ExcelJS และ XLSX สำหรับนำเข้า/ส่งออกไฟล์
- Worker Threads สำหรับประมวลผลไฟล์ขนาดใหญ่
- PM2 configuration สำหรับ production

> `ioredis` และ `config/redis.js` ยังอยู่ในโปรเจกต์ แต่ flow ปัจจุบันไม่ได้ import Redis มาใช้งาน จึงไม่จำเป็นสำหรับการรันระบบในสถานะปัจจุบัน

## สิ่งที่ต้องติดตั้ง

- Node.js `>= 18.18` สำหรับ backend
- แนะนำ Node.js `20.19+` เพื่อใช้เวอร์ชันเดียวกับ frontend
- PostgreSQL ที่เข้าถึงฐานข้อมูลของระบบได้
- npm

ตรวจสอบเวอร์ชัน:

```powershell
node --version
npm --version
```

## เริ่มต้นใช้งาน

```powershell
cd backend-BMR
npm ci
```

สร้างไฟล์ `.env` ที่ root ของ `backend-BMR`:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public"
SECRET="replace-with-a-long-random-access-token-secret"
REFRESH_SECRET="replace-with-a-different-long-random-refresh-token-secret"
ACCESS_TOKEN_EXPIRE="15m"
REFRESH_TOKEN_EXPIRE="7d"
PORT=5001
NODE_ENV="development"
```

สร้าง secret บน PowerShell ได้ด้วย:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(64))
```

ห้าม commit `.env`, connection string หรือ secret เข้าสู่ Git

สร้าง Prisma Client:

```powershell
npx prisma generate
```

รัน development server:

```powershell
npm run dev
```

API จะเปิดที่ `http://localhost:5001` และตรวจสอบสถานะได้ที่:

```text
GET http://localhost:5001/health
```

## ฐานข้อมูลและ Migration

Schema หลักอยู่ที่ `prisma/schema.prisma`

```powershell
# ตรวจว่า schema ถูกต้อง
npx prisma validate

# ใช้ migration ที่มีอยู่กับ environment ที่เตรียมฐานข้อมูลไว้แล้ว
npm run migrate
```

ข้อควรระวัง:

- migrations ที่อยู่ใน repository ปัจจุบันเป็น migration เพิ่มเติมของฐานข้อมูลเดิม ไม่ใช่ initial migration ที่สร้างทุกตาราง
- ห้ามใช้ `prisma migrate reset`, `prisma db push --force-reset` หรือคำสั่งล้างข้อมูลกับฐานข้อมูลจริง
- การตั้งเครื่องใหม่ต้องขอ database dump/baseline และสิทธิ์เข้าถึงจากผู้ดูแลระบบก่อน แล้วจึงใช้ `prisma migrate deploy`
- ก่อนแก้ `schema.prisma` ให้ backup ฐานข้อมูลและสร้าง migration แยก ห้ามแก้ migration ที่ deploy แล้ว

โมเดลสำคัญ:

- `User`, `LoginLog`: บัญชี BMR และประวัติ login
- `BranchMain`: ข้อมูลสาขา
- `ShelfTemplate`, `SkuPosition`: โครงสร้างชั้นวางและตำแหน่งสินค้า
- `PogRequest`, `ShelfUpdate`, `ShelfChangeLog`: workflow เปลี่ยนผังและการยืนยันจากสาขา
- `MasterItem`, `Stock`, `MinMaxAutoPO`, `Withdraw`: ข้อมูลสินค้าและสต็อก
- `BillHeader`, `BillItem`, `Gourmet`: ข้อมูลยอดขาย
- โมเดลลงท้าย `_hq`: ข้อมูลระบบ HQ

## คำสั่งที่ใช้บ่อย

```powershell
npm run dev       # nodemon สำหรับพัฒนา
npm start         # รันด้วย node
npm run build     # สร้าง Prisma Client
npm run migrate   # prisma migrate deploy
```

โปรเจกต์ยังไม่มี automated test script ควรตรวจอย่างน้อยด้วย `prisma validate`, health check และทดสอบ flow สำคัญกับ frontend

## โครงสร้างโปรเจกต์

```text
backend-BMR/
|-- config/          # Prisma, Redis และ Multer
|-- controllers/     # business logic แยก admin, user และ HQ
|-- middlewares/     # JWT, CSRF, rate limit และ validation
|-- prisma/          # Prisma schema และ migrations
|-- router/          # Express routes
|-- schemas/         # Zod request schemas
|-- services/        # service layer
|-- utils/           # cache, lock, serializer และ helpers
|-- workers/         # Worker Threads สำหรับ parse Excel
|-- ecosystem.config.js
|-- server.js
`-- package.json
```

## API และสิทธิ์

ทุก route ถูก mount ใต้ `/api` ยกเว้น `/health` และ static uploads

- Authentication: `/api/login`, `/api/logout`, `/api/refresh-token`, `/api/current-user`
- Admin: users, branches, uploads, dashboard, shelf management และ POG approval
- Branch user: template, POG request, product registration และ acknowledgment
- Mobile/public lookup: `/api/lookup`, `/api/shelf-blocks`
- HQ: `/api/hq/...`

รายละเอียด endpoint ที่ถูกต้องที่สุดให้ดูจาก:

- `router/auth.js`
- `router/admin.js`
- `router/user.js`
- `router/userMobile.js`
- `router/hq.js`

Access token ถูกเก็บใน memory ฝั่ง frontend ส่วน refresh token ใช้ cookie ชื่อ `jid` หน้าเว็บจึงต้องเรียก API ด้วย credentials

คำขอที่เปลี่ยนสถานะสำคัญบางรายการใช้ double-submit CSRF โดยอ่าน cookie `csrfToken` และส่ง header `x-csrf-token`

## การนำเข้าข้อมูล

หน้า Upload รองรับข้อมูล:

- Shelf Template
- SKU Position
- Withdraw
- Stock
- Min/Max
- Master Item
- Bill
- Gourmet Sales

ไฟล์ถูกเก็บใน memory โดย Multer และข้อมูลขนาดใหญ่บางประเภทถูก parse ด้วย Worker Threads การเปลี่ยนชื่อคอลัมน์หรือรูปแบบไฟล์ต้องตรวจ controller ใน `controllers/admin/upload/` และ `workers/excelWorker.js`

ก่อนล้างหรือนำเข้าข้อมูล production:

1. สำรองฐานข้อมูล
2. ตรวจชนิดไฟล์และช่วงวันที่
3. ทดสอบกับข้อมูลตัวอย่าง
4. ตรวจหน้า Sync Status และ dashboard หลัง import

## Production

ตั้งค่า `.env` ของ production และสร้างโฟลเดอร์ log ก่อนเริ่ม PM2:

```powershell
New-Item -ItemType Directory -Force logs
npm ci --omit=dev
npx prisma generate
npm run migrate
npx pm2 start ecosystem.config.js --env production
npx pm2 save
```

ตรวจสอบ:

```powershell
npx pm2 status
npx pm2 logs bmr-backend
```

ค่าที่ผูกกับ production ในโค้ด:

- API port ค่าเริ่มต้น `5001`
- timezone `Asia/Bangkok`
- CORS อนุญาต `https://bmrpog.com` และ `https://hq.bmrpog.com`
- production cookies ต้องใช้ HTTPS เพราะตั้ง `Secure` และ `SameSite=None`
- reward images ถูกเขียนลง `uploads/rewards/` จึงต้องมี persistent storage และสิทธิ์เขียน

หากเปลี่ยนโดเมน ต้องแก้รายการ `allowedOrigins` ใน `server.js`, ตั้ง `VITE_API_URL` ฝั่ง frontend และตรวจ reverse proxy/cookie พร้อมกัน
