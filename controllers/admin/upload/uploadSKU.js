const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob } = require('./uploadJob');

const BATCH_SIZE = 5000;

exports.uploadSKU_XLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-sku");
    setUploadJob(jobId, 5, "reading file");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        setUploadJob(jobId, 15, "parsing rows");

        // อ่าน JSON จาก header
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        // ----------------------------------------------------
        // 1) Clean / Validate แถว (ต้องมีทุก field)
        // ----------------------------------------------------
        setUploadJob(jobId, 25, `validating ${rows.length} rows`);
        const validRows = rows.filter(r =>
            r.id &&
            r.branchCode &&
            r.shelfCode &&
            r.rowNo &&
            r.codeProduct
        );

        // ----------------------------------------------------
        // 2) Mapping dataset (ไม่ใช้ id จากไฟล์ ปล่อยให้ DB auto-generate)
        // ----------------------------------------------------
        setUploadJob(jobId, 35, `mapping ${validRows.length} valid rows`);
        const skuData = validRows.map(row => ({
            branchCode: String(row.branchCode).trim(),
            shelfCode: String(row.shelfCode).trim(),
            rowNo: parseInt(row.rowNo, 10),
            codeProduct: parseInt(row.codeProduct, 10),
            index: row.index ? parseInt(row.index, 10) : 0,
        }));

        // ----------------------------------------------------
        // 3) TRUNCATE + Re-insert (fastest approach)
        // ----------------------------------------------------
        setUploadJob(jobId, 45, "clearing existing SKU data");

        // ใช้ transaction เพื่อความปลอดภัย
        await prisma.$transaction(async (tx) => {
            // ลบข้อมูลเก่าทั้งหมด
            await tx.sku.deleteMany({});

            // Insert ใหม่แบบ batch
            const totalBatches = Math.ceil(skuData.length / BATCH_SIZE);

            for (let i = 0; i < skuData.length; i += BATCH_SIZE) {
                const chunk = skuData.slice(i, i + BATCH_SIZE);
                const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

                await tx.sku.createMany({
                    data: chunk,
                    skipDuplicates: true, // ข้ามถ้ามี duplicate
                });

                // Progress: 50-90% during inserts
                const progress = 50 + Math.floor((currentBatch / totalBatches) * 40);
                setUploadJob(jobId, progress, `inserted batch ${currentBatch}/${totalBatches}`);
            }
        });

        setUploadJob(jobId, 95, "finalizing");
        finishUploadJob(jobId, `completed - ${skuData.length} SKU records synced`);
        res.status(200).send(`SKU XLSX uploaded & synced successfully! (${skuData.length} records)`);

    } catch (err) {
        console.error("SKU XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
