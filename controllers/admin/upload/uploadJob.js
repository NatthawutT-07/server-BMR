const prisma = require('../../../config/prisma');

const uploadJobs = new Map();
const MAX_JOB_AGE_MS = 6 * 60 * 60 * 1000;

const touchDataSync = async (key, rowCount, branchCode, db = prisma) => {
    try {
        if (branchCode) {
            // อัปเดตเฉพาะรายสาขา (ไม่แตะ Global เพื่อไม่ให้สาขาอื่นเห็นเวลาที่ผิด)
            await db.$executeRaw`
                INSERT INTO "BranchDataSync" ("branchCode", "key", "updatedAt", "rowCount")
                VALUES (${branchCode}, ${key}, timezone('Asia/Bangkok', NOW()), ${rowCount ?? 0})
                ON CONFLICT ("branchCode", "key")
                DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt", "rowCount" = EXCLUDED."rowCount"
            `;
        } else {
            // อัปเดตเวลาภาพรวม (Global) — ใช้เมื่อ Admin upload เท่านั้น
            await db.$executeRaw`
                INSERT INTO "DataSync" ("key", "updatedAt", "rowCount")
                VALUES (${key}, timezone('Asia/Bangkok', NOW()), ${rowCount ?? 0})
                ON CONFLICT ("key")
                DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt", "rowCount" = EXCLUDED."rowCount"
            `;
        }
    } catch (err) {
        console.error(`DataSync update failed (${key}, ${branchCode}):`, err);
        throw err;
    }
};

const cleanupOldJobs = () => {
    const now = Date.now();
    for (const [jobId, job] of uploadJobs.entries()) {
        if (now - (job.updatedAt || 0) > MAX_JOB_AGE_MS) {
            uploadJobs.delete(jobId);
        }
    }
};

const initUploadJob = (req, label) => {
    return null;
};

const setUploadJob = (jobId, progress, message) => {
    return;
};

const finishUploadJob = (jobId, message) => {
    return;
};

const failUploadJob = (jobId, message) => {
    return;
};

const response = require("../../../utils/responseHelper");

const getUploadStatus = async (req, res) => {
    return res.status(404).json({ error: "Job status polling is disabled" });
};

const getAllSyncDates = async (req, res) => {
    try {
        const syncs = await prisma.dataSync.findMany();
        const result = {};
        syncs.forEach(s => {
            result[s.key] = {
                updatedAt: s.updatedAt.toISOString(),
                rowCount: s.rowCount
            };
        });
        return response.success(res, result);
    } catch (err) {
        console.error("getAllSyncDates error:", err);
        return response.error(res, "error fetching sync dates");
    }
};

module.exports = {
    initUploadJob,
    setUploadJob,
    finishUploadJob,
    failUploadJob,
    getUploadStatus,
    getAllSyncDates,
    touchDataSync
};
