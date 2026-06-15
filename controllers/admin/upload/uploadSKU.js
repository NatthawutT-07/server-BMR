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

        // 1) Clean / Validate
        const missingRequired = rows.some(r => !r.branch_code || !r.shelf_code || r.shelf_row_number == null || r.item_code == null || r.shelf_index_number == null);
        if (missingRequired) {
            throw new Error("พบบางแถวขาดข้อมูลที่จำเป็น (branch_code, shelf_code, shelf_row_number, item_code, index)");
        }

        const skuData = rows.map(row => ({
            branch_code: String(row.branch_code).trim(),
            shelf_code: String(row.shelf_code).trim(),
            shelf_row_number: parseInt(row.shelf_row_number, 10),
            item_code: String(row.item_code).trim().padStart(5, "0"),
            shelf_index_number: parseInt(row.shelf_index_number, 10),
        }));

        // 2) Check Duplicate 
        const skuMap = new Map();
        const duplicates = [];
        for (const item of skuData) {
            const key = `${item.branch_code}_${item.item_code}`;
            if (skuMap.has(key)) duplicates.push(key);
            skuMap.set(key, item);
        }
        
        if (duplicates.length > 0) {
            throw new Error(`พบข้อมูลซ้ำซ้อนในไฟล์ (1 สินค้า ต้องมี 1 ตำแหน่งต่อสาขาเท่านั้น): ${duplicates.slice(0, 5).join(', ')} ...`);
        }

        const uniqueSkuData = Array.from(skuMap.values());
        setUploadJob(jobId, 30, "upserting to database");

        // 3) Prisma Upsert ใน Transaction
        await prisma.$transaction(async (tx) => {
            for (let i = 0; i < uniqueSkuData.length; i += CHUNK_SIZE) {
                const chunk = uniqueSkuData.slice(i, i + CHUNK_SIZE);
                
                const upsertPromises = chunk.map(item => 
                    tx.skuPosition.upsert({
                        where: {
                            branch_code_item_code: {
                                branch_code: item.branch_code,
                                item_code: item.item_code
                            }
                        },
                        update: { 
                            shelf_code: item.shelf_code,
                            shelf_row_number: item.shelf_row_number,
                            shelf_index_number: item.shelf_index_number 
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

        await touchDataSync('skuPosition', uniqueSkuData.length);

        setUploadJob(jobId, 95, "finalizing");
        finishUploadJob(jobId, `completed - ${uniqueSkuData.length} SKU records synced`);
        res.status(200).send(`SKU XLSX uploaded & synced successfully! (${uniqueSkuData.length} records)`);

    } catch (err) {
        console.error("SKU XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
