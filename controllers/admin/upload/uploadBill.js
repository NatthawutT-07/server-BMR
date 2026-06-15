const prisma = require('../../../config/prisma');
const XLSX = require("xlsx");
const { touchDataSync } = require('./uploadJob');

// Helpers
const EPS = 1e-9;

function parseDateBangkok(input) {
    if (!input) return null;

    if (input instanceof Date && !Number.isNaN(input.getTime())) {
        return input;
    }

    if (typeof input === "number") {
        const parsed = XLSX.SSF.parse_date_code(input);
        if (!parsed) return null;

        const yyyy = String(parsed.y);
        const mm = String(parsed.m).padStart(2, "0");
        const dd = String(parsed.d).padStart(2, "0");
        const hh = String(parsed.H || 0).padStart(2, "0");
        const min = String(parsed.M || 0).padStart(2, "0");
        const ss = String(Math.floor(parsed.S || 0)).padStart(2, "0");

        return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+07:00`);
    }

    const [datePart, timePartRaw] = String(input).trim().split(" ");
    const [day, month, year] = datePart.split("/").map(Number);
    if (!day || !month || !year) return null;

    const timePart = timePartRaw || "00:00:00";
    const [hour = 0, minute = 0, second = 0] = timePart
        .split(":")
        .map((v) => Number(v));
    return new Date(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+07:00`
    );
}

function parseFloatWithComma(v) {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/,/g, "").trim();
    if (s === "") return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

const isItemLine = (r) => {
    const code = String(r.item_code || "").trim();
    const qty = parseFloatWithComma(r.quantity_sale_bill);
    return code !== "" && Math.abs(qty) > EPS;
};

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
    "รหัสสินค้า": "item_code",
    "ชื่อสินค้า": "product_name",
    "จำนวน": "quantity_sale_bill",
    "หน่วย": "unit",
    "ราคา/หน่วย": "price_per_unit",
    "ยอดขาย": "sales_amount",
    "ส่วนลด": "discount",
    "มูลค่าแยกภาษี": "value_excl_tax",
    "ภาษีมูลค่าเพิ่ม": "vat",
    "ลดท้ายบิล": "end_bill_discount",
    "มูลค่ารวมหลังลดท้ายบิล": "total_sales_end_discount_no_rounding",
    "ยอดปัดเศษ": "rounding",
    "ยอดขายสุทธิ": "total_sales_rounding_no_end_discount",
    "ยอดขายรวม": "total_sales_Finally",
};
const BATCH_SIZE = 5000;
// Controller 
exports.uploadBillXLSX = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
        // 1) อ่าน XLSX
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        // 2) ตัดแถวบน/ล่าง
        rows = rows.slice(2, rows.length - 3);
        if (rows.length < 2) {
            return res.status(400).json({ error: "ไม่พบข้อมูลหลังตัดแถวบน/ล่าง" });
        }
        // 3) header ไทย -> อังกฤษ
        const thHeader = rows[0];
        const enHeader = thHeader.map((h) => headerMap[String(h).trim()] || String(h).trim());
        // 4) แปลงเป็น object
        let results = rows.slice(1).map((r, index) => {
            const obj = {};
            enHeader.forEach((key, i) => {
                obj[key] = r[i] ?? "";
            });
            obj._tempId = index + 1;
            return obj;
        });
        // 5) group ตาม bill_number
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
        // 6) กันบิลซ้ำ
        const existingBills = await prisma.billHeader.findMany({
            select: { bill_number: true },
        });
        const existingBillSet = new Set(existingBills.map((b) => b.bill_number));

        const branchesInDb = await prisma.branchMain.findMany();

        const branchIdMap = Object.fromEntries(
            branchesInDb.map((b) => [b.branch_code, b.id])
        );

        // 7) เตรียมชุดสร้างใหม่
        const newBranches = new Map();

        // PASS 1: scan หา branchMain ใหม่ทั้งหมดก่อน
        for (const [billNo, group] of billGroups.entries()) {
            if (existingBillSet.has(billNo)) continue;

            const meta = group[0];
            if (
                meta.branch_code &&
                !branchIdMap[meta.branch_code] &&
                !newBranches.has(meta.branch_code)
            ) {
                newBranches.set(meta.branch_code, meta.branch_name || "unknown");
            }
        }

        // 8) Bulk create branchMain ทีเดียว
        if (newBranches.size > 0) {
            await prisma.branchMain.createMany({
                data: [...newBranches].map(([code, name]) => ({
                    branch_code: code,
                    branch_name: name,
                })),
                skipDuplicates: true,
            });
        }

        // 9) refresh maps หลังสร้าง
        const branchesAll = await prisma.branchMain.findMany();

        const branchIdMapAll = Object.fromEntries(
            branchesAll.map((b) => [b.branch_code, b.id])
        );

        // 10) สร้าง Bills + BillItems
        const newBills = [];
        const pendingBillItems = [];

        for (const [billNo, group] of billGroups.entries()) {
            if (existingBillSet.has(billNo)) continue;

            const meta = group[0];
            const billDate = parseDateBangkok(meta.date);
            const salesChannelRaw = String(meta.sales_channel || "").trim() || null;

            newBills.push({
                bill_number: billNo,
                date: billDate,
                branchId: meta.branch_code ? branchIdMapAll[meta.branch_code] || null : null,
                sales_channel: salesChannelRaw,
                doc_type: meta.doc_type || null,
                pos_type: meta.pos_type || null,
                reference_doc: meta.reference_doc || null,

                value_excl_tax: parseFloatWithComma(meta.value_excl_tax),
                vat: parseFloatWithComma(meta.vat),
                end_bill_discount: parseFloatWithComma(meta.end_bill_discount),
                total_sales_end_discount_no_rounding: parseFloatWithComma(meta.total_sales_Finally_end_discount_no_rounding),
                rounding: parseFloatWithComma(meta.rounding),
                total_sales_Finally: parseFloatWithComma(meta.total_sales_Finally),
            });

            // BILL ITEMS
            for (const row of group) {
                if (!isItemLine(row)) continue;
                if (!row.item_code) continue;

                const productCodeClean = String(row.item_code || "unknown")
                    .replace(/\.0$/, "")
                    .trim();

                pendingBillItems.push({
                    bill_number: billNo,
                    item_code: productCodeClean,
                    quantity_sale_bill: parseFloatWithComma(row.quantity_sale_bill),
                    unit: row.unit || null,
                    price_per_unit: parseFloatWithComma(row.price_per_unit),
                    sales_amount: parseFloatWithComma(row.sales_amount),
                    discount: parseFloatWithComma(row.discount),
                    total_sales_rounding_no_end_discount: parseFloatWithComma(row.total_sales_rounding_no_end_discount),
                });
            }
        }

        // 11) Insert Bills แบบ batch
        if (newBills.length > 0) {
            for (let i = 0; i < newBills.length; i += BATCH_SIZE) {
                const chunk = newBills.slice(i, i + BATCH_SIZE);
                await prisma.billHeader.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
            }
        }

        // 12) โหลดเฉพาะ billId ที่เพิ่งสร้าง (ไม่โหลดทั้งหมด)
        const newBillNumbers = newBills.map(b => b.bill_number);
        const createdBills = await prisma.billHeader.findMany({
            where: { bill_number: { in: newBillNumbers } },
            select: { id: true, bill_number: true },
        });
        const billIdMapAll = Object.fromEntries(
            createdBills.map((b) => [b.bill_number, b.id])
        );

        // 13) Insert BillItems แบบ batch
        const billItemsToInsert = pendingBillItems
            .filter((i) => billIdMapAll[i.bill_number])
            .map((i) => ({
                billId: billIdMapAll[i.bill_number],
                item_code: i.item_code,
                quantity_sale_bill: i.quantity_sale_bill,
                unit: i.unit,
                price_per_unit: i.price_per_unit,
                sales_amount: i.sales_amount,
                discount: i.discount,
                total_sales_rounding_no_end_discount: i.total_sales_rounding_no_end_discount,
            }));

        if (billItemsToInsert.length > 0) {
            for (let i = 0; i < billItemsToInsert.length; i += BATCH_SIZE) {
                const chunk = billItemsToInsert.slice(i, i + BATCH_SIZE);
                await prisma.billItem.createMany({
                    data: chunk,
                });
            }
        }

        await touchDataSync("dashboard", newBills.length);

        return res.json({
            message: "Import สำเร็จ (OPTIMIZED: batch insert + no individual upserts)",
            raw_rows: rows.length,
            parsed_rows: results.length,
            bills_created: newBills.length,
            bill_items_created: billItemsToInsert.length,
            no_bill_rows: noBillRows.length,
            bills_skipped: billGroups.size - newBills.length,
        });
    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
