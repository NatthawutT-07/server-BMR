const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob } = require('./uploadJob');

// ✅ ใช้ Worker Thread สำหรับ Parse Excel (ไม่ Block Event Loop)
exports.uploadWithdrawXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-withdraw");
    setUploadJob(jobId, 5, "starting worker");

    try {
        // ✅ ใช้ Worker Thread parse Excel (Non-blocking)
        const mapped = await runExcelWorker(
            req.file.buffer,
            "withdraw",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!mapped || mapped.length === 0) {
            failUploadJob(jobId, "No valid withdraw data");
            return res.status(200).send("No valid withdraw rows found.");
        }

        // ------------------------------------------------------------
        // 4) Clear Table (ต้องล้างก่อน insert)
        // ------------------------------------------------------------
        setUploadJob(jobId, 85, "clearing old data");
        await prisma.$executeRaw`DELETE FROM "withdraw"`;

        // ------------------------------------------------------------
        // 5) Build Ultra-Fast Bulk Insert
        // ------------------------------------------------------------
        const values = mapped.map((r) =>
            Prisma.sql`(${r.codeProduct}, ${r.branchCode}, ${r.docNumber}, ${r.date}, ${r.docStatus}, ${r.reason}, ${r.quantity}, ${r.value})`
        );

        const sql = Prisma.sql`
            INSERT INTO "withdraw"
            ("codeProduct", "branchCode", "docNumber", "date", "docStatus", "reason", "quantity", "value")
            VALUES ${Prisma.join(values)}
        `;

        setUploadJob(jobId, 95, "saving data");
        await prisma.$executeRaw(sql);

        finishUploadJob(jobId, "completed");
        return res.status(200).json({
            message: "withdraw XLSX imported (Worker Thread)",
            inserted: mapped.length
        });

    } catch (err) {
        console.error("XLSX Worker Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
