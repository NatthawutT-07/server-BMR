const multer = require("multer");

// const upload = multer({ dest: 'uploads/' });

// ✅ เปลี่ยนจาก DiskStorage (เขียนไฟล์ลงเครื่อง) → เป็น MemoryStorage (เก็บใน RAM)
const storage = multer.memoryStorage();

const upload = multer({ storage });

module.exports = upload;
