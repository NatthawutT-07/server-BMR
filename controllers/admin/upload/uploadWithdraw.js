const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

// ✅ ใช้ Worker Thread สำหรับ Parse Excel (ไม่ Block Event Loop)
exports.uploadWithdrawXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-withdraw");
    setUploadJob(jobId, 5, "starting worker");

    try {
        // ✅ ใช้ Worker Thread parse Excel (Non-blocking)
        let mapped = await runExcelWorker(
            req.file.buffer,
            "withdraw",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!mapped || mapped.length === 0) {
            failUploadJob(jobId, "No valid withdraw data");
            return res.status(200).send("No valid withdraw rows found.");
        }

        // ✅ ฟิวเตอร์พื้นฐาน (docStatus === 'อนุมัติแล้ว' และ reason !== 'เบิกเพื่อขาย')
        mapped = mapped.filter(r => r.docStatus === 'อนุมัติแล้ว' && r.reason !== 'เบิกเพื่อขาย');

        if (mapped.length === 0) {
            finishUploadJob(jobId, "completed");
            return res.status(200).json({
                message: "No valid withdraw data after filtering.",
                inserted: 0
            });
        }

        // ✅ ตรวจสอบและลบข้อมูลซ้ำใน batch เดียวกัน
        const uniqueMap = new Map();
        const duplicates = [];
        
        mapped.forEach((r, index) => {
            const key = `${r.docNumber}-${r.branchCode}-${r.codeProduct}-${r.quantity}-${r.value}`;
            if (uniqueMap.has(key)) {
                duplicates.push({
                    index,
                    docNumber: r.docNumber,
                    branchCode: r.branchCode,
                    codeProduct: r.codeProduct,
                    quantity: r.quantity,
                    value: r.value,
                    existingIndex: uniqueMap.get(key)
                });
            } else {
                uniqueMap.set(key, index);
            }
        });

        if (duplicates.length > 0) {
            console.log(`🔍 Found ${duplicates.length} duplicate records in batch:`, duplicates.slice(0, 5));
            // เก็บเฉพาะข้อมูลที่ไม่ซ้ำ
            mapped = mapped.filter((_, index) => uniqueMap.has(`${mapped[index].docNumber}-${mapped[index].branchCode}-${mapped[index].codeProduct}-${mapped[index].quantity}-${mapped[index].value}`));
            console.log(`📊 After deduplication: ${mapped.length} unique records`);
        }

        // ------------------------------------------------------------
        // 5) Build Ultra-Fast Bulk Upsert (with Batches to avoid P2035)
        // ------------------------------------------------------------
        const BATCH_SIZE = 3000; // 3000 rows * 8 params = 24,000 bind vars (< 32,767 limit)
        const totalBatches = Math.ceil(mapped.length / BATCH_SIZE);

        for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
            const chunk = mapped.slice(i, i + BATCH_SIZE);
            const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

            const values = chunk.map((r) => {
                // Fallback for required string columns to prevent Prisma 23502 error
                const docStatus = r.docStatus || "";
                const reason = r.reason || "";

                return Prisma.sql`(${r.codeProduct}, ${r.branchCode}, ${r.docNumber}, ${r.date}, ${docStatus}, ${reason}, ${r.quantity}, ${r.value})`;
            });

            const sql = Prisma.sql`
                INSERT INTO "withdraw"
                ("codeProduct", "branchCode", "docNumber", "date", "docStatus", "reason", "quantity", "value")
                VALUES ${Prisma.join(values)}
                ON CONFLICT ("docNumber", "branchCode", "codeProduct", "quantity", "value") 
                DO UPDATE SET 
                    "date" = EXCLUDED."date",
                    "docStatus" = EXCLUDED."docStatus",
                    "reason" = EXCLUDED."reason"
            `;

            await prisma.$executeRaw(sql);

            const progress = 85 + Math.floor((currentBatch / totalBatches) * 10);
            setUploadJob(jobId, progress, `saving batch ${currentBatch}/${totalBatches}`);
        }

        // ✅ บันทึกเวลาอัปเดตล่าสุด
        await touchDataSync('withdraw', mapped.length);

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
