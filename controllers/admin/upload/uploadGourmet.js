const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

exports.uploadGourmetXLSX = async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded");

    const jobId = initUploadJob(req, "upload-gourmets");
    setUploadJob(jobId, 5, "reading file");

    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        setUploadJob(jobId, 20, "parsing rows");

        const requiredFields = ["date", "branch_code", "item_code", "quantity_sale_gourmet", "sales_amount_gourmet"];
        const aliases = {
            date: ["date", ""],
            branch_code: ["storecodesap"],
            item_code: ["itemno.bm"],
            quantity_sale_gourmet: ["saleqty"],
            sales_amount_gourmet: ["salesamount"],
        };

        // เอาช่องว่างเเละ _ ออก
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
            failUploadJob(jobId, "ไม่พบ header gourmet (date, branchMain, product, quantity_sale_gourmet, sales)");
            return res.status(400).send("ไม่พบ header gourmet (date, branchMain, product, quantity_sale_gourmet, sales)");
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
            let branch_code = String(row[headerMap.branch_code] || "").trim();
            if (branch_code.startsWith("ST0")) {
                branch_code = branch_code.replace("ST0", "ST");
            }
            const productCode = String(row[headerMap.item_code] || "").trim();
            const dateVal = excelDateToJS(row[headerMap.date]);

            if (!branch_code || !productCode || !dateVal) return;

            let quantity_sale_gourmet = parseInt(String(row[headerMap.quantity_sale_gourmet]).replace(/,/g, ""), 10);
            if (Number.isNaN(quantity_sale_gourmet)) quantity_sale_gourmet = 0;

            const salesRawGourmet = String(row[headerMap.sales_amount_gourmet]).replace(/,/g, "");
            let sales_amount_gourmet = parseFloat(salesRawGourmet);
            if (Number.isNaN(sales_amount_gourmet)) sales_amount_gourmet = 0;

            // Date processing to standard string for unique key
            const yyyy = dateVal.getUTCFullYear();
            const mm = String(dateVal.getUTCMonth() + 1).padStart(2, "0");
            const dd = String(dateVal.getUTCDate()).padStart(2, "0");
            const dateStr = `${yyyy}-${mm}-${dd}`;

            const key = `${dateStr}_${branch_code}_${productCode}_${quantity_sale_gourmet}`;
            if (!seen.has(key)) {
                seen.add(key);
                mapped.push({
                    date: dateVal,
                    branch_code: branch_code,
                    item_code: productCode,
                    quantity_sale_gourmet,
                    sales_amount_gourmet,
                });
            }
        });

        if (mapped.length === 0) {
            finishUploadJob(jobId, "No valid gourmet rows found.");
            return res.status(200).send("No valid gourmet rows found.");
        }

        setUploadJob(jobId, 70, "saving data");

        const result = await prisma.gourmet.createMany({
            data: mapped,
            skipDuplicates: true
        });

        await touchDataSync('gourmet', result.count);

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
