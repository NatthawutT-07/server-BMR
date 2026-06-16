const { parentPort, workerData } = require("worker_threads");
const XLSX = require("xlsx");

const parseItemMinMax = (raw) => {
    const normalizeHeader = (value) =>
        String(value || "").trim().toLowerCase().replace(/[\s_]/g, "");
    const requiredHeaders = ["branchcode", "itemcode", "minstock", "maxstock", "packorder"];

    const headerRowIndex = raw.findIndex(row => {
        const headers = new Set(row.map(normalizeHeader));
        return requiredHeaders.every(header => headers.has(header));
    });

    if (headerRowIndex === -1) {
        return {
            error: "Header Format Incorrect: required BranchCode, ItemCode, MinStock, MaxStock, PackOrder"
        };
    }

    const header = raw[headerRowIndex].map(normalizeHeader);
    const dataRows = raw.slice(headerRowIndex + 1);

    const mapped = dataRows.map(r => {
        const obj = {};
        header.forEach((h, i) => obj[h] = r[i]);

        const rawCode = String(obj.branchcode || "").trim().toUpperCase();
        const item = obj.itemcode;

        if (!rawCode || !item) return null;

        const branchMatch = rawCode.match(/^([A-Z]+)0*(\d+)$/);
        if (!branchMatch) return null;

        const branch_code = `${branchMatch[1]}${branchMatch[2].padStart(3, "0")}`;
        const item_code = String(item).trim().padStart(5, "0");
        if (!item_code || item_code === "00000" || item_code.includes("NaN")) return null;

        const min = parseInt(obj.minstock, 10);
        const max = parseInt(obj.maxstock, 10);
        if (isNaN(min) || isNaN(max)) return null;

        let pack_order = parseInt(obj.packorder, 10);
        if (isNaN(pack_order)) pack_order = null;

        return { branch_code, item_code, min_stock: min, max_stock: max, pack_order };
    }).filter(v => v !== null);

    return { data: mapped };
};

const parseMasterItem = (raw) => {
    const headerRowIndex = raw.findIndex(row =>
        row.includes("Item No.") &&
        row.includes("Item Description") &&
        row.includes("Sales Price (Inc. VAT)")
    );

    if (headerRowIndex === -1) {
        return { error: "ไม่พบ header master item" };
    }

    const header = raw[headerRowIndex];
    const dataRows = raw.slice(headerRowIndex + 1);

    const rows = dataRows.map(r => {
        let obj = {};
        header.forEach((h, i) => obj[h] = r[i]);
        return obj;
    });

    const cleaned = rows.filter(r => {
        const itemNo = r["Item No."];
        if (!itemNo) return false;
        const parsed = parseInt(String(itemNo).trim(), 10);
        return !isNaN(parsed) && parsed > 0;
    });

    const mapped = cleaned.map(row => {
        const itemNo = String(row["Item No."]).trim().padStart(5, "0");
        return {
            item_code: itemNo,
            item_name: row["Item Description"] || null,
            group_name: row["Group Name"] || null,
            item_status: row["Status"] || null,
            barcode: row["Bar Code"] || null,
            brand_name: row["Name"] || null,
            is_consignment: row["Consign Item"] || null,
            purchase_price: row["Purchase Price (Exc. VAT)"]
                ? parseFloat(row["Purchase Price (Exc. VAT)"])
                : 0,
            selling_price_vat: row["Sales Price (Inc. VAT)"]
                ? parseFloat(row["Sales Price (Inc. VAT)"])
                : 0,
            preferred_vendor_code: row["Preferred Vendor"] || null,
            preferred_vendor_name: row["Preferred Vendor Name"] || null,
            gross_profit_pct: row["GP %"] != null && row["GP %"] !== "" ? String(row["GP %"]) : null,
            shelf_life_days: row["Shelf Life (Days)"] != null && row["Shelf Life (Days)"] !== "" ? String(row["Shelf Life (Days)"]) : null
        };
    });

    return { data: mapped };
};

const parseStock = (raw) => {
    const headers = {
        itemCode: "\u0e23\u0e2b\u0e31\u0e2a\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
        branchCode: "\u0e23\u0e2b\u0e31\u0e2a\u0e2a\u0e32\u0e02\u0e32",
        quantity: "\u0e08\u0e33\u0e19\u0e27\u0e19\u0e04\u0e07\u0e40\u0e2b\u0e25\u0e37\u0e2d",
    };
    const requiredHeaders = Object.values(headers);
    const normalizeHeader = value => String(value || "").trim();

    const headerRowIndex = raw.findIndex(row => {
        const rowHeaders = new Set(row.map(normalizeHeader));
        return requiredHeaders.every(header => rowHeaders.has(header));
    });

    if (headerRowIndex === -1) {
        return { error: "Stock header format is incorrect" };
    }

    const header = raw[headerRowIndex].map(normalizeHeader);
    const dataRows = raw.slice(headerRowIndex + 1);

    const INT32_MAX = 2147483647;
    const INT32_MIN = -2147483648;
    const parseNumber = value => {
        const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const mapped = dataRows
        .map(row => {
            const obj = {};
            header.forEach((key, index) => {
                obj[key] = row[index];
            });

            const rawCode = String(obj[headers.itemCode] || "").trim();
            const item_code = rawCode.padStart(5, "0");
            const branch_code = String(obj[headers.branchCode] || "").trim().toUpperCase();
            if (!item_code || item_code === "00000" || item_code.includes("NaN") || !branch_code) return null;

            let quantity_stock = Math.trunc(parseNumber(obj[headers.quantity]));
            if (quantity_stock > INT32_MAX || quantity_stock < INT32_MIN) quantity_stock = 0;

            return { item_code, branch_code, quantity_stock };
        })
        .filter(Boolean);

    return { data: mapped };
};

const parseWithdraw = (raw) => {
    const headers = {
        itemCode: "\u0e23\u0e2b\u0e31\u0e2a\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32",
        branch: "\u0e2a\u0e32\u0e02\u0e32",
        documentReference: "\u0e40\u0e25\u0e02\u0e17\u0e35\u0e48\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23",
        date: "\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48",
        documentStatus: "\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23",
        reason: "\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25",
        quantity: "\u0e08\u0e33\u0e19\u0e27\u0e19",
        value: "\u0e21\u0e39\u0e25\u0e04\u0e48\u0e32\u0e40\u0e1a\u0e34\u0e01\u0e2d\u0e2d\u0e01",
    };
    const requiredHeaders = Object.values(headers);
    const normalizeHeader = value => String(value || "").trim();

    const headerRowIndex = raw.findIndex(row => {
        const rowHeaders = new Set(row.map(normalizeHeader));
        return requiredHeaders.every(header => rowHeaders.has(header));
    });

    if (headerRowIndex === -1) {
        return { error: "Withdraw header format is incorrect" };
    }

    const header = raw[headerRowIndex].map(normalizeHeader);
    const dataRows = raw.slice(headerRowIndex + 1);

    const parseNumber = value => {
        const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const mapped = dataRows
        .map(row => {
            const obj = {};
            header.forEach((key, index) => {
                obj[key] = row[index];
            });

            const rawCode = String(obj[headers.itemCode] || "").trim();
            const item_code = rawCode.padStart(5, "0");
            if (!item_code || item_code === "00000" || item_code.includes("NaN")) return null;

            const branchValue = String(obj[headers.branch] || "").trim();
            const branchMatch = branchValue.match(/^\(([^)]+)\)/);
            const branch_code = branchMatch?.[1]?.trim() || null;
            const document_reference = String(obj[headers.documentReference] || "").trim();
            const date_withdraw = String(obj[headers.date] || "").trim();
            if (!branch_code || !document_reference || !date_withdraw) return null;

            return {
                item_code,
                branch_code,
                document_reference,
                date_withdraw,
                document_status: String(obj[headers.documentStatus] || "").trim(),
                reason: String(obj[headers.reason] || "").trim(),
                quantity_withdraw: Math.trunc(parseNumber(obj[headers.quantity])),
                value_withdraw: parseNumber(obj[headers.value]),
            };
        })
        .filter(Boolean);

    return { data: mapped };
};

try {
    const { buffer, type } = workerData;
    parentPort.postMessage({ type: "progress", progress: 10, message: "reading file" });

    const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    parentPort.postMessage({ type: "progress", progress: 40, message: "parsing rows" });

    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    parentPort.postMessage({ type: "progress", progress: 60, message: "processing data" });

    let result;
    switch (type) {
        case "minmax":
            result = parseItemMinMax(raw);
            break;
        case "masterItem":
            result = parseMasterItem(raw);
            break;
        case "stock":
            result = parseStock(raw);
            break;
        case "withdraw":
            result = parseWithdraw(raw);
            break;
        default:
            result = { error: `Unknown type: ${type}` };
    }

    parentPort.postMessage({ type: "progress", progress: 80, message: "finalizing" });

    if (result.error) {
        parentPort.postMessage({ type: "error", error: result.error });
    } else {
        parentPort.postMessage({ type: "result", data: result.data });
    }

} catch (err) {
    parentPort.postMessage({ type: "error", error: err.message || "Worker error" });
}
