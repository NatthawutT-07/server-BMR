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

        setUploadJob(jobId, 70, "saving data");
        await prisma.$transaction([
            prisma.gourmet.deleteMany(),
            prisma.gourmet.createMany({ data: mapped }),
        ]);

        finishUploadJob(jobId, "completed");
        return res.status(200).json({
            message: "Gourmet XLSX imported successfully",
            inserted: mapped.length,
        });
    } catch (err) {
        console.error("Gourmet XLSX Error:", err);
        failUploadJob(jobId, err?.message || "failed");
        res.status(500).json({ error: err.message });
    }
};
