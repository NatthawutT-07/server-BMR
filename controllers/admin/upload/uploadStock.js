const prisma = require('../../../config/prisma');
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

// Batch size สำหรับ insert
const BATCH_SIZE = 1000;

// ✅ ใช้ Worker Thread สำหรับ Parse Excel (ไม่ Block Event Loop)
exports.uploadStockXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-stock");
    setUploadJob(jobId, 5, "starting worker");

    try {
        // ✅ ใช้ Worker Thread parse Excel (Non-blocking)
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

        // ล้างข้อมูลเก่า
        await prisma.$executeRaw`TRUNCATE TABLE "Stock"`;

        // insert แบบ batch
        for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
            const chunk = mapped.slice(i, i + BATCH_SIZE);
            await prisma.stock.createMany({
                data: chunk,
                skipDuplicates: true,
            });
            const progress = 85 + Math.floor((i / mapped.length) * 10);
            setUploadJob(jobId, progress, `saving ${i}/${mapped.length}`);
        }

        // อัปเดตเวลาอัปเดตล่าสุด
        await touchDataSync('stock', mapped.length);

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
