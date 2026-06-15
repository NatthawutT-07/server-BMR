const { parentPort, workerData } = require("worker_threads");
const XLSX = require("xlsx");

const parseItemMinMax = (raw) => {
    const headerRowIndex = raw.findIndex(row =>
        row.includes("branch_code") &&
        row.includes("ItemCode") &&
        row.includes("MinStock") &&
        row.includes("MaxStock")
    );

    if (headerRowIndex === -1) {
        return { error: "Header Format Incorrect (ItemMinMax)" };
    }

    const header = raw[headerRowIndex];
    const dataRows = raw.slice(headerRowIndex + 1);

    const mapped = dataRows.map(r => {
        let obj = {};
        header.forEach((h, i) => obj[h] = r[i]);

        const rawCode = obj.branch_code?.trim();
        const item = obj.ItemCode;

        if (!rawCode || !item) return null;

        const prefix = rawCode.slice(0, 2);
        const num = parseInt(rawCode.slice(2), 10);
        if (isNaN(num)) return null;

        const branch_code = prefix + num.toString().padStart(3, "0");
        const item_code = String(item).trim().padStart(5, "0");
        if (!item_code || item_code === "00000" || item_code.includes("NaN")) return null;

        let min = parseInt(obj.MinStock, 10);
        let max = parseInt(obj.MaxStock, 10);
        if (isNaN(min)) min = null;
        if (isNaN(max)) max = null;
        
        let pack_order = parseInt(obj.pack_order, 10);
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
        };
    });

    return { data: mapped };
};

const parseStock = (raw) => {
    const headerRowIndex = raw.findIndex(row =>
        row.includes("รหัสสินค้า") &&
        row.includes("รหัสสาขา") &&
        row.includes("จำนวนคงเหลือ")
    );

    if (headerRowIndex === -1) {
        return { error: "ไม่พบ header ของ Stock XLSX" };
    }

    const header = raw[headerRowIndex];
    const dataRows = raw.slice(headerRowIndex + 1);

    const rows = dataRows.map(r => {
        let obj = {};
        header.forEach((h, i) => obj[h] = r[i]);
        return obj;
    });

    const INT32_MAX = 2147483647;
    const INT32_MIN = -2147483648;

    const mapped = rows
        .filter(row => {
            const code = row["รหัสสินค้า"];
            const branch = row["รหัสสาขา"];
            return code && !isNaN(code) && branch;
        })
        .map(row => {
            const rawCode = (row["รหัสสินค้า"] || "").toString().trim();
            const item_code = rawCode.padStart(5, "0");
            const branch_code = (row["รหัสสาขา"] || "").toString().trim();
            let qty = parseFloat(row["จำนวนคงเหลือ"]);
            if (isNaN(qty) || qty > INT32_MAX || qty < INT32_MIN) qty = 0;
            qty = Math.floor(qty);
            if (qty === 0) return null;
            return { item_code, branch_code, quantity_stock: qty };
        })
        .filter(Boolean);

    return { data: mapped };
};

const parseWithdraw = (raw) => {
    const headerRowIndex = raw.findIndex(row =>
        row.includes("รหัสสินค้า") &&
        row.includes("เลขที่เอกสาร") &&
        row.includes("จำนวน") &&
        row.includes("สาขา")
    );

    if (headerRowIndex === -1) {
        return { error: "ไม่พบหัวตาราง withdraw" };
    }

    const header = raw[headerRowIndex];
    const dataRows = raw.slice(headerRowIndex + 1);

    const rows = dataRows.map(r => {
        let obj = {};
        header.forEach((h, i) => obj[h] = r[i]);
        return obj;
    });

    const mapped = rows
        .filter(row =>
            row["รหัสสินค้า"] &&
            !isNaN(row["รหัสสินค้า"]) &&
            row["สาขา"]
        )
        .map(row => {
            const rawCode = (row["รหัสสินค้า"] || "").toString().trim();
            const item_code = rawCode.padStart(5, "0");
            if (!item_code || item_code === "00000" || item_code.includes("NaN")) return null;

            const branch_code = row["สาขา"]
                ?.split(")")[0]
                ?.replace("(", "")
                ?.trim();
            if (!branch_code) return null;

            let qty = parseFloat(row["จำนวน"]);
            if (isNaN(qty)) qty = 0;

            let val = parseFloat(row["มูลค่าเบิกออก"]);
            if (isNaN(val)) val = 0;

            return {
                item_code,
                branch_code,
                docNumber: (row["เลขที่เอกสาร"] || "").toString().trim() || null,
                date: (row["วันที่"] || "").toString().trim() || null,
                docStatus: (row["สถานะเอกสาร"] || "").toString().trim() || null,
                reason: (row["เหตุผล"] || "").toString().trim() || null,
                quantity_stock: qty,
                value: val,
            };
        })
        .filter(v => v !== null);

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
