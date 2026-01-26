const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob } = require('./uploadJob');

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
        // 4) ลบข้อมูลเก่าที่ไม่อยู่ในไฟล์ใหม่
        // ===============================
        await prisma.tamplate.deleteMany({
            where: {
                NOT: {
                    OR: templateData.map(item => ({
                        branchCode: item.branchCode,
                        shelfCode: item.shelfCode,
                    }))
                }
            }
        });

        // ===============================
        // 5) โหลดข้อมูลเก่าที่ key ตรงกัน
        // ===============================
        const existing = await prisma.tamplate.findMany({
            where: {
                OR: templateData.map(item => ({
                    branchCode: item.branchCode,
                    shelfCode: item.shelfCode,
                })),
            }
        });

        const existingMap = new Map();
        existing.forEach(item => {
            existingMap.set(`${item.branchCode}_${item.shelfCode}`, item);
        });

        // ===============================
        // 6) แยก INSERT / UPDATE
        // ===============================
        const toInsert = [];
        const toUpdate = [];

        for (const item of templateData) {
            const key = `${item.branchCode}_${item.shelfCode}`;

            if (!existingMap.has(key)) {
                toInsert.push(item);
            } else {
                const old = existingMap.get(key);

                const changed =
                    old.fullName !== item.fullName ||
                    old.rowQty !== item.rowQty ||
                    old.type !== item.type;

                if (changed) toUpdate.push(item);
            }
        }

        // ===============================
        // 7) INSERT แบบ batch
        // ===============================
        if (toInsert.length > 0) {
            await prisma.tamplate.createMany({
                data: toInsert,
            });
        }

        // ===============================
        // 8) UPDATE แบบ batch
        // ===============================
        for (const item of toUpdate) {
            await prisma.tamplate.update({
                where: {
                    branchCode_shelfCode: {
                        branchCode: item.branchCode,
                        shelfCode: item.shelfCode,
                    },
                },
                data: item,
            });
        }

        // ===============================
        // 9) SUCCESS
        // ===============================
        setUploadJob(jobId, 90, "saving data");
        finishUploadJob(jobId, "completed");
        res.status(200).send("Template XLSX uploaded & synced successfully!");

    } catch (err) {
        console.error("Template XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
