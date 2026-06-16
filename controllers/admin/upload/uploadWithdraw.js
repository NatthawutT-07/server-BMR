const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

exports.uploadWithdrawXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-withdraw");
    setUploadJob(jobId, 5, "starting worker");

    try {
        let mapped = await runExcelWorker(
            req.file.buffer,
            "withdraw",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!mapped || mapped.length === 0) {
            failUploadJob(jobId, "No valid withdraw data");
            return res.status(200).send("No valid withdraw rows found.");
        }

        const parsedRows = mapped.length;
        mapped = mapped.filter(r =>
            r.document_status === "\u0e2d\u0e19\u0e38\u0e21\u0e31\u0e15\u0e34\u0e41\u0e25\u0e49\u0e27" &&
            r.reason !== "\u0e40\u0e1a\u0e34\u0e01\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e02\u0e32\u0e22"
        );
        const filteredRows = parsedRows - mapped.length;

        if (mapped.length === 0) {
            finishUploadJob(jobId, "completed");
            return res.status(200).json({
                message: "No valid withdraw data after filtering.",
                inserted: 0
            });
        }
        const uniqueMap = new Map();
        const duplicates = [];

        mapped.forEach((r, index) => {
            const key = `${r.document_reference}-${r.branch_code}-${r.item_code}-${r.quantity_withdraw}-${r.value_withdraw}`;
            if (uniqueMap.has(key)) {
                duplicates.push({
                    index,
                    document_reference: r.document_reference,
                    branch_code: r.branch_code,
                    item_code: r.item_code,
                    quantity_withdraw: r.quantity_withdraw,
                    value_withdraw: r.value_withdraw,
                    existingIndex: uniqueMap.get(key)
                });
            } else {
                uniqueMap.set(key, index);
            }
        });

        if (duplicates.length > 0) {
            mapped = mapped.filter((r, index) => {
                const key = `${r.document_reference}-${r.branch_code}-${r.item_code}-${r.quantity_withdraw}-${r.value_withdraw}`;
                return uniqueMap.get(key) === index;
            });
        }

        const BATCH_SIZE = 3000;
        const totalBatches = Math.ceil(mapped.length / BATCH_SIZE);
        let inserted = 0;

        for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
            const chunk = mapped.slice(i, i + BATCH_SIZE);
            const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

            const values = chunk.map((r) => {
                const document_status = r.document_status || "";
                const reason = r.reason || "";

                return Prisma.sql`(${r.item_code}, ${r.branch_code}, ${r.document_reference}, ${r.date_withdraw}, ${document_status}, ${reason}, ${r.quantity_withdraw}, ${r.value_withdraw})`;
            });

            const sql = Prisma.sql`
                INSERT INTO "Withdraw"
                ("item_code", "branch_code", "document_reference", "date_withdraw", "document_status", "reason", "quantity_withdraw", "value_withdraw")
                VALUES ${Prisma.join(values)}
                ON CONFLICT DO NOTHING
            `;

            inserted += await prisma.$executeRaw(sql);

            const progress = 85 + Math.floor((currentBatch / totalBatches) * 10);
            setUploadJob(jobId, progress, `saving batch ${currentBatch}/${totalBatches}`);
        }

        await touchDataSync('withdraw', inserted);

        finishUploadJob(jobId, "completed");
        return res.status(200).json({
            message: "withdraw XLSX imported (Worker Thread)",
            parsed_rows: parsedRows,
            inserted,
            skipped: filteredRows + duplicates.length,
            duplicate_rows: duplicates.length,
        });

    } catch (err) {
        console.error("XLSX Worker Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
