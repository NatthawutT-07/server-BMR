const { Worker } = require("worker_threads");
const path = require("path");

const runExcelWorker = (buffer, type, onProgress = null) => {
    return new Promise((resolve, reject) => {
        const workerPath = path.join(__dirname, "excelWorker.js");

        const worker = new Worker(workerPath, {
            workerData: {
                buffer: buffer, 
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
