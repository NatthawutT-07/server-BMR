/**
 * Excel Worker Thread
 * ใช้สำหรับ Parse Excel files โดยไม่ Block Event Loop ของ Main Thread
 * 
 * รับ: { buffer, type } ผ่าน workerData
 * ส่งกลับ: { success, data, error } ผ่าน parentPort.postMessage
 */

const { parentPort, workerData } = require("worker_threads");
const XLSX = require("xlsx");

// ========================================
// Helper Functions (copy จาก uploadController)
// ========================================

const parseItemMinMax = (raw) => {
    const headerRowIndex = raw.findIndex(row =>
        row.includes("BranchCode") &&
        row.includes("ItemCode") &&
        row.includes("MinStock") &&
        row.includes("MaxStock")
    );

    if (headerRowIndex === -1) {
        return { error: "❌ Header Format Incorrect (ItemMinMax)" };
    }

    const header = raw[headerRowIndex];
    const dataRows = raw.slice(headerRowIndex + 1);

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

        return { branchCode, codeProduct, minStore: min, maxStore: max };
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
        return { error: "❌ ไม่พบ header master item" };
    }

    const header = raw[headerRowIndex];
    const dataRows = raw.slice(headerRowIndex + 1);

    const rows = dataRows.map(r => {
        let obj = {};
        header.forEach((h, i) => obj[h] = r[i]);
        return obj;
    });

    const cleaned = rows.filter(r =>
        r["Item No."] && !isNaN(r["Item No."])
    );

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

    return { data: mapped };
};

const parseStock = (raw) => {
    const headerRowIndex = raw.findIndex(row =>
        row.includes("รหัสสินค้า") &&
        row.includes("รหัสสาขา") &&
        row.includes("จำนวนคงเหลือ")
    );

    if (headerRowIndex === -1) {
        return { error: "❌ ไม่พบ header ของ Stock XLSX" };
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
            const codeProduct = parseInt(row["รหัสสินค้า"], 10);
            const branchCode = (row["รหัสสาขา"] || "").trim();
            let qty = parseFloat(row["จำนวนคงเหลือ"]);
            if (isNaN(qty) || qty > INT32_MAX || qty < INT32_MIN) qty = 0;
            qty = Math.floor(qty);
            if (qty === 0) return null;
            return { codeProduct, branchCode, quantity: qty };
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
        return { error: "❌ ไม่พบหัวตาราง withdraw" };
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
            const codeProduct = parseInt(row["รหัสสินค้า"], 10);
            if (!codeProduct) return null;

            const branchCode = row["สาขา"]
                ?.split(")")[0]
                ?.replace("(", "")
                ?.trim();
            if (!branchCode) return null;

            let qty = parseFloat(row["จำนวน"]);
            if (isNaN(qty)) qty = 0;

            let val = parseFloat(row["มูลค่าเบิกออก"]);
            if (isNaN(val)) val = 0;

            return {
                codeProduct,
                branchCode,
                docNumber: row["เลขที่เอกสาร"] || null,
                date: row["วันที่"] || null,
                docStatus: row["สถานะเอกสาร"] || null,
                reason: row["เหตุล"] || null,
                quantity: qty,
                value: val,
            };
        })
        .filter(v => v !== null);

    return { data: mapped };
};

// ========================================
// Main Worker Logic
// ========================================

try {
    const { buffer, type } = workerData;

    // ส่ง progress
    parentPort.postMessage({ type: "progress", progress: 10, message: "reading file" });

    // อ่าน Excel (ส่วนที่ Block มากที่สุด)
    const workbook = XLSX.read(Buffer.from(buffer), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    parentPort.postMessage({ type: "progress", progress: 40, message: "parsing rows" });

    // แปลงเป็น JSON
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    parentPort.postMessage({ type: "progress", progress: 60, message: "processing data" });

    // Parse ตาม type
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

    // ส่งผลลัพธ์กลับ
    if (result.error) {
        parentPort.postMessage({ type: "error", error: result.error });
    } else {
        parentPort.postMessage({ type: "result", data: result.data });
    }

} catch (err) {
    parentPort.postMessage({ type: "error", error: err.message || "Worker error" });
}
