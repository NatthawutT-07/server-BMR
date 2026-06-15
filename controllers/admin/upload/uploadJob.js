const prisma = require('../../../config/prisma');
const { normalizeLegacyBangkokStoredDate, toBangkokOffsetISOString } = require('../../../utils/dateHelper');

const touchDataSync = async (key, rowCount, branch_code, db = prisma) => {
    try {
        const updatedAt = new Date();
        const safeRowCount = rowCount ?? 0;
        // show เวลา upload stock
        if (branch_code) {
            await db.branchDataSync.upsert({
                where: { branch_code_key: { branch_code, key } },
                create: { branch_code, key, updatedAt, rowCount: safeRowCount },
                update: { updatedAt, rowCount: safeRowCount },
            });
        } else {
            await db.dataSync.upsert({
                where: { key },
                create: { key, updatedAt, rowCount: safeRowCount },
                update: { updatedAt, rowCount: safeRowCount },
            });
        }
    } catch (err) {
        console.error(`DataSync update failed (${key}, ${branch_code}):`, err);
        throw err;
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

const getAllSyncDates = async (req, res) => {
    try {
        const syncs = await prisma.dataSync.findMany();
        const result = {};
        syncs.forEach(s => {
            result[s.key] = {
                updatedAt: toBangkokOffsetISOString(normalizeLegacyBangkokStoredDate(s.updatedAt)),
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
    getAllSyncDates,
    touchDataSync
};
