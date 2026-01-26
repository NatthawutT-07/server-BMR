const prisma = require('../../../config/prisma');

const uploadJobs = new Map();
const MAX_JOB_AGE_MS = 6 * 60 * 60 * 1000;

const touchDataSync = async (key, rowCount) => {
    try {
        await prisma.dataSync.upsert({
            where: { key },
            update: { updatedAt: new Date(), rowCount: rowCount ?? undefined },
            create: { key, updatedAt: new Date(), rowCount: rowCount ?? 0 },
        });
    } catch (err) {
        console.error(`DataSync update failed (${key}):`, err);
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
    const rawId = req.headers["x-upload-job-id"];
    const jobId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!jobId) return null;
    uploadJobs.set(jobId, {
        status: "processing",
        progress: 0,
        label: label || "upload",
        message: "starting",
        updatedAt: Date.now(),
    });
    return jobId;
};

const setUploadJob = (jobId, progress, message) => {
    if (!jobId) return;
    const job = uploadJobs.get(jobId);
    uploadJobs.set(jobId, {
        ...(job || {}),
        status: "processing",
        progress: Math.max(0, Math.min(100, Number(progress) || 0)),
        message: message || job?.message || "",
        updatedAt: Date.now(),
    });
};

const finishUploadJob = (jobId, message) => {
    if (!jobId) return;
    const job = uploadJobs.get(jobId);
    uploadJobs.set(jobId, {
        ...(job || {}),
        status: "done",
        progress: 100,
        message: message || "done",
        updatedAt: Date.now(),
    });
};

const failUploadJob = (jobId, message) => {
    if (!jobId) return;
    const job = uploadJobs.get(jobId);
    uploadJobs.set(jobId, {
        ...(job || {}),
        status: "error",
        progress: Math.max(0, Math.min(100, Number(job?.progress) || 0)),
        message: message || "error",
        updatedAt: Date.now(),
    });
};

const getUploadStatus = async (req, res) => {
    try {
        cleanupOldJobs();
        const { jobId } = req.query;
        if (!jobId) {
            return res.status(400).json({ message: "jobId is required" });
        }
        const job = uploadJobs.get(String(jobId));
        if (!job) {
            return res.status(404).json({ message: "job not found" });
        }
        return res.json(job);
    } catch (err) {
        console.error("getUploadStatus error:", err);
        return res.status(500).json({ message: "status error" });
    }
};

module.exports = {
    initUploadJob,
    setUploadJob,
    finishUploadJob,
    failUploadJob,
    getUploadStatus,
    touchDataSync
};
