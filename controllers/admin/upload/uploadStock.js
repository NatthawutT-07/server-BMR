const prisma = require('../../../config/prisma');
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');
const cacheManager = require("../../../utils/cacheManager");

// Batch size สำหรับ insert
const BATCH_SIZE = 1000;

// ใช้ Worker Thread สำหรับ Parse Excel (ไม่ Block Event Loop)
exports.uploadStockXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-stock");
    setUploadJob(jobId, 5, "starting worker");

    try {
        // ใช้ Worker Thread parse Excel (Non-blocking)
        const mapped = await runExcelWorker(
            req.file.buffer,
            "stock",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!mapped || mapped.length === 0) {
            failUploadJob(jobId, "No valid stock data");
            return res.status(200).send("No valid stock rows found (all qty = 0 or invalid).");
        }

        setUploadJob(jobId, 85, "saving data");
        const user = req.user;

        // ดึงรายการสาขาที่ไม่ซ้ำกันในไฟล์
        const uniqueBranches = [...new Set(mapped.map(r => r.branchCode))];

        // Security Check: ถ้าไม่ใช่ admin ต้องอัปโหลดได้เฉพาะสาขาตัวเองเท่านั้น
        if (user.role !== 'admin') {
            const forbiddenBranches = uniqueBranches.filter(bc => bc !== user.name);
            if (forbiddenBranches.length > 0) {
                failUploadJob(jobId, `Permission denied: You can only upload stock for branch ${user.name}`);
                return res.status(403).json({ error: `You are not allowed to upload stock for other branches (${forbiddenBranches.join(', ')})` });
            }

            // --- NEW: Rate Limit 1 ชั่วโมง สำหรับ User ทั่วไป ---
            const lastSync = await prisma.branchDataSync.findUnique({
                where: { branchCode_key: { branchCode: user.name, key: 'stock' } }
            });

            if (lastSync) {
                // ปรับจูนเวลาจาก DB (ที่อาจจะถูกมองเป็น UTC ทั้งที่เป็นเวลาไทย) ให้ตรงกับความเป็นจริงก่อนเทียบ
                const lastUpdate = new Date(lastSync.updatedAt);
                const now = new Date();
                
                // คำนวณส่วนต่างเป็นนาที
                let diffMin = (now.getTime() - lastUpdate.getTime()) / (60 * 1000);

                // --- แก้ไขเคส Timezone 7 ชั่วโมง ---
                // ถ้าเวลาใน DB ดูเหมือนจะ "ล้ำหน้า" ปัจจุบันไปมากกว่า 5 ชม. (เช่น -300 นาทีขึ้นไป)
                // ให้เราบวกคืนไป 420 นาที (7 ชม.) เพื่อให้ได้ส่วนต่างที่แท้จริง
                if (diffMin < -300) { 
                    diffMin += 420; 
                }

                // ถ้าส่วนต่างยังไม่ถึง 60 นาที ให้รอ
                if (diffMin < 60) {
                     const waitMin = Math.ceil(60 - diffMin);
                     if (waitMin > 0) {
                        failUploadJob(jobId, `Rate limit: Please wait ${waitMin} minutes.`);
                        return res.status(429).json({ error: `กรุณารออีกอย่างน้อย ${waitMin} นาที จึงจะอัปโหลดได้ใหม่อีกครั้ง` });
                     }
                }
            }
            // ---------------------------------------------
        }

        // ล้างข้อมูลเก่า "เฉพาะสาขาที่มีอยู่ในไฟล์"
        await prisma.stock.deleteMany({
            where: {
                branchCode: { in: uniqueBranches }
            }
        });

        // insert แบบ batch
        for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
            const chunk = mapped.slice(i, i + BATCH_SIZE);
            await prisma.stock.createMany({
                data: chunk,
                skipDuplicates: true,
            });
            const currentCount = Math.min(i + BATCH_SIZE, mapped.length);
            const progress = 85 + Math.floor((currentCount / mapped.length) * 10);
            setUploadJob(jobId, progress, `saving ${currentCount}/${mapped.length}`);
        }

        // อัปเดตเวลาอัปเดตล่าสุด (Global) - อัปเดตเฉพาะเมื่อ Admin เป็นคนอัปโหลดเท่านั้น
        if (user.role === 'admin') {
            await touchDataSync('stock', mapped.length);
        }

        // อัปเดตเวลาอัปเดตรายสาขา
        for (const bc of uniqueBranches) {
            const branchRows = mapped.filter(r => r.branchCode === bc).length;
            await touchDataSync('stock', branchRows, bc);
        }

        // --- NEW: ล้าง Cache ของสาขาที่อัปเดต เพื่อให้ User เห็นข้อมูลใหม่ทันที ---
        try {
            const templateCache = cacheManager.getCache("user-template");
            if (templateCache) {
                const allKeys = templateCache.keys();
                uniqueBranches.forEach(bc => {
                    const keysToDelete = allKeys.filter(k => k.includes(`-${bc}-`));
                    if (keysToDelete.length > 0) {
                        templateCache.del(keysToDelete);
                    }
                });
            }
        } catch (cacheErr) {
            console.error("Failed to clear cache:", cacheErr);
        }
        // -----------------------------------------------------------------

        finishUploadJob(jobId, "completed");

        return res.status(200).json({
            message: "Stock XLSX imported successfully (Worker Thread)",
            inserted: mapped.length,
        });
    } catch (err) {
        console.error("XLSX Worker Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        return res.status(500).json({ error: err.message });
    }
};
