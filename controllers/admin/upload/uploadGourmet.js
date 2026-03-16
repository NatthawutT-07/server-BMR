const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob } = require('./uploadJob');

exports.uploadGourmetXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-gourmets");
    setUploadJob(jobId, 5, "reading file");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        setUploadJob(jobId, 20, "parsing rows");

        const requiredFields = ["date", "branch_code", "product_code", "quantity", "sales"];
        const aliases = {
            date: ["date", "วันที่"],
            branch_code: ["branchcode", "รหัสสาขา", "สาขา"],
            product_code: ["productcode", "รหัสสินค้า", "sku"],
            quantity: ["quantity", "qty", "จำนวน", "saleqty"],
            sales: ["sales", "ยอดขาย", "ยอดขายรวม", "netsales", "salesamount", "ยอดขายสุทธิ"],
        };

        // เอาช่องว่างเเละ _ ออกให้หมด เพื่อให้ match กับคำเช่น "Sale_QTY" ได้ตรงกับ "saleqty"
        const normalize = (v) => String(v || "").trim().toLowerCase().replace(/[\s_]/g, "");

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

        for (let i = 0; i < raw.length && i < 20; i++) {
            const map = tryBuildHeader(raw[i]);
            if (requiredFields.every((f) => map[f] !== undefined)) {
                headerRowIndex = i;
                headerMap = map;
                break;
            }
        }

        if (headerRowIndex === -1 || !headerMap) {
            failUploadJob(jobId, "ไม่พบ header gourmet (date, branch, product, quantity, sales)");
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
                    return new Date(Date.UTC(year, m - 1, d));
                }
            }
            return null;
        };

        const mapped = [];
        const seen = new Set();

        raw.slice(headerRowIndex + 1).forEach((row) => {
            const branchCode = String(row[headerMap.branch_code] || "").trim();
            const productCode = String(row[headerMap.product_code] || "").trim();
            const dateVal = excelDateToJS(row[headerMap.date]);

            if (!branchCode || !productCode || !dateVal) return;

            let quantity = parseInt(String(row[headerMap.quantity]).replace(/,/g, ""), 10);
            if (Number.isNaN(quantity)) quantity = 0;

            const salesRaw = String(row[headerMap.sales]).replace(/,/g, "");
            let sales = parseFloat(salesRaw);
            if (Number.isNaN(sales)) sales = 0;

            // Date processing to standard string for unique key
            const yyyy = dateVal.getUTCFullYear();
            const mm = String(dateVal.getUTCMonth() + 1).padStart(2, "0");
            const dd = String(dateVal.getUTCDate()).padStart(2, "0");
            const dateStr = `${yyyy}-${mm}-${dd}`;

            const key = `${dateStr}_${branchCode}_${productCode}_${quantity}`;
            if (!seen.has(key)) {
                seen.add(key);
                mapped.push({
                    date: dateVal,
                    branch_code: branchCode,
                    product_code: productCode,
                    quantity,
                    sales,
                });
            }
        });

        if (mapped.length === 0) {
            finishUploadJob(jobId, "No valid gourmet rows found.");
            return res.status(200).send("No valid gourmet rows found.");
        }

        setUploadJob(jobId, 70, "saving data");

        // Use createMany with skipDuplicates to ignore existing rows with same unique constraints
        const result = await prisma.gourmet.createMany({
            data: mapped,
            skipDuplicates: true
        });

        finishUploadJob(jobId, "completed");
        return res.status(200).json({
            message: "Gourmet XLSX imported successfully",
            inserted: result.count,
        });
    } catch (err) {
        console.error("Gourmet XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
