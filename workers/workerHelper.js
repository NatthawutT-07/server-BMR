/**
 * Worker Helper
 * ฟังก์ชันสำหรับเรียกใช้ Excel Worker Thread จาก Controller
 */

const { Worker } = require("worker_threads");
const path = require("path");

/**
 * รัน Excel Worker Thread
 * @param {Buffer} buffer - ไฟล์ Excel ในรูป Buffer
 * @param {string} type - ประเภทไฟล์: "minmax" | "masterItem" | "stock" | "withdraw"
 * @param {Function} onProgress - Callback สำหรับอัปเดต progress (optional)
 * @returns {Promise<Array>} - ข้อมูลที่ parse แล้ว
 */
const runExcelWorker = (buffer, type, onProgress = null) => {
    return new Promise((resolve, reject) => {
        const workerPath = path.join(__dirname, "excelWorker.js");

        const worker = new Worker(workerPath, {
            workerData: {
                buffer: buffer, // ส่ง buffer ตรงๆ (Worker จะ clone อัตโนมัติ)
                type
            }
        });

        worker.on("message", (msg) => {
            if (msg.type === "progress" && onProgress) {
                onProgress(msg.progress, msg.message);
            } else if (msg.type === "result") {
                resolve(msg.data);
            } else if (msg.type === "error") {
                reject(new Error(msg.error));
            }
        });

        worker.on("error", (err) => {
            reject(err);
        });

        worker.on("exit", (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
};

module.exports = { runExcelWorker };
