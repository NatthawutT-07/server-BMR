const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

// ใช้ Worker Thread สำหรับ Parse Excel (ไม่ Block Event Loop)
exports.uploadItemMinMaxXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-minmax");
    setUploadJob(jobId, 5, "starting worker");

    try {
        // ใช้ Worker Thread parse Excel (Non-blocking)
        const mapped = await runExcelWorker(
            req.file.buffer,
            "minmax",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!mapped || mapped.length === 0) {
            failUploadJob(jobId, "No valid data found");
            return res.status(400).json({ error: "No valid data found in file" });
        }

        setUploadJob(jobId, 85, "comparing with database");

        // ---------------------------
        // 3) Load all existing rows (only 1 query)
        // ---------------------------
        const existingRows = await prisma.minMaxAutoPO.findMany();
        const dbMap = new Map();

        existingRows.forEach(x => {
            dbMap.set(x.branch_code + "|" + x.item_code, x);
        });

        // ---------------------------
        // 4) Separate INSERT + UPDATE
        // ---------------------------
        const toInsert = [];
        const toUpdate = [];

        for (const row of mapped) {
            const key = row.branch_code + "|" + row.item_code;
            const old = dbMap.get(key);

            if (!old) {
                toInsert.push(row);
                continue;
            }

            if (
                old.min_stock !== row.min_stock ||
                old.max_stock !== row.max_stock ||
                old.pack_order !== row.pack_order
            ) {
                toUpdate.push(row);
            }
        }

        // ---------------------------
        // 5) Batch Insert (fast)
        // ---------------------------
        if (toInsert.length > 0) {
            await prisma.minMaxAutoPO.createMany({
                data: toInsert,
                skipDuplicates: true
            });
        }

        // ---------------------------
        // 6) Batch Update (Super Fast)
        // ---------------------------
        if (toUpdate.length > 0) {
            const values = toUpdate.map((r) =>
                Prisma.sql`(${r.branch_code}, ${r.item_code}, ${r.min_stock}, ${r.max_stock}, ${r.pack_order})`
            );

            const sql = Prisma.sql`
                UPDATE "MinMaxAutoPO" AS t SET
                    "min_stock" = v."min_stock",
                    "max_stock" = v."max_stock",
                    "pack_order" = v."pack_order"
                FROM (VALUES ${Prisma.join(values)})
                AS v("branch_code", "item_code", "min_stock", "max_stock", "pack_order")
                WHERE
                    t."branch_code" = v."branch_code"
                    AND t."item_code" = v."item_code"
            `;

            await prisma.$executeRaw(sql);
        }

        // บันทึกเวลาอัปเดตล่าสุด
        await touchDataSync('minMax', toInsert.length + toUpdate.length);

        setUploadJob(jobId, 95, "saving data");

        finishUploadJob(jobId, "completed");
        return res.status(200).json({
            message: "Item MinMax imported successfully (Worker Thread)",
            inserted: toInsert.length,
            updated: toUpdate.length,
            skipped: mapped.length - (toInsert.length + toUpdate.length)
        });

    } catch (err) {
        console.error("XLSX Worker Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
