const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob } = require('./uploadJob');

// ✅ ใช้ Worker Thread สำหรับ Parse Excel (ไม่ Block Event Loop)
exports.uploadItemMinMaxXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-minmax");
    setUploadJob(jobId, 5, "starting worker");

    try {
        // ✅ ใช้ Worker Thread parse Excel (Non-blocking)
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
        const existingRows = await prisma.itemMinMax.findMany();
        const dbMap = new Map();

        existingRows.forEach(x => {
            dbMap.set(x.branchCode + "|" + x.codeProduct, x);
        });

        // ---------------------------
        // 4) Separate INSERT + UPDATE
        // ---------------------------
        const toInsert = [];
        const toUpdate = [];

        for (const row of mapped) {
            const key = row.branchCode + "|" + row.codeProduct;
            const old = dbMap.get(key);

            if (!old) {
                toInsert.push(row);
                continue;
            }

            if (
                old.minStore !== row.minStore ||
                old.maxStore !== row.maxStore
            ) {
                toUpdate.push(row);
            }
        }

        // ---------------------------
        // 5) Batch Insert (fast)
        // ---------------------------
        if (toInsert.length > 0) {
            await prisma.itemMinMax.createMany({
                data: toInsert,
                skipDuplicates: true
            });
        }

        // ---------------------------
        // 6) Batch Update (Super Fast)
        // ---------------------------
        if (toUpdate.length > 0) {
            const values = toUpdate.map((r) =>
                Prisma.sql`(${r.branchCode}, ${r.codeProduct}, ${r.minStore}, ${r.maxStore})`
            );

            const sql = Prisma.sql`
                UPDATE "ItemMinMax" AS t SET
                    "minStore" = v."minStore",
                    "maxStore" = v."maxStore"
                FROM (VALUES ${Prisma.join(values)})
                AS v("branchCode", "codeProduct", "minStore", "maxStore")
                WHERE
                    t."branchCode" = v."branchCode"
                    AND t."codeProduct" = v."codeProduct"
            `;

            await prisma.$executeRaw(sql);
        }

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
