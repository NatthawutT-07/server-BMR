const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

const BATCH_SIZE = 5000;

exports.uploadSI_XLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-si");
    setUploadJob(jobId, 5, "reading file");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        setUploadJob(jobId, 15, "parsing rows");

        // Debug: Log first 3 rows to see actual headers
        // console.log("=== SI XLSX: First 3 rows ===");
        // for (let i = 0; i < Math.min(raw.length, 3); i++) {
        //     console.log(`Row ${i}:`, JSON.stringify(raw[i]));
        // }

        // ----------------------------------------------------
        // 1) Auto-detect header row (flexible matching)
        // ----------------------------------------------------
        const aliases = {
            branchCode: ["รหัสสาขา"],
            branchName: ["ชื่อสาขา"],
            siNo: ["si_no", "si no", "sino"],
            orderDate: ["order_date", "order date", "orderdate"],
            deliveryDate: ["delivery_date", "delivery date", "deliverydate"],
            vendorCode: ["รหัสเวนเดอร์", "รหัสเเวนเดอร์", "รหัสแวนเดอร์", "vendor"],
            vendorName: ["ชื่อเวนเดอร์", "ชื่อเเวนเดอร์", "ชื่อแวนเดอร์"],
            productCode: ["รหัสสินค้า"],
            productName: ["ชื่อสินค้า"],
            barcode: ["บาร์โค้ด", "barcode"],
            itemType: ["ปกติ_ตัวแถม", "ปกติ/ตัวแถม", "ปกติ", "item_type"],
            quantity: ["จำนวนสั่ง", "จำนวน", "quantity", "qty"],
            priceExV: ["ราคาต่อหน่วย_ex_v", "ราคาต่อหน่วย(ex v)", "ราคาต่อหน่วยex", "price_ex"],
            priceInV: ["ราคาต่อหน่วย_in_v", "ราคาต่อหน่วย(in v)", "ราคาต่อหน่วยin", "price_in"],
            amountExV: ["มูลค่า_ex_v", "มูลค่า(ex v)", "มูลค่าex", "amount_ex"],
            amountInV: ["มูลค่า_in_v", "มูลค่า(in v)", "มูลค่าin", "amount_in"],
            vatGroup: ["vat_group", "vat group", "vatgroup", "vat"],
            shippingLocation: ["สถานที่ส่ง", "shipping"],
            terms: ["เงื่อนไข", "terms"],
        };

        const allFields = Object.keys(aliases);
        const normalize = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");

        // ใช้ includes matching — ถ้า header มีคำที่ตรงกับ alias ก็ match
        const matchAlias = (cellText, aliasList) => {
            const norm = normalize(cellText);
            if (!norm) return false;
            return aliasList.some(a => {
                const na = normalize(a);
                return norm === na || norm.includes(na) || na.includes(norm);
            });
        };

        const tryBuildHeader = (row) => {
            const map = {};
            row.forEach((cell, idx) => {
                for (const field of allFields) {
                    if (map[field] === undefined && matchAlias(cell, aliases[field])) {
                        map[field] = idx;
                        break;
                    }
                }
            });
            return map;
        };

        let headerRowIndex = -1;
        let headerMap = null;

        for (let i = 0; i < Math.min(raw.length, 10); i++) {
            const map = tryBuildHeader(raw[i]);
            // ต้องเจออย่างน้อย branchCode หรือ siNo
            const foundCount = allFields.filter(f => map[f] !== undefined).length;
            // console.log(`Row ${i} matched ${foundCount}/${allFields.length} fields:`,
            //     allFields.filter(f => map[f] !== undefined).join(", "));

            if (foundCount >= 3) {
                headerRowIndex = i;
                headerMap = map;
                break;
            }
        }

        if (headerRowIndex === -1 || !headerMap) {
            failUploadJob(jobId, "header not found");
            return res.status(400).send("❌ ไม่พบ header SI — กรุณาตรวจสอบชื่อคอลัมน์ในไฟล์");
        }

        // console.log("=== SI Header found at row", headerRowIndex, "===");
        // console.log("Mapped fields:", JSON.stringify(headerMap));

        // ----------------------------------------------------
        // 2) Helper: Excel serial date → JS Date
        // ----------------------------------------------------
        const excelDateToJS = (value) => {
            if (!value && value !== 0) return new Date();
            if (value instanceof Date) return value;
            if (typeof value === "number") {
                return new Date(Math.round((value - 25569) * 86400 * 1000));
            }
            const str = String(value).trim();
            const parsed = Date.parse(str);
            if (!Number.isNaN(parsed)) return new Date(parsed);
            const parts = str.split("/");
            if (parts.length === 3) {
                const [d, m, y] = parts.map(p => parseInt(p, 10));
                if (!Number.isNaN(d) && !Number.isNaN(m) && !Number.isNaN(y)) {
                    const year = y < 100 ? 2000 + y : y;
                    return new Date(year, m - 1, d);
                }
            }
            return new Date();
        };

        // ----------------------------------------------------
        // 3) Map data rows
        // ----------------------------------------------------
        setUploadJob(jobId, 25, `mapping ${raw.length - headerRowIndex - 1} rows`);

        const get = (row, field) => {
            if (headerMap[field] === undefined) return "";
            return row[headerMap[field]] ?? "";
        };

        const mapped = raw
            .slice(headerRowIndex + 1)
            .map(row => {
                // ข้ามแถวว่าง
                const hasData = row.some(cell => cell !== "" && cell !== null && cell !== undefined);
                if (!hasData) return null;

                const branchCode = String(get(row, "branchCode")).trim();
                if (!branchCode) return null;

                return {
                    branchCode,
                    branchName: String(get(row, "branchName")).trim(),
                    siNo: String(get(row, "siNo")).trim() || "-",
                    orderDate: excelDateToJS(get(row, "orderDate")),
                    deliveryDate: excelDateToJS(get(row, "deliveryDate")),
                    vendorCode: String(get(row, "vendorCode")).trim(),
                    vendorName: String(get(row, "vendorName")).trim(),
                    productCode: String(get(row, "productCode")).trim(),
                    productName: String(get(row, "productName")).trim(),
                    barcode: String(get(row, "barcode")).trim(),
                    itemType: String(get(row, "itemType")).trim(),
                    quantity: parseInt(String(get(row, "quantity")).replace(/,/g, ""), 10) || 0,
                    priceExV: parseFloat(String(get(row, "priceExV")).replace(/,/g, "")) || 0,
                    priceInV: parseFloat(String(get(row, "priceInV")).replace(/,/g, "")) || 0,
                    amountExV: parseFloat(String(get(row, "amountExV")).replace(/,/g, "")) || 0,
                    amountInV: parseFloat(String(get(row, "amountInV")).replace(/,/g, "")) || 0,
                    vatGroup: String(get(row, "vatGroup")).trim(),
                    shippingLocation: String(get(row, "shippingLocation")).trim(),
                    terms: String(get(row, "terms")).trim(),
                };
            })
            .filter(Boolean);

        // console.log(`=== SI: ${mapped.length} valid rows from ${raw.length - headerRowIndex - 1} data rows ===`);

        if (mapped.length === 0) {
            failUploadJob(jobId, "no valid rows");
            return res.status(200).send("No valid SI rows found.");
        }

        // ----------------------------------------------------
        // 4) Insert ใหม่เท่านั้น — ข้ามแถวซ้ำ (unique: branchCode+siNo+productCode+barcode)
        // ----------------------------------------------------
        setUploadJob(jobId, 45, `inserting ${mapped.length} rows (skip duplicates)`);

        let totalInserted = 0;
        const totalBatches = Math.ceil(mapped.length / BATCH_SIZE);

        for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
            const chunk = mapped.slice(i, i + BATCH_SIZE);
            const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

            const result = await prisma.orderSI.createMany({
                data: chunk,
                skipDuplicates: true,
            });
            totalInserted += result.count;

            const progress = 50 + Math.floor((currentBatch / totalBatches) * 40);
            setUploadJob(jobId, progress, `batch ${currentBatch}/${totalBatches} (inserted ${result.count})`);
        }

        const skipped = mapped.length - totalInserted;
        
        // ✅ บันทึกเวลาอัปเดตล่าสุด
        await touchDataSync('si', totalInserted);
        
        setUploadJob(jobId, 95, "finalizing");
        finishUploadJob(jobId, `completed - ${totalInserted} inserted, ${skipped} duplicates skipped`);
        res.status(200).json({
            message: `SI XLSX uploaded successfully!`,
            inserted: totalInserted,
            skipped,
            total: mapped.length,
        });

    } catch (err) {
        console.error("SI XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
