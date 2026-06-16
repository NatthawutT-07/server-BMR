const prisma = require('../../../config/prisma');
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

const INSERT_BATCH_SIZE = 1000;

exports.uploadMasterItemXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-masterItem");
    setUploadJob(jobId, 5, "starting worker");

    try {
        const parsedRows = await runExcelWorker(
            req.file.buffer,
            "masterItem",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!parsedRows || parsedRows.length === 0) {
            failUploadJob(jobId, "No valid data found");
            return res.status(400).json({ error: "No valid master item data found in file" });
        }

        const normalizeItem = (r) => ({
            item_code: String(r.item_code).trim().padStart(5, "0"),
            item_name: r.item_name != null ? String(r.item_name) : null,
            group_name: r.group_name != null ? String(r.group_name) : null,
            item_status: r.item_status != null ? String(r.item_status) : null,
            barcode: r.barcode != null ? String(r.barcode) : null,
            brand_name: r.brand_name != null ? String(r.brand_name) : null,
            is_consignment: r.is_consignment != null ? String(r.is_consignment) : null,
            purchase_price: parseFloat(r.purchase_price) || 0,
            selling_price_vat: parseInt(r.selling_price_vat, 10) || 0,
            preferred_vendor_code: r.preferred_vendor_code != null ? String(r.preferred_vendor_code) : null,
            preferred_vendor_name: r.preferred_vendor_name != null ? String(r.preferred_vendor_name) : null,
            gross_profit_pct: r.gross_profit_pct != null ? String(r.gross_profit_pct) : null,
            shelf_life_days: r.shelf_life_days != null ? String(r.shelf_life_days) : null,
        });

        // Keep the final occurrence when an item code appears more than once.
        const itemMap = new Map();
        parsedRows.forEach(row => {
            const item = normalizeItem(row);
            itemMap.set(item.item_code, item);
        });
        const mapped = Array.from(itemMap.values());
        const duplicateRows = parsedRows.length - mapped.length;

        setUploadJob(jobId, 85, "replacing master items");

        let deleted = 0;
        let inserted = 0;
        await prisma.$transaction(async (tx) => {
            const deleteResult = await tx.masterItem.deleteMany();
            deleted = deleteResult.count;

            for (let i = 0; i < mapped.length; i += INSERT_BATCH_SIZE) {
                const chunk = mapped.slice(i, i + INSERT_BATCH_SIZE);
                const insertResult = await tx.masterItem.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                inserted += insertResult.count;

                const currentCount = Math.min(i + INSERT_BATCH_SIZE, mapped.length);
                const progress = 85 + Math.floor((currentCount / mapped.length) * 10);
                setUploadJob(jobId, progress, `saving ${currentCount}/${mapped.length}`);
            }

            await touchDataSync('masterItem', inserted, undefined, tx);
        }, { timeout: 120000 });

        setUploadJob(jobId, 95, "saving data");
        finishUploadJob(jobId, "completed");
        res.status(200).json({
            message: "Master Item XLSX replaced successfully",
            parsed_rows: parsedRows.length,
            unique_rows: mapped.length,
            deleted,
            inserted,
            updated: 0,
            skipped: 0,
            duplicate_rows: duplicateRows,
        });

    } catch (err) {
        console.error("XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
