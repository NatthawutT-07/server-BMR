const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const { runExcelWorker } = require("../../../workers/workerHelper");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob } = require('./uploadJob');

// ✅ ใช้ Worker Thread สำหรับ Parse Excel (ไม่ Block Event Loop)
exports.uploadMasterItemXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-masterItem");
    setUploadJob(jobId, 5, "starting worker");

    try {
        // ✅ ใช้ Worker Thread parse Excel (Non-blocking)
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

        //------------------------------------------
        // 5) Load existing items (1 query only)
        //------------------------------------------

        const existingRows = await prisma.listOfItemHold.findMany();
        const dbMap = new Map();

        existingRows.forEach(x => {
            dbMap.set(x.codeProduct, x);
        });

        //------------------------------------------
        // 6) Separate INSERT / UPDATE / SKIP
        //------------------------------------------
        const toInsert = [];
        const toUpdate = [];
        let skipped = 0;

        // Debug: Check if specific codeProducts are in mapped data
        const debugCodes = [5229, 913];
        const foundInMapped = mapped.filter(item => debugCodes.includes(item.codeProduct));
        console.log(`[DEBUG] Looking for codes ${debugCodes.join(', ')} in mapped data:`, foundInMapped.length > 0 ? foundInMapped.map(i => i.codeProduct) : 'NONE FOUND');
        console.log(`[DEBUG] Total mapped items: ${mapped.length}`);
        console.log(`[DEBUG] Existing DB items: ${dbMap.size}`);

        for (const item of mapped) {
            const old = dbMap.get(item.codeProduct);

            if (!old) {
                toInsert.push(item);
                // Debug specific codes
                if (debugCodes.includes(item.codeProduct)) {
                    console.log(`[DEBUG] Code ${item.codeProduct} → TO INSERT (not in DB)`);
                }
                continue;
            }

            // compare changes
            const changed = Object.keys(item).some(k => item[k] !== old[k]);

            if (!changed) {
                skipped++;
                if (debugCodes.includes(item.codeProduct)) {
                    console.log(`[DEBUG] Code ${item.codeProduct} → SKIPPED (no changes)`);
                }
                continue;
            }

            toUpdate.push(item);
            if (debugCodes.includes(item.codeProduct)) {
                console.log(`[DEBUG] Code ${item.codeProduct} → TO UPDATE`);
            }
        }

        console.log(`[DEBUG] Summary: toInsert=${toInsert.length}, toUpdate=${toUpdate.length}, skipped=${skipped}`);

        //------------------------------------------
        // 7) Bulk Insert - with type conversion
        //------------------------------------------
        if (toInsert.length > 0) {
            const cleanedInserts = toInsert.map(r => ({
                codeProduct: parseInt(r.codeProduct, 10),
                nameProduct: r.nameProduct != null ? String(r.nameProduct) : null,
                groupName: r.groupName != null ? String(r.groupName) : null,
                status: r.status != null ? String(r.status) : null,
                barcode: r.barcode != null ? String(r.barcode) : null,
                nameBrand: r.nameBrand != null ? String(r.nameBrand) : null,
                consingItem: r.consingItem != null ? String(r.consingItem) : null,
                purchasePriceExcVAT: parseFloat(r.purchasePriceExcVAT) || 0,
                salesPriceIncVAT: parseInt(r.salesPriceIncVAT, 10) || 0,
                preferredVandorCode: r.preferredVandorCode != null ? String(r.preferredVandorCode) : null,
                preferredVandorName: r.preferredVandorName != null ? String(r.preferredVandorName) : null,
                GP: r.GP != null ? String(r.GP) : null,
                shelfLife: r.shelfLife != null ? String(r.shelfLife) : null,
                productionDate: r.productionDate != null ? String(r.productionDate) : null,
                vatGroupPu: r.vatGroupPu != null ? String(r.vatGroupPu) : null,
            }));

            // Debug: Log what we're about to insert
            console.log('[DEBUG] Inserting items:', cleanedInserts.map(i => i.codeProduct));

            try {
                const insertResult = await prisma.listOfItemHold.createMany({
                    data: cleanedInserts,
                    skipDuplicates: true
                });
                console.log('[DEBUG] Insert result:', insertResult);
            } catch (insertErr) {
                console.error('[DEBUG] Insert error:', insertErr);
                throw insertErr;
            }

            // Verify insert worked for debug codes
            const verifyInserts = await prisma.listOfItemHold.findMany({
                where: { codeProduct: { in: [913, 5229] } },
                select: { codeProduct: true, nameProduct: true }
            });
            console.log('[DEBUG] Verification - found in DB after insert:', verifyInserts);
        }

        //------------------------------------------
        // 8) Bulk Update (raw SQL for max speed) - BATCHED
        //------------------------------------------
        const UPDATE_BATCH_SIZE = 2000; // ~15 columns × 2000 = 30000 variables (under 32767 limit)

        if (toUpdate.length > 0) {
            for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH_SIZE) {
                const chunk = toUpdate.slice(i, i + UPDATE_BATCH_SIZE);

                const values = chunk.map((r) => {
                    // Force consistent types for all fields
                    const codeProduct = parseInt(r.codeProduct, 10);
                    const purchasePriceExcVAT = parseFloat(r.purchasePriceExcVAT) || 0;
                    const salesPriceIncVAT = parseInt(r.salesPriceIncVAT, 10) || 0;
                    const GP = r.GP != null ? String(r.GP) : null;
                    const shelfLife = r.shelfLife != null ? String(r.shelfLife) : null;
                    const productionDate = r.productionDate != null ? String(r.productionDate) : null;
                    const vatGroupPu = r.vatGroupPu != null ? String(r.vatGroupPu) : null;
                    const status = r.status != null ? String(r.status) : null;
                    const barcode = r.barcode != null ? String(r.barcode) : null;
                    const nameBrand = r.nameBrand != null ? String(r.nameBrand) : null;
                    const preferredVandorCode = r.preferredVandorCode != null ? String(r.preferredVandorCode) : null;
                    const preferredVandorName = r.preferredVandorName != null ? String(r.preferredVandorName) : null;
                    const consingItem = r.consingItem != null ? String(r.consingItem) : null;
                    const groupName = r.groupName != null ? String(r.groupName) : null;
                    const nameProduct = r.nameProduct != null ? String(r.nameProduct) : null;

                    return Prisma.sql`(
                        ${codeProduct},
                        ${purchasePriceExcVAT},
                        ${salesPriceIncVAT},
                        ${GP},
                        ${shelfLife},
                        ${productionDate},
                        ${vatGroupPu},
                        ${status},
                        ${barcode},
                        ${nameBrand},
                        ${preferredVandorCode},
                        ${preferredVandorName},
                        ${consingItem},
                        ${groupName},
                        ${nameProduct}
                    )`;
                }
                );

                const sql = Prisma.sql`
                    UPDATE "ListOfItemHold" AS t SET
                        "purchasePriceExcVAT" = v.purchase,
                        "salesPriceIncVAT" = v.saleprice,
                        "GP" = v.gp,
                        "shelfLife" = v.shelf,
                        "productionDate" = v.proddate,
                        "vatGroupPu" = v.vat,
                        "status" = v.status,
                        "barcode" = v.barcode,
                        "nameBrand" = v.brand,
                        "preferredVandorCode" = v.vendor,
                        "preferredVandorName" = v.vendorname,
                        "consingItem" = v.consign,
                        "groupName" = v.groupname,
                        "nameProduct" = v.nameproduct
                    FROM (VALUES ${Prisma.join(values)})
                    AS v(
                        codeProduct, purchase, saleprice, gp, shelf,
                        proddate, vat, status, barcode, brand,
                        vendor, vendorname, consign, groupname, nameproduct
                    )
                    WHERE t."codeProduct" = v.codeProduct::int
                `;

                await prisma.$executeRaw(sql);

                // Update progress
                const progress = 85 + Math.floor((i / toUpdate.length) * 5);
                setUploadJob(jobId, progress, `updating ${Math.min(i + UPDATE_BATCH_SIZE, toUpdate.length)}/${toUpdate.length}`);
            }
        }

        //------------------------------------------
        // Done
        //------------------------------------------
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
