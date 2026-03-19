const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

const CHUNK_SIZE = 1000;

exports.uploadSKU_XLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-sku");
    setUploadJob(jobId, 5, "reading file");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        setUploadJob(jobId, 15, "validating data");

        // 1) Clean / Validate แถว (ต้องมีทุก field)
        const missingRequired = rows.some(r => !r.branchCode || !r.shelfCode || r.rowNo == null || r.codeProduct == null || r.index == null);
        if (missingRequired) {
            throw new Error("พบบางแถวขาดข้อมูลที่จำเป็น (branchCode, shelfCode, rowNo, codeProduct, index)");
        }

        const skuData = rows.map(row => ({
            branchCode: String(row.branchCode).trim(),
            shelfCode: String(row.shelfCode).trim(),
            rowNo: parseInt(row.rowNo, 10),
            codeProduct: parseInt(row.codeProduct, 10),
            index: parseInt(row.index, 10),
        }));

        // 2) ตรวจสอบ Duplicate Keys ในไฟล์ (branchCode + codeProduct ซ้ำกันในไฟล์)
        const skuMap = new Map();
        const duplicates = [];
        for (const item of skuData) {
            const key = `${item.branchCode}_${item.codeProduct}`;
            if (skuMap.has(key)) duplicates.push(key);
            skuMap.set(key, item);
        }
        
        if (duplicates.length > 0) {
            throw new Error(`พบข้อมูลซ้ำซ้อนในไฟล์ (1 สินค้า ต้องมี 1 ตำแหน่งต่อสาขาเท่านั้น): ${duplicates.slice(0, 5).join(', ')} ...`);
        }

        const uniqueSkuData = Array.from(skuMap.values());
        setUploadJob(jobId, 30, "upserting to database");

        // 3) Prisma Upsert ใน Transaction รองรับการเขียนทับ/สร้างใหม่
        await prisma.$transaction(async (tx) => {
            for (let i = 0; i < uniqueSkuData.length; i += CHUNK_SIZE) {
                const chunk = uniqueSkuData.slice(i, i + CHUNK_SIZE);
                
                const upsertPromises = chunk.map(item => 
                    tx.sku.upsert({
                        where: {
                            branchCode_codeProduct: {
                                branchCode: item.branchCode,
                                codeProduct: item.codeProduct
                            }
                        },
                        update: { 
                            shelfCode: item.shelfCode,
                            rowNo: item.rowNo,
                            index: item.index 
                        },
                        create: item
                    })
                );

                await Promise.all(upsertPromises);

                const currentBatch = Math.floor(i / CHUNK_SIZE) + 1;
                const totalBatches = Math.ceil(uniqueSkuData.length / CHUNK_SIZE);
                const progress = 30 + Math.floor((currentBatch / totalBatches) * 60);
                setUploadJob(jobId, progress, `upserting batch ${currentBatch}/${totalBatches}`);
            }
        }, { timeout: 120000 });

        // ✅ บันทึกเวลาอัปเดตล่าสุด
        await touchDataSync('sku', uniqueSkuData.length);

        setUploadJob(jobId, 95, "finalizing");
        finishUploadJob(jobId, `completed - ${uniqueSkuData.length} SKU records synced`);
        res.status(200).send(`SKU XLSX uploaded & synced successfully! (${uniqueSkuData.length} records)`);

    } catch (err) {
        console.error("SKU XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
