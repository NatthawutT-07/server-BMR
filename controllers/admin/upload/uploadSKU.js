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
        // 2) Mapping dataset
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
        // 3) Swap Table Strategy
        // ----------------------------------------------------
        setUploadJob(jobId, 45, "preparing temporary table");

        // 3.1) ลบข้อมูลใน TempSku ออกก่อน
        await prisma.tempSku.deleteMany({});

        // 3.2) Insert ข้อมูลทั้งหมดลงในตาราง TempSku ก่อนเพื่อตรวจสอบความถูกต้องและป้องกันข้อผิดพลาดกลางทาง
        const totalBatches = Math.ceil(skuData.length / BATCH_SIZE);
        for (let i = 0; i < skuData.length; i += BATCH_SIZE) {
            const chunk = skuData.slice(i, i + BATCH_SIZE);
            const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

            await prisma.tempSku.createMany({
                data: chunk,
                skipDuplicates: true,
            });

            // Progress: 45-75% during inserts to temp table
            const progress = 45 + Math.floor((currentBatch / totalBatches) * 30);
            setUploadJob(jobId, progress, `uploading batch ${currentBatch}/${totalBatches} to temp table`);
        }

        // 3.3) หาก Insert ลง Temp ครบถ้วนโดยไม่มี error ให้ทำ Transaction เพื่อ Swap ข้อมูลเข้าตารางจริง
        setUploadJob(jobId, 80, "swapping data to live table");
        
        await prisma.$transaction(async (tx) => {
            // ลบข้อมูลใน Sku (ตารางจริง) ออกทั้งหมด
            await tx.sku.deleteMany({});
            
            // อ่านข้อมูลจาก Temp กลับมา (เพราะ Prisma Client ไม่มีคำสั่ง INSERT INTO SELECT ตรงๆ แบบ Raw SQL ที่ข้าม DB type ได้ง่ายๆ ในระดับ ORM object ยกเว้นจะใช้ $executeRawUnsafe ซึ่งเราหลีกเลี่ยง)
            // แต่เนื่องจากเรามี skuData อยู่ใน memory (Node.js) อยู่แล้ว เราสามารถ insert ตรงเข้า tx.sku ได้เลย หรือจะใช้ $executeRaw เพื่อความเร็วสูงสุดในฐานข้อมูลเดียวกัน
            
            // ใช้ Raw SQL Query อย่างปลอดภัยในการ Copy Data จากตาราง TempSku ไปยัง Sku ทันที
            // วิธีนี้เร็วกว่าการโหลดเข้า Node.js Memory อีกรอบ
            await tx.$executeRaw`
                INSERT INTO "Sku" ("branchCode", "shelfCode", "rowNo", "codeProduct", "index")
                SELECT "branchCode", "shelfCode", "rowNo", "codeProduct", "index"
                FROM "TempSku"
                ON CONFLICT DO NOTHING;
            `;
            
            // ล้างตาราง Temp เมื่อเสร็จสิ้น
            await tx.tempSku.deleteMany({});
        });

        setUploadJob(jobId, 95, "finalizing");
        finishUploadJob(jobId, `completed - ${skuData.length} SKU records synced`);
        res.status(200).send(`SKU XLSX uploaded & synced successfully! (${skuData.length} records)`);

    } catch (err) {
        console.error("SKU XLSX Error:", err);
        // พยายามล้างตาราง Temp หากเกิด Error
        try {
           await prisma.tempSku.deleteMany({});
        } catch(e) {}
        
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
