const prisma = require('../../../config/prisma');
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');
const { normalizeLegacyBangkokStoredDate } = require("../../../utils/dateHelper");
const cacheManager = require("../../../utils/cacheManager");

const BATCH_SIZE = 1000;

exports.uploadStockXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-stock");
    setUploadJob(jobId, 5, "starting worker");

    try {
        const mapped = await runExcelWorker(
            req.file.buffer,
            "stock",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!mapped || mapped.length === 0) {
            failUploadJob(jobId, "No valid stock data");
            return res.status(200).send("No valid stock rows found.");
        }

        setUploadJob(jobId, 85, "saving data");
        const user = req.user;

        const uniqueBranches = [...new Set(mapped.map(r => r.branch_code))];

        // Security Check
        if (user.role !== 'admin') {
            const forbiddenBranches = uniqueBranches.filter(bc => bc !== user.name);
            if (forbiddenBranches.length > 0) {
                failUploadJob(jobId, `Permission denied: You can only upload stock for branchMain ${user.name}`);
                return res.status(403).json({ error: `You are not allowed to upload stock for other branches (${forbiddenBranches.join(', ')})` });
            }

            const lastSync = await prisma.branchDataSync.findUnique({
                where: { branch_code_key: { branch_code: user.name, key: 'stock' } }
            });

            if (lastSync) {
                const lastUpdate = normalizeLegacyBangkokStoredDate(lastSync.updatedAt);
                const now = new Date();
                const diffMin = (now.getTime() - lastUpdate.getTime()) / (60 * 1000);
                if (diffMin < 60) {
                     const waitMin = Math.ceil(60 - diffMin);
                     if (waitMin > 0) {
                        failUploadJob(jobId, `Rate limit: Please wait ${waitMin} minutes.`);
                        return res.status(429).json({ error: `กรุณารออีกอย่างน้อย ${waitMin} นาที จึงจะอัปโหลดได้ใหม่อีกครั้ง` });
                     }
                }
            }
            // 
        }

        let inserted = 0;
        await prisma.$transaction(async (tx) => {
            if (user.role === 'admin') {
                await tx.$executeRaw`TRUNCATE TABLE "Stock" RESTART IDENTITY`;
            } else {
                await tx.stock.deleteMany({
                    where: { branch_code: user.name },
                });
            }

            for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
                const chunk = mapped.slice(i, i + BATCH_SIZE);
                const result = await tx.stock.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                inserted += result.count;

                const currentCount = Math.min(i + BATCH_SIZE, mapped.length);
                const progress = 85 + Math.floor((currentCount / mapped.length) * 10);
                setUploadJob(jobId, progress, `saving ${currentCount}/${mapped.length}`);
            }
        }, { timeout: 120000 });

        if (user.role === 'admin') {
            await touchDataSync('stock', inserted);
        }

        for (const bc of uniqueBranches) {
            const branchRows = mapped.filter(r => r.branch_code === bc).length;
            await touchDataSync('stock', branchRows, bc);
        }

        try {
            const templateCache = cacheManager.getCache("user-template");
            if (templateCache) {
                if (user.role === 'admin') {
                    templateCache.flushAll();
                } else {
                    const allKeys = templateCache.keys();
                    const keysToDelete = allKeys.filter(k => k.includes(`-${user.name}-`));
                    if (keysToDelete.length > 0) {
                        templateCache.del(keysToDelete);
                    }
                }
            }
        } catch (cacheErr) {
            console.error("Failed to clear cache:", cacheErr);
        }

        finishUploadJob(jobId, "completed");

        return res.status(200).json({
            message: "Stock XLSX imported successfully (Worker Thread)",
            inserted,
        });
    } catch (err) {
        console.error("XLSX Worker Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        return res.status(500).json({ error: err.message });
    }
};
