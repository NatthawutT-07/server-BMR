const prisma = require('../../config/prisma');
const XLSX = require("xlsx");

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



// exports.uploadPartnersCSV = async (req, res) => {
//     if (!req.file) return res.status(400).send('No file uploaded');

//     const results = [];

//     // ✅ ใช้ buffer จาก memory แทนการอ่านไฟล์จากดิสก์
//     const bufferStream = new Readable();
//     bufferStream.push(req.file.buffer);
//     bufferStream.push(null);

//     bufferStream
//         .pipe(csv())
//         .on('data', (data) => {
//             // console.log('CSV Row:', data);
//             results.push(data);
//         })
//         .on('error', (err) => {
//             console.error('CSV parse error:', err);
//             return res.status(500).send('Failed to parse CSV file.');
//         })
//         .on('end', async () => {
//             try {
//                 // ลบข้อมูลเก่า
//                 await prisma.partners.deleteMany();

//                 // Mapping ข้อมูลจาก CSV
//                 const partners = results.map(row => ({
//                     codeBP: row.BPCode || null,
//                     nameBP: row.BPName || null,
//                     accountBalance: row.AccountBalance ? parseFloat(row.AccountBalance.replace(/[^0-9.-]+/g, '')) : null,
//                     interfaceADA: row.InterfaceStatusforADASoft || null,
//                     interfaceEDI: row.InterfaceStatusforEDI || null,
//                     brand: row.Brand || null,
//                     paymentTermsCode: row.PaymentTermsCode || null,
//                     noOldBP: row.BPOldNo || null,
//                     taxGroup: row.TaxGroup || null,
//                     remarks: row.Remarks || null,
//                     idNoTwo: row.IDNo2 || null,
//                     gp: row.GP || null,
//                     dc: row.DC || null,
//                     email: row.EMail || null,
//                     phoneOne: row.Telephone1 || null,
//                     phoneTwo: row.Telephone2 || null,
//                     billAddressType: row.BilltoAddressType || null,
//                     billBlock: row.BilltoBlock || null,
//                     billBuildingFloorRoom: row.BilltoBuilding || null,
//                     billCity: row.BilltoCity || null,
//                     billCountry: row.BilltoCountry || null,
//                     billCountryNo: row.BilltoCounty || null,
//                     billZipCode: row.BilltoZipCode || null,
//                     branchBP: row.BPBranch ? parseInt(row.BPBranch.trim(), 10) : null,
//                     billExchangeOnCollection: row.BillofExchangeonCollection || null,
//                     billDefault: row.BilltoDefault || null,
//                     billState: row.BilltoState || null,
//                     billStreet: row.BilltoStreet || null,
//                     billStreetNo: row.BilltoStreetNo || null,
//                     remarkOne: row.Remark || null,
//                     groupCode: row.GroupCode || null,
//                     federalTaxId: row.FederalTaxID || null,
//                 }));

//                 await prisma.partners.createMany({
//                     data: partners,
//                     skipDuplicates: true,
//                 });

//                 res.status(200).send('CSV uploaded and data saved to DB ✅');
//             } catch (err) {
//                 console.error('Database error:', err);
//                 res.status(500).json({ error: err.message });
//             }
//         });
// };

exports.uploadItemMinMaxXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        // อ่านทุกแถว
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        // ---------------------------
        // 1) Detect header
        // ---------------------------
        const headerRowIndex = raw.findIndex(row =>
            row.includes("BranchCode") &&
            row.includes("ItemCode") &&
            row.includes("MinStock") &&
            row.includes("MaxStock")
        );

        if (headerRowIndex === -1) {
            return res.status(400).send("❌ Header Format Incorrect");
        }

        const header = raw[headerRowIndex];
        const dataRows = raw.slice(headerRowIndex + 1);

        // ---------------------------
        // 2) Convert rows → objects
        // ---------------------------
        const mapped = dataRows.map(r => {
            let obj = {};
            header.forEach((h, i) => obj[h] = r[i]);

            const rawCode = obj.BranchCode?.trim();
            const item = obj.ItemCode;

            if (!rawCode || !item) return null;

            const prefix = rawCode.slice(0, 2);
            const num = parseInt(rawCode.slice(2), 10);
            if (isNaN(num)) return null;

            const branchCode = prefix + num.toString().padStart(3, "0");
            const codeProduct = parseInt(item, 10);
            if (isNaN(codeProduct)) return null;

            let min = parseInt(obj.MinStock, 10);
            let max = parseInt(obj.MaxStock, 10);
            if (isNaN(min)) min = null;
            if (isNaN(max)) max = null;

            return {
                branchCode,
                codeProduct,
                minStore: min,
                maxStore: max
            };
        }).filter(v => v !== null);

        // ---------------------------
        // 3) Load all existing rows (only 1 query)
        // ---------------------------
        const existingRows = await prisma.itemMinMax.findMany();
        const dbMap = new Map();

        existingRows.forEach(x => {
            dbMap.set(x.branchCode + "|" + x.codeProduct, x);
        });

        // ---------------------------
        // 4) Separate INSERT + UPDATE
        // ---------------------------
        const toInsert = [];
        const toUpdate = [];

        for (const row of mapped) {
            const key = row.branchCode + "|" + row.codeProduct;
            const old = dbMap.get(key);

            if (!old) {
                toInsert.push(row);
                continue;
            }

            if (
                old.minStore !== row.minStore ||
                old.maxStore !== row.maxStore
            ) {
                toUpdate.push(row);
            }
        }

        // ---------------------------
        // 5) Batch Insert (fast)
        // ---------------------------
        if (toInsert.length > 0) {
            await prisma.itemMinMax.createMany({
                data: toInsert,
                skipDuplicates: true
            });
        }

        // ---------------------------
        // 6) Batch Update (Super Fast)
        // Prisma ไม่มี updateMany แบบหลายเงื่อนไข → ใช้ raw SQL
        // ---------------------------
        if (toUpdate.length > 0) {
            const values = toUpdate.map(r =>
                `('${r.branchCode}', ${r.codeProduct}, ${r.minStore === null ? "NULL" : r.minStore}, ${r.maxStore === null ? "NULL" : r.maxStore})`
            ).join(",");

            const sql = `
                UPDATE "ItemMinMax" AS t SET
                    "minStore" = v.minStore,
                    "maxStore" = v.maxStore
                FROM (VALUES ${values})
                AS v(branchCode, codeProduct, minStore, maxStore)
                WHERE 
                    t."branchCode" = v.branchCode
                    AND t."codeProduct" = v.codeProduct
            `;

            await prisma.$executeRawUnsafe(sql);
        }

        return res.status(200).json({
            message: "Item MinMax imported successfully",
            inserted: toInsert.length,
            updated: toUpdate.length,
            skipped: mapped.length - (toInsert.length + toUpdate.length)
        });

    } catch (err) {
        console.error("XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.uploadStationXLSX = async (req, res) => {
    return res.status(501).json({ message: "Station upload not implemented yet" });
};

exports.uploadMasterItemXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        //------------------------------------------
        // 1) หา header
        //------------------------------------------
        const headerRowIndex = raw.findIndex(row =>
            row.includes("Item No.") &&
            row.includes("Item Description") &&
            row.includes("Sales Price (Inc. VAT)")
        );

        if (headerRowIndex === -1) {
            return res.status(400).send("❌ ไม่พบ header master item");
        }

        const header = raw[headerRowIndex];
        const dataRows = raw.slice(headerRowIndex + 1);

        //------------------------------------------
        // 2) Matrix → JSON using header
        //------------------------------------------
        const rows = dataRows.map(r => {
            let obj = {};
            header.forEach((h, i) => obj[h] = r[i]);
            return obj;
        });

        //------------------------------------------
        // 3) Clean
        //------------------------------------------
        const cleaned = rows.filter(r =>
            r["Item No."] && !isNaN(r["Item No."])
        );

        //------------------------------------------
        // 4) Map into Prisma format
        //------------------------------------------
        const mapped = cleaned.map(row => ({
            codeProduct: parseInt(row["Item No."], 10),

            nameProduct: row["Item Description"] || null,
            groupName: row["Group Name"] || null,
            status: row["Status"] || null,

            barcode: row["Bar Code"] || null,
            nameBrand: row["Name"] || null,

            consingItem: row["Consign Item"] || null,

            purchasePriceExcVAT: row["Purchase Price (Exc. VAT)"]
                ? parseFloat(row["Purchase Price (Exc. VAT)"])
                : 0,

            salesPriceIncVAT: row["Sales Price (Inc. VAT)"]
                ? parseFloat(row["Sales Price (Inc. VAT)"])
                : 0,

            preferredVandorCode: row["Preferred Vendor"] || null,
            preferredVandorName: row["Preferred Vendor Name"] || null,

            GP: row["GP %"] != null && row["GP %"] !== "" ? String(row["GP %"]) : null,
            shelfLife: row["Shelf Life (Days)"] != null && row["Shelf Life (Days)"] !== "" ? String(row["Shelf Life (Days)"]) : null,

            productionDate: row["Production Date"] || null,
            vatGroupPu: row["VatGroupPu"] || null
        }));

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

        for (const item of mapped) {
            const old = dbMap.get(item.codeProduct);

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

        //------------------------------------------
        // 7) Bulk Insert
        //------------------------------------------
        if (toInsert.length > 0) {
            await prisma.listOfItemHold.createMany({
                data: toInsert,
                skipDuplicates: true
            });
        }

        //------------------------------------------
        // 8) Bulk Update (raw SQL for max speed)
        //------------------------------------------
        if (toUpdate.length > 0) {
            const values = toUpdate.map(r =>
                `(${r.codeProduct}, 
                 ${r.purchasePriceExcVAT ?? "NULL"}, 
                 ${r.salesPriceIncVAT ?? "NULL"}, 
                 ${r.GP ? `'${r.GP}'` : "NULL"},
                 ${r.shelfLife ? `'${r.shelfLife}'` : "NULL"},
                 ${r.productionDate ? `'${r.productionDate}'` : "NULL"},
                 ${r.vatGroupPu ? `'${r.vatGroupPu}'` : "NULL"},
                 ${r.status ? `'${r.status}'` : "NULL"},
                 ${r.barcode ? `'${r.barcode}'` : "NULL"},
                 ${r.nameBrand ? `'${r.nameBrand}'` : "NULL"},
                 ${r.preferredVandorCode ? `'${r.preferredVandorCode}'` : "NULL"},
                 ${r.preferredVandorName ? `'${r.preferredVandorName}'` : "NULL"},
                 ${r.consingItem ? `'${r.consingItem}'` : "NULL"},
                 ${r.groupName ? `'${r.groupName}'` : "NULL"},
                 ${r.nameProduct ? `'${r.nameProduct}'` : "NULL"}
                )`
            ).join(",");

            const sql = `
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
                FROM (VALUES ${values})
                AS v(
                    codeProduct, purchase, saleprice, gp, shelf,
                    proddate, vat, status, barcode, brand,
                    vendor, vendorname, consign, groupname, nameproduct
                )
                WHERE t."codeProduct" = v.codeProduct
            `;

            await prisma.$executeRawUnsafe(sql);
        }

        //------------------------------------------
        // Done
        //------------------------------------------
        res.status(200).json({
            message: "Master Item XLSX processed successfully (Ultra-Fast)",
            inserted: toInsert.length,
            updated: toUpdate.length,
            skipped
        });

    } catch (err) {
        console.error("XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.uploadSalesDayXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        // หา header
        const headerRowIndex = raw.findIndex(row =>
            row.includes("รหัสสินค้า") &&
            row.includes("รหัสสาขา") &&
            row.includes("ช่องทางการขาย") &&
            row.includes("จำนวน")
        );

        if (headerRowIndex === -1) {
            return res.status(400).send("❌ ไม่พบ header ของ sales day");
        }

        const header = raw[headerRowIndex];
        const dataRows = raw.slice(headerRowIndex + 1);

        // matrix → JSON
        const rows = dataRows.map(r => {
            let obj = {};
            header.forEach((h, i) => obj[h] = r[i]);
            return obj;
        });

        // clean + mapping
        const mapped = rows
            .filter(row => row["รหัสสินค้า"] && !isNaN(row["รหัสสินค้า"]) && row["รหัสสาขา"])
            .map(row => ({
                branchCode: row["รหัสสาขา"].trim(),
                codeProduct: parseInt(row["รหัสสินค้า"], 10),
                channelSales: row["ช่องทางการขาย"]?.toString().trim() || null,
                quantity: parseFloat(row["จำนวน"]) || 0,
                discount: parseFloat(row["ส่วนลด"]) || 0,
                totalPrice: parseFloat(row["ยอดขายรวม"]) || 0
            }));

        if (mapped.length === 0) {
            return res.status(200).send("No valid sales records found.");
        }

        // --------------------------------------------------------
        // STEP 1: รวมข้อมูลซ้ำในไฟล์ (aggregate)
        // --------------------------------------------------------
        const agg = {};

        mapped.forEach(r => {
            const key = `${r.branchCode}|${r.codeProduct}|${r.channelSales || ""}`;

            if (!agg[key]) {
                agg[key] = { ...r };
            } else {
                agg[key].quantity += r.quantity;
                agg[key].discount += r.discount;
                agg[key].totalPrice += r.totalPrice;
            }
        });

        const finalData = Object.values(agg);

        // --------------------------------------------------------
        // STEP 2: ลบข้อมูลเก่าทั้งหมด
        // --------------------------------------------------------
        await prisma.$executeRawUnsafe(`DELETE FROM "SalesDay"`);

        // --------------------------------------------------------
        // STEP 3: Insert ใหม่แบบ batch เร็วมาก
        // --------------------------------------------------------
        const valuesSql = finalData
            .map(r =>
                `('${r.branchCode}',
                  ${r.channelSales ? `'${r.channelSales.replace(/'/g, "''")}'` : 'NULL'},
                  ${r.codeProduct},
                  ${r.quantity},
                  ${r.discount},
                  ${r.totalPrice}
                )`
            )
            .join(",");

        const sql = `
            INSERT INTO "SalesDay"
                ("branchCode", "channelSales", "codeProduct", "quantity", "discount", "totalPrice")
            VALUES ${valuesSql}
        `;

        await prisma.$executeRawUnsafe(sql);

        await touchDataSync("sales-day", finalData.length);

        return res.status(200).json({
            message: "SalesDay imported successfully",
            inserted: finalData.length
        });

    } catch (err) {
        console.error("XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.uploadStockXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        const headerRowIndex = raw.findIndex(
            (row) =>
                row.includes("รหัสสินค้า") &&
                row.includes("รหัสสาขา") &&
                row.includes("จำนวนคงเหลือ")
        );
        if (headerRowIndex === -1) {
            return res.status(400).send("❌ ไม่พบ header ของ Stock XLSX");
        }

        const header = raw[headerRowIndex];
        const dataRows = raw.slice(headerRowIndex + 1);

        const rows = dataRows.map((r) => {
            let obj = {};
            header.forEach((h, i) => (obj[h] = r[i]));
            return obj;
        });

        const INT32_MAX = 2147483647;
        const INT32_MIN = -2147483648;

        const mapped = rows
            .filter((row) => {
                const code = row["รหัสสินค้า"];
                const branch = row["รหัสสาขา"];
                if (!code || isNaN(code)) return false;
                if (!branch) return false;
                return true;
            })
            .map((row) => {
                const codeProduct = parseInt(row["รหัสสินค้า"], 10);

                let branchCode = (row["รหัสสาขา"] || "").trim();
                branchCode = branchCode.replace(/'/g, "''"); // กัน SQL แตก

                let qty = parseFloat(row["จำนวนคงเหลือ"]);
                if (isNaN(qty)) qty = 0;
                if (qty > INT32_MAX || qty < INT32_MIN) qty = 0;
                qty = Math.floor(qty);

                // ✅ qty = 0 ข้ามทันที
                if (qty === 0) return null;

                return `(${codeProduct}, '${branchCode}', ${qty})`;
            })
            .filter(Boolean);

        if (mapped.length === 0) {
            return res.status(200).send("No valid stock rows found (all qty = 0 or invalid).");
        }

        await prisma.$transaction(async (tx) => {
            // ล้างข้อมูลเดิม
            await tx.$executeRawUnsafe(`TRUNCATE TABLE "Stock"`);

            // insert ใหม่
            const insertSql = `
        INSERT INTO "Stock" ("codeProduct", "branchCode", "quantity")
        VALUES ${mapped.join(",")}
      `;
            await tx.$executeRawUnsafe(insertSql);

            // ✅ บันทึกเวลาอัปเดตล่าสุด (แค่ 1 แถว)
            const syncSql = `
        INSERT INTO "DataSync" ("key", "updatedAt", "rowCount")
        VALUES ('stock', NOW(), ${mapped.length})
        ON CONFLICT ("key")
        DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt",
                      "rowCount"  = EXCLUDED."rowCount"
      `;
            await tx.$executeRawUnsafe(syncSql);
        });

        return res.status(200).json({
            message: "Stock XLSX imported successfully (Ultra-Fast)",
            inserted: mapped.length,
        });
    } catch (err) {
        console.error("XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};


// exports.uploadWithdrawXLSX = async (req, res) => {
//     if (!req.file) return res.status(400).send("No file uploaded");

//     try {
//         const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
//         const sheet = workbook.Sheets[workbook.SheetNames[0]];
//         const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

//         // ------------------------------------------------------------
//         // 1) หาแถว Header
//         // ------------------------------------------------------------
//         const headerRowIndex = raw.findIndex(row =>
//             row.includes("รหัสสินค้า") &&
//             row.includes("เลขที่เอกสาร") &&
//             row.includes("จำนวน") &&
//             row.includes("สาขา")
//         );

//         if (headerRowIndex === -1) {
//             return res.status(400).send("❌ ไม่พบหัวตาราง withdraw");
//         }

//         const header = raw[headerRowIndex];
//         const dataRows = raw.slice(headerRowIndex + 1);

//         // ------------------------------------------------------------
//         // 2) แปลง Matrix → JSON
//         // ------------------------------------------------------------
//         const rows = dataRows.map(r => {
//             let obj = {};
//             header.forEach((h, i) => obj[h] = r[i]);
//             return obj;
//         });

//         // ------------------------------------------------------------
//         // 3) Clean + Mapping
//         // ------------------------------------------------------------
//         const mapped = rows
//             .filter(row =>
//                 row["รหัสสินค้า"] &&
//                 !isNaN(row["รหัสสินค้า"]) &&
//                 row["สาขา"]
//             )
//             .map(row => {
//                 const codeProduct = parseInt(row["รหัสสินค้า"], 10);
//                 if (!codeProduct) return null;

//                 // สกัดรหัสสาขาแบบ (ST024) The Nine → ST024
//                 let branchCode = row["สาขา"]
//                     ?.split(")")[0]
//                     ?.replace("(", "")
//                     ?.trim();
//                 if (!branchCode) return null;

//                 let qty = parseFloat(row["จำนวน"]);
//                 if (isNaN(qty)) qty = 0;

//                 let val = parseFloat(row["มูลค่าเบิกออก"]);
//                 if (isNaN(val)) val = 0;

//                 // escape single quotes
//                 const esc = (str) =>
//                     str ? `'${str.replace(/'/g, "''")}'` : "NULL";

//                 return `
//                     (${codeProduct},
//                     '${branchCode}',
//                     ${esc(row["เลขที่เอกสาร"])},
//                     ${esc(row["วันที่"])},
//                     ${esc(row["สถานะเอกสาร"])},
//                     ${esc(row["เหตุผล"])},
//                     ${qty},
//                     ${val})
//                 `;
//             })
//             .filter(v => v !== null);

//         if (mapped.length === 0) {
//             return res.status(200).send("No valid withdraw rows found.");
//         }

//         // ------------------------------------------------------------
//         // 4) Clear Table (ต้องล้างก่อน insert)
//         // ------------------------------------------------------------
//         await prisma.$executeRawUnsafe(`DELETE FROM "withdraw"`);

//         // ------------------------------------------------------------
//         // 5) Build Ultra-Fast Bulk Insert
//         // ------------------------------------------------------------
//         const sql = `
//             INSERT INTO "withdraw"
//             ("codeProduct", "branchCode", "docNumber", "date", "docStatus", "reason", "quantity", "value")
//             VALUES ${mapped.join(",")}
//         `;

//         await prisma.$executeRawUnsafe(sql);

//         return res.status(200).json({
//             message: "withdraw XLSX imported (Ultra-Fast)",
//             inserted: mapped.length
//         });

//     } catch (err) {
//         console.error("XLSX Error:", err);
//         res.status(500).json({ error: err.message });
//     }
// };


exports.uploadWithdrawXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        // ------------------------------------------------------------
        // 1) หาแถว Header
        // ------------------------------------------------------------
        const headerRowIndex = raw.findIndex(row =>
            row.includes("รหัสสินค้า") &&
            row.includes("เลขที่เอกสาร") &&
            row.includes("จำนวน") &&
            row.includes("สาขา")
        );

        if (headerRowIndex === -1) {
            return res.status(400).send("❌ ไม่พบหัวตาราง withdraw");
        }

        const header = raw[headerRowIndex];
        const dataRows = raw.slice(headerRowIndex + 1);

        // ------------------------------------------------------------
        // 2) แปลง Matrix → JSON
        // ------------------------------------------------------------
        const rows = dataRows.map(r => {
            let obj = {};
            header.forEach((h, i) => obj[h] = r[i]);
            return obj;
        });

        // ------------------------------------------------------------
        // 3) Clean + Mapping
        // ------------------------------------------------------------
        const mapped = rows
            .filter(row =>
                row["รหัสสินค้า"] &&
                !isNaN(row["รหัสสินค้า"]) &&
                row["สาขา"]
            )
            .map(row => {
                const codeProduct = parseInt(row["รหัสสินค้า"], 10);
                if (!codeProduct) return null;

                // สกัดรหัสสาขาแบบ (ST024) The Nine → ST024
                let branchCode = row["สาขา"]
                    ?.split(")")[0]
                    ?.replace("(", "")
                    ?.trim();
                if (!branchCode) return null;

                let qty = parseFloat(row["จำนวน"]);
                if (isNaN(qty)) qty = 0;

                let val = parseFloat(row["มูลค่าเบิกออก"]);
                if (isNaN(val)) val = 0;

                // escape single quotes
                const esc = (str) =>
                    str ? `'${str.replace(/'/g, "''")}'` : "NULL";

                return `
                    (${codeProduct},
                    '${branchCode}',
                    ${esc(row["เลขที่เอกสาร"])},
                    ${esc(row["วันที่"])},
                    ${esc(row["สถานะเอกสาร"])},
                    ${esc(row["เหตุผล"])},
                    ${qty},
                    ${val})
                `;
            })
            .filter(v => v !== null);

        if (mapped.length === 0) {
            return res.status(200).send("No valid withdraw rows found.");
        }

        // ------------------------------------------------------------
        // 4) Clear Table (ต้องล้างก่อน insert)
        // ------------------------------------------------------------
        await prisma.$executeRawUnsafe(`DELETE FROM "withdraw"`);

        // ------------------------------------------------------------
        // 5) Build Ultra-Fast Bulk Insert
        // ------------------------------------------------------------
        const sql = `
            INSERT INTO "withdraw"
            ("codeProduct", "branchCode", "docNumber", "date", "docStatus", "reason", "quantity", "value")
            VALUES ${mapped.join(",")}
        `;

        await prisma.$executeRawUnsafe(sql);

        return res.status(200).json({
            message: "withdraw XLSX imported (Ultra-Fast)",
            inserted: mapped.length
        });

    } catch (err) {
        console.error("XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.uploadTemplateXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

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
        res.status(200).send("Template XLSX uploaded & synced successfully!");

    } catch (err) {
        console.error("Template XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.uploadGourmetXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        const requiredFields = ["date", "branch_code", "product_code", "quantity", "sales"];
        const aliases = {
            date: ["date", "วันที่"],
            branch_code: ["branch_code", "branchcode", "branch code", "สาขา", "รหัสสาขา"],
            product_code: ["product_code", "productcode", "product code", "รหัสสินค้า", "sku"],
            quantity: ["quantity", "qty", "จำนวน"],
            sales: ["sales", "ยอดขาย", "ยอดขายรวม", "net sales", "ยอดขายสุทธิ"],
        };

        const normalize = (v) => String(v || "").trim().toLowerCase();

        const tryBuildHeader = (row) => {
            const map = {};
            row.forEach((cell, idx) => {
                const key = normalize(cell);
                for (const field of requiredFields) {
                    if (aliases[field].includes(key) && map[field] === undefined) {
                        map[field] = idx;
                        break;
                    }
                }
            });
            return map;
        };

        let headerRowIndex = -1;
        let headerMap = null;

        for (let i = 0; i < raw.length; i++) {
            const map = tryBuildHeader(raw[i]);
            if (requiredFields.every((f) => map[f] !== undefined)) {
                headerRowIndex = i;
                headerMap = map;
                break;
            }
        }

        if (headerRowIndex === -1 || !headerMap) {
            return res.status(400).send("❌ ไม่พบ header gourmet (date, branch, product, quantity, sales)");
        }

        const excelDateToJS = (value) => {
            if (!value) return null;
            if (value instanceof Date) return value;
            if (typeof value === "number") {
                return new Date(Math.round((value - 25569) * 86400 * 1000));
            }
            const str = String(value).trim();
            const parsed = Date.parse(str);
            if (!Number.isNaN(parsed)) return new Date(parsed);
            const parts = str.split("/");
            if (parts.length === 3) {
                const [d, m, y] = parts.map((p) => parseInt(p, 10));
                if (!Number.isNaN(d) && !Number.isNaN(m) && !Number.isNaN(y)) {
                    const year = y < 100 ? 2000 + y : y;
                    return new Date(year, m - 1, d);
                }
            }
            return null;
        };

        const mapped = raw
            .slice(headerRowIndex + 1)
            .map((row) => {
                const branchCode = String(row[headerMap.branch_code] || "").trim();
                const productCode = String(row[headerMap.product_code] || "").trim();
                const dateVal = excelDateToJS(row[headerMap.date]);

                if (!branchCode || !productCode || !dateVal) return null;

                let quantity = parseInt(String(row[headerMap.quantity]).replace(/,/g, ""), 10);
                if (Number.isNaN(quantity)) quantity = 0;

                const salesRaw = String(row[headerMap.sales]).replace(/,/g, "");
                let sales = parseFloat(salesRaw);
                if (Number.isNaN(sales)) sales = 0;

                return {
                    date: dateVal,
                    branch_code: branchCode,
                    product_code: productCode,
                    quantity,
                    sales,
                };
            })
            .filter(Boolean);

        if (mapped.length === 0) {
            return res.status(200).send("No valid gourmet rows found.");
        }

        await prisma.$transaction([
            prisma.gourmet.deleteMany(),
            prisma.gourmet.createMany({ data: mapped }),
        ]);

        return res.status(200).json({
            message: "Gourmet XLSX imported successfully",
            inserted: mapped.length,
        });
    } catch (err) {
        console.error("Gourmet XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};


exports.uploadSKU_XLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        // อ่าน JSON จาก header
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        // ----------------------------------------------------
        // 1) Clean / Validate แถว (ต้องมีทุก field)
        // ----------------------------------------------------
        const validRows = rows.filter(r =>
            r.id &&
            r.branchCode &&
            r.shelfCode &&
            r.rowNo &&
            r.codeProduct
        );

        // ----------------------------------------------------
        // 2) Mapping dataset
        // ----------------------------------------------------
        const skuData = validRows.map(row => ({
            id: parseInt(row.id, 10),
            branchCode: row.branchCode.trim(),
            shelfCode: row.shelfCode.trim(),
            rowNo: parseInt(row.rowNo, 10),
            codeProduct: parseInt(row.codeProduct, 10),
            index: row.index ? parseInt(row.index, 10) : 0,
        }));

        // ----------------------------------------------------
        // 3) ลบข้อมูลเก่าที่ไม่อยู่ในไฟล์ XLSX
        // ----------------------------------------------------
        await prisma.sku.deleteMany({
            where: {
                NOT: {
                    OR: skuData.map(item => ({ id: item.id }))
                }
            }
        });

        // ----------------------------------------------------
        // 4) ดึงข้อมูลเก่าใน DB เพื่อตรวจ diff
        // ----------------------------------------------------
        const existingItems = await prisma.sku.findMany({
            where: {
                OR: skuData.map(item => ({ id: item.id }))
            }
        });

        const existingMap = new Map();
        existingItems.forEach(item => existingMap.set(item.id, item));

        const createData = [];
        const updatePromises = [];

        // ----------------------------------------------------
        // 5) แยก insert / update
        // ----------------------------------------------------
        for (const item of skuData) {
            const old = existingMap.get(item.id);

            if (!old) {
                createData.push(item);
                continue;
            }

            const changed =
                old.branchCode !== item.branchCode ||
                old.shelfCode !== item.shelfCode ||
                old.rowNo !== item.rowNo ||
                old.codeProduct !== item.codeProduct ||
                old.index !== item.index;

            if (changed) {
                updatePromises.push(
                    prisma.sku.update({
                        where: { id: item.id },
                        data: item,
                    })
                );
            }
        }

        // ----------------------------------------------------
        // 6) Insert ใหม่แบบ batch
        // ----------------------------------------------------
        if (createData.length > 0) {
            await prisma.sku.createMany({
                data: createData,
            });
        }

        // ----------------------------------------------------
        // 7) Update แบบ batch
        // ----------------------------------------------------
        if (updatePromises.length > 0) {
            await Promise.all(updatePromises);
        }

        res.status(200).send("SKU XLSX uploaded & synced successfully!");

    } catch (err) {
        console.error("SKU XLSX Error:", err);
        res.status(500).json({ error: err.message });
    }
};
// controllers/admin/uploadBillXLSX.js
// =======================
// Helpers
// =======================
const EPS = 1e-9;
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const addMinutes = (dateObj, minutes) => {
    if (!dateObj) return null;
    const ms = Number(minutes || 0) * 60 * 1000;
    return new Date(dateObj.getTime() + ms);
};

function parseDateBangkok(input) {
    if (!input) return null;

    const [datePart, timePartRaw] = String(input).trim().split(" ");
    const [day, month, year] = datePart.split("/").map(Number);

    const timePart = timePartRaw || "00:00:00";
    const [hour = 0, minute = 0, second = 0] = timePart
        .split(":")
        .map((v) => Number(v));

    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    const hh = String(hour).padStart(2, "0");
    const mi = String(minute).padStart(2, "0");
    const ss = String(second).padStart(2, "0");

    // ✅ บังคับ offset ไทย +07:00
    return new Date(`${year}-${mm}-${dd}T${hh}:${mi}:${ss}+07:00`);
}

function parseCodeName(str) {
    if (!str) return { code: null, name: null };
    const match = String(str).match(/\((.*?)\)(.*)/);
    if (match) return { code: match[1], name: match[2].trim() };
    return { code: null, name: String(str).trim() };
}

function parseProduct(str) {
    if (!str) return { brand: null, name: null };
    const s = String(str).trim();
    if (!s.includes(":")) return { brand: null, name: s };
    const [brand, ...rest] = s.split(":");
    return { brand: brand.trim(), name: rest.join(":").trim() };
}

function parseFloatWithComma(v) {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/,/g, "").trim();
    if (s === "") return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

const isItemLine = (r) => {
    const code = String(r.product_code || "").trim();
    const qty = parseFloatWithComma(r.quantity);
    return code !== "" && Math.abs(qty) > EPS; // ✅ qty ต้อง != 0
};

const hasPaymentInfo = (r) => {
    const fields = ["total_payment", "payment_method", "bank", "reference_number"];
    return fields.some((f) => {
        const v = r?.[f];
        return v !== undefined && v !== null && String(v).trim() !== "";
    });
};

// ✅ normalize string สำหรับกัน NULL หลุด unique
const normPaymentMethod = (v) => {
    const s = String(v ?? "").trim();
    return s ? s : "Unknown";
};
const normBank = (v) => {
    const s = String(v ?? "").trim();
    return s ? s : "";
};
const normRef = (v) => {
    const s = String(v ?? "").trim();
    return s ? s : "";
};

/**
 * ✅ รองรับ “หลายการชำระเงินต่อบิล” แบบไม่ดับเบิ้ล
 * FIX หลัก:
 * - ถ้า group มีหลายแถว ให้ข้าม header (index 0) เพราะ header ถูก copy payment จาก footer แล้ว
 * - ดึง payment เฉพาะแถวที่ไม่ใช่ item line
 * - dedup แบบฉลาด:
 *    - ถ้า key เดิม & amount เท่ากัน = duplicate -> ignore
 *    - ถ้า key เดิม & amount ต่างกัน = split payment จริง -> รวม amount
 */
function pickPaymentRows(group) {
    if (!Array.isArray(group) || group.length === 0) return [];

    const startIdx = group.length > 1 ? 1 : 0; // ✅ ข้าม header ถ้ามีหลายแถว

    const raw = group
        .slice(startIdx)
        .filter((r) => hasPaymentInfo(r) && !isItemLine(r))
        .map((r) => ({
            amount: round2(parseFloatWithComma(r.total_payment)),
            payment_method: String(r.payment_method || "").trim() || null,
            bank: String(r.bank || "").trim() || null,
            reference_number: String(r.reference_number || "").trim() || null,
        }))
        .filter((p) => Math.abs(p.amount) > EPS);

    // map: key -> { amount, seenAmounts:Set<number>, ... }
    const map = new Map();

    for (const p of raw) {
        const k = `${p.payment_method || ""}|${p.bank || ""}|${p.reference_number || ""}`;

        const existed = map.get(k);
        if (!existed) {
            map.set(k, {
                amount: p.amount,
                payment_method: p.payment_method,
                bank: p.bank,
                reference_number: p.reference_number,
                _seen: new Set([p.amount]),
            });
            continue;
        }

        // ✅ ถ้า amount ซ้ำเดิมเป๊ะ ๆ = duplicate จากการ copy header/footer → ข้าม
        if (existed._seen.has(p.amount)) continue;

        // ✅ ถ้าเป็น split payment จริง (amount ต่างกัน) → รวม
        existed.amount = round2(existed.amount + p.amount);
        existed._seen.add(p.amount);
    }

    return Array.from(map.values()).map(({ _seen, ...rest }) => rest);
}

// header ไทย → key อังกฤษ
const headerMap = {
    "รหัสสาขา": "branch_code",
    "สาขา": "branch_name",
    "วันที่": "date",
    "เลขที่บิล": "bill_number",
    "อ้างอิงเอกสาร": "reference_doc",
    "ประเภทเอกสาร": "doc_type",
    "ประเภทเครื่องจุดขาย": "pos_type",
    "ช่องทางการขาย": "sales_channel",
    "ลูกค้า": "customer",
    "รหัสสินค้า": "product_code",
    "ชื่อสินค้า": "product_name",
    "จำนวน": "quantity",
    "หน่วย": "unit",
    "ราคา/หน่วย": "price_per_unit",
    "ยอดขาย": "sales_amount",
    "ส่วนลด": "discount",
    "มูลค่าแยกภาษี": "value_excl_tax",
    "ภาษีมูลค่าเพิ่ม": "vat",
    "ลดท้ายบิล": "end_bill_discount",
    "มูลค่ารวมหลังลดท้ายบิล": "total_after_discount",
    "ยอดปัดเศษ": "rounding",
    "ยอดขายสุทธิ": "net_sales",
    "ยอดขายรวม": "total_sales",
    "ยอดชำระรวม": "total_payment",
    "ชำระโดย": "payment_method",
    "ธนาคาร": "bank",
    "หมายเลขอ้างอิง": "reference_number",
};

// =======================
// removeMatchedSalesPairs
// =======================
function removeMatchedSalesPairs(rows) {
    const groupMap = new Map();
    const idsToRemove = new Set();

    for (const row of rows) {
        if (row.doc_type !== "เอกสารขาย") continue;
        if (!isItemLine(row)) continue;

        const key = `${row.bill_number || ""}|${row.product_code || ""}`;
        let group = groupMap.get(key);
        if (!group) groupMap.set(key, (group = []));

        row._qty = round2(parseFloatWithComma(row.quantity));
        row._discountNum = round2(parseFloatWithComma(row.discount));
        row._netSalesNum = round2(parseFloatWithComma(row.net_sales));

        if (Math.abs(row._qty) <= EPS) continue;
        group.push(row);
    }

    for (const group of groupMap.values()) {
        const negMap = new Map();

        for (const r of group) {
            if (r._qty < -EPS) {
                const key = `${r._qty}|${r._netSalesNum}`;
                const list = negMap.get(key) || [];
                list.push(r);
                negMap.set(key, list);
            }
        }

        for (const r of group) {
            if (r._qty <= EPS) continue; // ✅ +qty ต้อง > 0
            if (idsToRemove.has(r._tempId)) continue;

            const keyOpp = `${-r._qty}|${-r._netSalesNum}`;
            const list = negMap.get(keyOpp);
            if (!list || list.length === 0) continue;

            let matchedIndex = -1;
            for (let i = 0; i < list.length; i++) {
                const cand = list[i];
                if (idsToRemove.has(cand._tempId)) continue;

                if (round2(r._discountNum + cand._discountNum) === 0) {
                    matchedIndex = i;
                    break;
                }
            }

            if (matchedIndex !== -1) {
                const [target] = list.splice(matchedIndex, 1);
                idsToRemove.add(r._tempId);
                idsToRemove.add(target._tempId);
            }
        }
    }

    const cleaned = rows.filter((r) => !idsToRemove.has(r._tempId));
    console.log(`🧹 Removed matched sales pairs = ${idsToRemove.size} rows`);
    return cleaned;
}

// =======================
// mergeBillHeaderFooter (เวอร์ชัน “ไม่ทิ้ง payment rows”)
// - หา footer สุดท้ายที่มี payment info แล้ว copy ลง header
// - แต่ “ไม่ลบ” แถว payment ออก (เพื่อรองรับหลาย payment)
// =======================
function mergeBillHeaderFooter(rows) {
    const byBill = new Map();
    const noBill = [];

    for (const row of rows) {
        if (!row.bill_number) {
            noBill.push(row);
            continue;
        }
        let group = byBill.get(row.bill_number);
        if (!group) byBill.set(row.bill_number, (group = []));
        group.push(row);
    }

    const result = [];

    for (const [, group] of byBill.entries()) {
        if (group.length === 1) {
            result.push(group[0]);
            continue;
        }

        const paymentFields = [
            "total_payment",
            "payment_method",
            "bank",
            "reference_number",
        ];

        let footerIndex = -1;
        for (let i = group.length - 1; i >= 0; i--) {
            if (hasPaymentInfo(group[i])) {
                footerIndex = i;
                break;
            }
        }

        const headerIndex = 0;
        const header = { ...group[headerIndex] };

        if (footerIndex !== -1 && footerIndex !== headerIndex) {
            const footer = group[footerIndex];
            for (const f of paymentFields) {
                const v = footer?.[f];
                if (v !== undefined && v !== null && String(v).trim() !== "") {
                    header[f] = v;
                }
            }
        }

        // ใส่ header (ที่รวมแล้ว)
        result.push(header);

        // ใส่แถวอื่น ๆ (รวม footer/payment rows ด้วย)
        for (let i = 1; i < group.length; i++) {
            result.push(group[i]);
        }
    }

    return [...result, ...noBill];
}

// =======================
// Controller หลัก
// =======================
exports.uploadBillXLSX = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
        // 1) อ่าน XLSX
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        console.log("📘 Raw rows =", rows.length);

        // 2) ตัดแถวบน/ล่าง
        rows = rows.slice(2, rows.length - 3);
        if (rows.length < 2) {
            return res.status(400).json({ error: "ไม่พบข้อมูลหลังตัดแถวบน/ล่าง" });
        }

        // 3) header ไทย → key อังกฤษ
        const thHeader = rows[0];
        const enHeader = thHeader.map((h) => headerMap[h] || h);

        // 4) แปลงเป็น object
        let results = rows.slice(1).map((r, index) => {
            const obj = {};
            enHeader.forEach((key, i) => {
                obj[key] = r[i] ?? "";
            });
            obj._tempId = index + 1;
            return obj;
        });

        console.log("📗 Parsed rows =", results.length);

        // 5) remove matched (+qty ↔ -qty)
        results = removeMatchedSalesPairs(results);

        // 6) merge header/footer (ไม่ทิ้ง payment rows)
        results = mergeBillHeaderFooter(results);
        console.log("📙 After merge header/footer rows =", results.length);

        // 7) group ตาม bill_number
        const billGroups = new Map();
        const noBillRows = [];
        for (const row of results) {
            const bn = String(row.bill_number || "").trim();
            if (!bn) {
                noBillRows.push(row);
                continue;
            }
            let g = billGroups.get(bn);
            if (!g) billGroups.set(bn, (g = []));
            g.push(row);
        }

        // 8) กันบิลซ้ำ
        const existingBills = await prisma.bill.findMany({
            select: { bill_number: true },
        });
        const existingBillSet = new Set(existingBills.map((b) => b.bill_number));

        // 9) โหลด maps ปัจจุบัน
        const [branchesInDb, channelsInDb, productsInDb, customersInDb] =
            await Promise.all([
                prisma.branch.findMany(),
                prisma.salesChannel.findMany(),
                prisma.product.findMany(),
                prisma.customer.findMany({ select: { id: true, customer_code: true } }),
            ]);

        const branchIdMap = Object.fromEntries(
            branchesInDb.map((b) => [b.branch_code, b.id])
        );
        const channelIdMap = Object.fromEntries(
            channelsInDb.map((c) => [c.channel_code, c.id])
        );
        const productIdMap = Object.fromEntries(
            productsInDb.map((p) => [`${p.product_code}|${p.product_brand}`, p.id])
        );
        const customerIdMap = Object.fromEntries(
            customersInDb.map((c) => [c.customer_code, c.id])
        );

        // 10) เตรียมชุดสร้างใหม่
        const newBranches = new Map(); // code -> name
        const newChannels = new Map(); // code -> name
        const newProducts = new Map(); // productKey -> {product_code, product_name, product_brand}

        const createdCustomerList = []; // { customer_code, customer_name, id }
        const createdProductKeyList = []; // key list ของที่สร้างใหม่จริง ๆ

        // scan หา branch/channel/product ใหม่
        for (const [billNo, group] of billGroups.entries()) {
            if (existingBillSet.has(billNo)) continue;

            const meta = group[0];

            // BRANCH
            if (
                meta.branch_code &&
                !branchIdMap[meta.branch_code] &&
                !newBranches.has(meta.branch_code)
            ) {
                newBranches.set(meta.branch_code, meta.branch_name || "unknown");
            }

            // CHANNEL
            const { code: cCode, name: cName } = parseCodeName(meta.sales_channel);
            if (cCode && !channelIdMap[cCode] && !newChannels.has(cCode)) {
                newChannels.set(cCode, cName || "unknown");
            }

            // PRODUCTS
            for (const row of group) {
                if (!isItemLine(row)) continue;
                if (!row.product_code) continue;

                const { brand, name: productNameOnly } = parseProduct(row.product_name);

                const productCodeClean = String(row.product_code || "unknown")
                    .replace(/\.0$/, "")
                    .trim();
                const brandClean = (brand || "unknown").trim() || "unknown";
                const productKey = `${productCodeClean}|${brandClean}`;

                if (!productIdMap[productKey] && !newProducts.has(productKey)) {
                    newProducts.set(productKey, {
                        product_code: productCodeClean,
                        product_name: productNameOnly || "unknown",
                        product_brand: brandClean,
                    });
                    createdProductKeyList.push(productKey);
                }
            }
        }

        // 11) Create branch/channel/product ก่อน
        await prisma.$transaction(
            [
                newBranches.size > 0
                    ? prisma.branch.createMany({
                        data: [...newBranches].map(([code, name]) => ({
                            branch_code: code,
                            branch_name: name,
                        })),
                        skipDuplicates: true,
                    })
                    : null,

                newChannels.size > 0
                    ? prisma.salesChannel.createMany({
                        data: [...newChannels].map(([code, name]) => ({
                            channel_code: code,
                            channel_name: name,
                        })),
                        skipDuplicates: true,
                    })
                    : null,

                newProducts.size > 0
                    ? prisma.product.createMany({
                        data: [...newProducts.values()],
                        skipDuplicates: true,
                    })
                    : null,
            ].filter(Boolean)
        );

        // 12) refresh maps หลังสร้าง
        const [branchesAll, channelsAll, productsAll] = await Promise.all([
            prisma.branch.findMany(),
            prisma.salesChannel.findMany(),
            prisma.product.findMany(),
        ]);

        const branchIdMapAll = Object.fromEntries(
            branchesAll.map((b) => [b.branch_code, b.id])
        );
        const channelIdMapAll = Object.fromEntries(
            channelsAll.map((c) => [c.channel_code, c.id])
        );
        const productIdMapAll = Object.fromEntries(
            productsAll.map((p) => [`${p.product_code}|${p.product_brand}`, p.id])
        );

        const createdProductList = createdProductKeyList
            .map((k) => {
                const v = newProducts.get(k);
                return {
                    product_key: k,
                    product_code: v?.product_code,
                    product_brand: v?.product_brand,
                    product_name: v?.product_name,
                    id: productIdMapAll[k] || null,
                };
            })
            .filter((x) => x.id != null);

        // 13) สร้าง Bills + BillItems + BillPayments
        const newBills = [];
        const pendingBillItems = [];
        const pendingBillPayments = []; // { bill_number, amount, payment_method, bank, reference_number }

        for (const [billNo, group] of billGroups.entries()) {
            if (existingBillSet.has(billNo)) continue;

            const meta = group[0];

            // ✅ เวลาไทย +07:00 แล้วบวก +60 นาทีทุกบิล
            const billDate = addMinutes(parseDateBangkok(meta.date), 60);

            // ✅ CUSTOMER
            const { code: custCode, name: custName } = parseCodeName(meta.customer);
            let customerId = null;

            if (custCode) {
                const existedBefore = !!customerIdMap[custCode];

                const cust = await prisma.customer.upsert({
                    where: { customer_code: custCode },
                    update: { customer_name: custName || "unknown" },
                    create: { customer_code: custCode, customer_name: custName || "unknown" },
                    select: { id: true },
                });

                customerId = cust.id;
                customerIdMap[custCode] = cust.id;

                if (!existedBefore) {
                    createdCustomerList.push({
                        customer_code: custCode,
                        customer_name: custName || "unknown",
                        id: cust.id,
                    });
                }
            }

            // CHANNEL
            const { code: cCode } = parseCodeName(meta.sales_channel);

            // ✅ payments หลายรายการ (FIX ไม่ให้ดับเบิ้ล)
            const paymentList = pickPaymentRows(group);

            // ✅ total_payment ใน Bill = sum(paymentList) ถ้ามี, ไม่งั้นใช้ meta.total_payment
            const totalPaymentFromLines = round2(
                paymentList.reduce((s, p) => s + Number(p.amount || 0), 0)
            );
            const totalPaymentMeta = round2(parseFloatWithComma(meta.total_payment));
            const totalPayment = totalPaymentFromLines > 0 ? totalPaymentFromLines : totalPaymentMeta;

            newBills.push({
                bill_number: billNo,
                date: billDate,
                branchId: meta.branch_code ? branchIdMapAll[meta.branch_code] || null : null,
                salesChannelId: cCode ? channelIdMapAll[cCode] || null : null,
                customerId,
                doc_type: meta.doc_type || null,
                pos_type: meta.pos_type || null,
                reference_doc: meta.reference_doc || null,

                value_excl_tax: parseFloatWithComma(meta.value_excl_tax),
                vat: parseFloatWithComma(meta.vat),
                end_bill_discount: parseFloatWithComma(meta.end_bill_discount),
                total_after_discount: parseFloatWithComma(meta.total_after_discount),
                rounding: parseFloatWithComma(meta.rounding),
                total_sales: parseFloatWithComma(meta.total_sales),
                total_payment: totalPayment,
            });

            // เก็บ BillPayment
            if (paymentList.length > 0) {
                for (const p of paymentList) {
                    pendingBillPayments.push({
                        bill_number: billNo,
                        amount: p.amount,
                        payment_method: p.payment_method,
                        bank: p.bank,
                        reference_number: p.reference_number,
                    });
                }
            } else {
                // fallback: ถ้าไม่มีแถว payment แต่มี total_payment > 0 ก็เก็บ 1 แถวไว้
                if (Math.abs(totalPaymentMeta) > EPS) {
                    pendingBillPayments.push({
                        bill_number: billNo,
                        amount: totalPaymentMeta,
                        payment_method: String(meta.payment_method || "").trim() || null,
                        bank: String(meta.bank || "").trim() || null,
                        reference_number: String(meta.reference_number || "").trim() || null,
                    });
                }
            }

            // BILL ITEMS
            for (const row of group) {
                if (!isItemLine(row)) continue;
                if (!row.product_code) continue;

                const { brand } = parseProduct(row.product_name);
                const productCodeClean = String(row.product_code || "unknown")
                    .replace(/\.0$/, "")
                    .trim();
                const brandClean = (brand || "unknown").trim() || "unknown";
                const productKey = `${productCodeClean}|${brandClean}`;

                pendingBillItems.push({
                    bill_number: billNo,
                    product_key: productKey,
                    quantity: parseFloatWithComma(row.quantity),
                    unit: row.unit || null,
                    price_per_unit: parseFloatWithComma(row.price_per_unit),
                    sales_amount: parseFloatWithComma(row.sales_amount),
                    discount: parseFloatWithComma(row.discount),
                    net_sales: parseFloatWithComma(row.net_sales),
                });
            }
        }

        // 14) Insert Bills
        if (newBills.length > 0) {
            await prisma.bill.createMany({
                data: newBills,
                skipDuplicates: true,
            });
        }

        // 15) Map billId
        const billsAll = await prisma.bill.findMany({
            select: { id: true, bill_number: true },
        });
        const billIdMapAll = Object.fromEntries(
            billsAll.map((b) => [b.bill_number, b.id])
        );

        // 16) Insert BillItems
        const billItemsToInsert = pendingBillItems
            .filter((i) => billIdMapAll[i.bill_number] && productIdMapAll[i.product_key])
            .map((i) => ({
                billId: billIdMapAll[i.bill_number],
                productId: productIdMapAll[i.product_key],
                quantity: i.quantity,
                unit: i.unit,
                price_per_unit: i.price_per_unit,
                sales_amount: i.sales_amount,
                discount: i.discount,
                net_sales: i.net_sales,
            }));

        if (billItemsToInsert.length > 0) {
            await prisma.billItem.createMany({
                data: billItemsToInsert,
            });
        }

        // 17) ✅ Insert BillPayments (normalize NULL -> string กันซ้ำหลุด unique)
        const billPaymentsToInsert = pendingBillPayments
            .filter((p) => billIdMapAll[p.bill_number])
            .map((p) => ({
                billId: billIdMapAll[p.bill_number],
                amount: round2(p.amount),
                payment_method: normPaymentMethod(p.payment_method), // ✅ ไม่ใช้ null
                bank: normBank(p.bank), // ✅ ไม่ใช้ null
                reference_number: normRef(p.reference_number), // ✅ ไม่ใช้ null
            }));

        let bill_payments_created = 0;
        if (billPaymentsToInsert.length > 0) {
            const created = await prisma.billPayment.createMany({
                data: billPaymentsToInsert,
                skipDuplicates: true, // ✅ ใช้ @@unique([billId, amount, payment_method, bank, reference_number])
            });
            bill_payments_created = created?.count ?? 0;
        }

        await touchDataSync("dashboard", newBills.length);

        return res.json({
            message:
                "✅ Import สำเร็จ (FIX: payment ไม่บันทึกซ้ำ 2 เท่า + normalize payment fields กัน NULL หลุด unique)",
            raw_rows: rows.length,
            parsed_rows: results.length,
            bills_created: newBills.length,
            bill_items_created: billItemsToInsert.length,
            bill_payments_created,
            no_bill_rows: noBillRows.length,
            created_products: createdProductList,
            created_customers: createdCustomerList,
        });
    } catch (err) {
        console.error("❌ Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
