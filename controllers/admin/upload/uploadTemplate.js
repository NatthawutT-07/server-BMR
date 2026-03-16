const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob } = require('./uploadJob');

const BATCH_SIZE = 5000;

exports.uploadTemplateXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-template");
    setUploadJob(jobId, 5, "reading file");

    try {
        // ===============================
        // 1) อ่านไฟล์และแปลงเป็น JSON
        // ===============================
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        // ===============================
        // 2) Clean + Normalize
        // ===============================
        const initialData = rows.map(row => {
            let branchCode = row.branchCode?.trim() || row.StoreCode?.trim() || null;

            // Normalize ST code เช่น ST1 → ST001
            if (branchCode) {
                const match = branchCode.match(/^ST0*(\d{1,})$/);
                if (match) branchCode = `ST${match[1].padStart(3, "0")}`;
            }

            const shelfCode = row.shelfCode?.trim() || null;

            // ❗ ถ้าหลักสำคัญหายไป ให้ข้าม
            if (!branchCode || !shelfCode) return null;

            return {
                branchCode,
                shelfCode,
                fullName: row.fullName?.trim() || null, // ✔ null ได้
                rowQty: parseInt(row.rowQty || row.RowQty || 0, 10),
                type: null,
            };
        }).filter(Boolean);

        // ===============================
        // 3) ลบ DUPLICATE จากไฟล์เอง
        // ===============================
        const uniqueMap = new Map();
        for (const item of initialData) {
            const key = `${item.branchCode}_${item.shelfCode}`;
            uniqueMap.set(key, item); // ถ้าซ้ำ → ให้ตัวล่าสุดชนะ
        }
        const templateData = Array.from(uniqueMap.values());

        // ===============================
        // 4) Swap Table Strategy
        // ===============================
        setUploadJob(jobId, 45, "preparing temporary table");

        // 4.1) ลบข้อมูลใน TempTamplate ออกก่อน
        await prisma.tempTamplate.deleteMany({});

        // 4.2) Insert ข้อมูลทั้งหมดลงในตาราง TempTamplate ก่อนเพื่อตรวจสอบความถูกต้อง
        const totalBatches = Math.ceil(templateData.length / BATCH_SIZE);
        for (let i = 0; i < templateData.length; i += BATCH_SIZE) {
            const chunk = templateData.slice(i, i + BATCH_SIZE);
            const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

            await prisma.tempTamplate.createMany({
                data: chunk,
                skipDuplicates: true,
            });

            const progress = 45 + Math.floor((currentBatch / totalBatches) * 30);
            setUploadJob(jobId, progress, `uploading batch ${currentBatch}/${totalBatches} to temp table`);
        }

        // 4.3) หาก Insert ลง Temp ครบถ้วนโดยไม่มี error ให้ทำ Transaction เพื่อ Swap ข้อมูลเข้าตารางจริง
        setUploadJob(jobId, 80, "swapping data to live table");

        await prisma.$transaction(async (tx) => {
            // ลบข้อมูลใน Tamplate (ตารางจริง) ออกทั้งหมด
            await tx.tamplate.deleteMany({});
            
            // ใช้ Raw SQL Query เพื่อ Copy Data 
            await tx.$executeRaw`
                INSERT INTO "Tamplate" ("branchCode", "shelfCode", "fullName", "rowQty", "type")
                SELECT "branchCode", "shelfCode", "fullName", "rowQty", "type"
                FROM "TempTamplate"
                ON CONFLICT DO NOTHING;
            `;
            
            // ล้างตาราง Temp เมื่อเสร็จสิ้น
            await tx.tempTamplate.deleteMany({});
        });

        // ===============================
        // 5) SUCCESS
        // ===============================
        setUploadJob(jobId, 95, "finalizing");
        finishUploadJob(jobId, `completed - ${templateData.length} records synced`);
        res.status(200).send(`Template XLSX uploaded & synced successfully! (${templateData.length} records)`);

    } catch (err) {
        console.error("Template XLSX Error:", err);
        // พยายามล้างตาราง Temp หากเกิด Error
        try {
           await prisma.tempTamplate.deleteMany({});
        } catch(e) {}
        
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
