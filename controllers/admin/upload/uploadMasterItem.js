const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

exports.uploadMasterItemXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-masterItem");
    setUploadJob(jobId, 5, "starting worker");

    try {
        const mapped = await runExcelWorker(
            req.file.buffer,
            "masterItem",
            (progress, message) => setUploadJob(jobId, progress, message)
        );

        if (!mapped || mapped.length === 0) {
            failUploadJob(jobId, "No valid data found");
            return res.status(400).json({ error: "No valid master item data found in file" });
        }

        setUploadJob(jobId, 85, "comparing with database");

        // 1) Load existing items
        const existingRows = await prisma.masterItem.findMany();
        const dbMap = new Map();

        existingRows.forEach(x => {
            dbMap.set(x.item_code, x);
        });

        // 2) Separate INSERT / UPDATE / SKIP
        const toInsert = [];
        const toUpdate = [];
        let skipped = 0;

        // Debug: Check if specific item_codes are in mapped data
        const debugCodes = [5229, 913];
        const foundInMapped = mapped.filter(item => debugCodes.includes(item.item_code));

        for (const item of mapped) {
            const old = dbMap.get(item.item_code);

            if (!old) {
                toInsert.push(item);
                continue;
            }

            // compare changes
            const changed = Object.keys(item).some(k => item[k] !== old[k]);

            if (!changed) {
                skipped++;
                continue;
            }

            toUpdate.push(item);
        }
        // 3) Bulk Insert
        if (toInsert.length > 0) {
            const cleanedInserts = toInsert.map(r => ({
                item_code: String(r.item_code).trim().padStart(5, "0"),
                item_name: r.item_name != null ? String(r.item_name) : null,
                group_name: r.group_name != null ? String(r.group_name) : null,
                status: r.item_status != null ? String(r.item_status) : null,
                barcode: r.barcode != null ? String(r.barcode) : null,
                brand_name: r.brand_name != null ? String(r.brand_name) : null,
                is_consignment: r.is_consignment != null ? String(r.is_consignment) : null,
                purchase_price: parseFloat(r.purchase_price) || 0,
                selling_price_vat: parseInt(r.selling_price_vat, 10) || 0,
                preferred_vendor_code: r.preferred_vendor_code != null ? String(r.preferred_vendor_code) : null,
                preferred_vendor_name: r.preferred_vendor_name != null ? String(r.preferred_vendor_name) : null,
                gross_profit_pct: r.gross_profit_pct != null ? String(r.gross_profit_pct) : null,
                shelf_life_days: r.shelf_life_days != null ? String(r.shelf_life_days) : null,
                productionDate: r.productionDate != null ? String(r.productionDate) : null,
                vatGroupPu: r.vatGroupPu != null ? String(r.vatGroupPu) : null,
            }));
            try {
                const insertResult = await prisma.masterItem.createMany({
                    data: cleanedInserts,
                    skipDuplicates: true
                });
            } catch (insertErr) {
                console.error('[DEBUG] Insert error:', insertErr);
                throw insertErr;
            }

            const verifyInserts = await prisma.masterItem.findMany({
                where: { item_code: { in: [913, 5229] } },
                select: { item_code: true, item_name: true }
            });
        }

        // 4) Bulk Update (raw SQL for max speed) - BATCHED
        const UPDATE_BATCH_SIZE = 2000;

        if (toUpdate.length > 0) {
            for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH_SIZE) {
                const chunk = toUpdate.slice(i, i + UPDATE_BATCH_SIZE);

                const values = chunk.map((r) => {
                    const item_code = String(r.item_code).trim().padStart(5, "0");
                    const purchase_price = parseFloat(r.purchase_price) || 0;
                    const selling_price_vat = parseInt(r.selling_price_vat, 10) || 0;
                    const gross_profit_pct = r.gross_profit_pct != null ? String(r.gross_profit_pct) : null;
                    const shelf_life_days = r.shelf_life_days != null ? String(r.shelf_life_days) : null;
                    
                    
                    const item_status = r.item_status != null ? String(r.item_status) : null;
                    const barcode = r.barcode != null ? String(r.barcode) : null;
                    const brand_name = r.brand_name != null ? String(r.brand_name) : null;
                    const preferred_vendor_code = r.preferred_vendor_code != null ? String(r.preferred_vendor_code) : null;
                    const preferred_vendor_name = r.preferred_vendor_name != null ? String(r.preferred_vendor_name) : null;
                    const is_consignment = r.is_consignment != null ? String(r.is_consignment) : null;
                    const group_name = r.group_name != null ? String(r.group_name) : null;
                    const item_name = r.item_name != null ? String(r.item_name) : null;

                    return Prisma.sql`(
                        ${item_code},
                        ${purchase_price},
                        ${selling_price_vat},
                        ${gross_profit_pct},
                        ${shelf_life_days},
                        
                        
                        ${item_status},
                        ${barcode},
                        ${brand_name},
                        ${preferred_vendor_code},
                        ${preferred_vendor_name},
                        ${is_consignment},
                        ${group_name},
                        ${item_name}
                    )`;
                }
                );

                const sql = Prisma.sql`
                    UPDATE "MasterItem" AS t SET
                        "purchase_price" = v.purchase,
                        "selling_price_vat" = v.saleprice,
                        "gross_profit_pct" = v.gp,
                        "shelf_life_days" = v.shelf,
                        
                        
                        "item_status" = v.status,
                        "barcode" = v.barcode,
                        "brand_name" = v.brand,
                        "preferred_vendor_code" = v.vendor,
                        "preferred_vendor_name" = v.vendorname,
                        "is_consignment" = v.consign,
                        "group_name" = v.groupname,
                        "item_name" = v.nameproduct
                    FROM (VALUES ${Prisma.join(values)})
                    AS v(
                        item_code, purchase, saleprice, gp, shelf,
                        proddate, vat, status, barcode, brand,
                        vendor, vendorname, consign, groupname, nameproduct
                    )
                    WHERE t."item_code" = v.item_code
                `;

                await prisma.$executeRaw(sql);

                // Update progress
                const progress = 85 + Math.floor((i / toUpdate.length) * 5);
                setUploadJob(jobId, progress, `updating ${Math.min(i + UPDATE_BATCH_SIZE, toUpdate.length)}/${toUpdate.length}`);
            }
        }

        await touchDataSync('masterItem', toInsert.length + toUpdate.length);

        setUploadJob(jobId, 90, "saving data");
        finishUploadJob(jobId, "completed");
        res.status(200).json({
            message: "Master Item XLSX processed successfully (Ultra-Fast)",
            inserted: toInsert.length,
            updated: toUpdate.length,
            skipped
        });

    } catch (err) {
        console.error("XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
