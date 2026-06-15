const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

const CHUNK_SIZE = 1000;

exports.uploadTemplateXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-template");
    setUploadJob(jobId, 5, "reading file");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        const initialData = rows.map(row => {
            let branch_code = row.branch_code?.trim() || row.StoreCode?.trim() || null;
            if (branch_code) {
                const match = branch_code.match(/^ST0*(\d{1,})$/);
                if (match) branch_code = `ST${match[1].padStart(3, "0")}`;
            }

            const shelf_code = row.shelf_code?.trim() || null;
            if (!branch_code || !shelf_code) return null;

            return {
                branch_code,
                shelf_code,
                shelf_name: row.shelf_name?.trim() || null,
                shelf_total_row: parseInt(row.shelf_total_row || row.RowQty || 0, 10),
                type: row.type?.trim() || null,
            };
        }).filter(Boolean);

        // 1. Validate Duplicate
        const tempMap = new Map();
        const duplicates = [];
        for (const item of initialData) {
            const key = `${item.branch_code}_${item.shelf_code}`;
            if (tempMap.has(key)) duplicates.push(key);
            tempMap.set(key, item);
        }
        if (duplicates.length > 0) {
            throw new Error(`พบข้อมูลซ้ำซ้อนในไฟล์ Template: ${duplicates.slice(0, 5).join(', ')} ...`);
        }

        const templateData = Array.from(tempMap.values());
        setUploadJob(jobId, 25, "analyzing sync delta");

        // 2. เช็คว่าต้องลบตัวไหนออก (มีใน DB แต่ไม่มีในไฟล์) โดยตรวจจับเฉพาะสาขาที่มีในไฟล์อัปโหลด
        const branchesInFile = [...new Set(templateData.map(t => t.branch_code))];
        const existingInDb = await prisma.Template.findMany({
            where: { branch_code: { in: branchesInFile } },
            select: { id: true, branch_code: true, shelf_code: true }
        });

        const fileKeys = new Set(templateData.map(t => `${t.branch_code}_${t.shelf_code}`));
        const toDeleteIds = existingInDb
            .filter(dbItem => !fileKeys.has(`${dbItem.branch_code}_${dbItem.shelf_code}`))
            .map(dbItem => dbItem.id);

        setUploadJob(jobId, 40, `deleting ${toDeleteIds.length} missing templates`);

        // 3. Transaction ควบคุมการ Sync (Delete -> Upsert)
        await prisma.$transaction(async (tx) => {
            
            // Delete รายการที่หายไปเป็น Batch
            if (toDeleteIds.length > 0) {
                for (let i = 0; i < toDeleteIds.length; i += CHUNK_SIZE) {
                    await tx.Template.deleteMany({
                        where: { id: { in: toDeleteIds.slice(i, i + CHUNK_SIZE) } }
                    });
                }
            }

            // Upsert ข้อมูลใหม่
            for (let i = 0; i < templateData.length; i += CHUNK_SIZE) {
                const chunk = templateData.slice(i, i + CHUNK_SIZE);
                
                const upsertPromises = chunk.map(item => 
                    tx.Template.upsert({
                        where: {
                            branch_code_shelf_code: {
                                branch_code: item.branch_code,
                                shelf_code: item.shelf_code
                            }
                        },
                        update: {
                            shelf_name: item.shelf_name,
                            shelf_total_row: item.shelf_total_row,
                            type: item.type
                        },
                        create: item
                    })
                );

                await Promise.all(upsertPromises);
                
                const currentBatch = Math.floor(i / CHUNK_SIZE) + 1;
                const totalBatches = Math.ceil(templateData.length / CHUNK_SIZE);
                const progress = 40 + Math.floor((currentBatch / totalBatches) * 50);
                setUploadJob(jobId, progress, `upserting batch ${currentBatch}/${totalBatches}`);
            }
        }, { timeout: 120000 });

        // บันทึกเวลาอัปเดตล่าสุด
        await touchDataSync('template', templateData.length);

        setUploadJob(jobId, 95, "finalizing");
        finishUploadJob(jobId, `completed - synced ${templateData.length} records, deleted ${toDeleteIds.length}`);
        res.status(200).send(`Template XLSX synced! (Upserted: ${templateData.length}, Deleted: ${toDeleteIds.length})`);

    } catch (err) {
        console.error("Template XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
