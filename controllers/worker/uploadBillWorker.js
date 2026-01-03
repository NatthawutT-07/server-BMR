// workers/uploadBillWorker.js
const { PrismaClient } = require("@prisma/client");
const { parentPort, workerData } = require("worker_threads");
const XLSX = require("xlsx");

const prisma = new PrismaClient();

// =======================
// Helper functions
// =======================

function log(...args) {
    const msg = args.join(" ");
    if (parentPort) {
        parentPort.postMessage({ type: "log", message: msg });
    } else {
        console.log(msg);
    }
}

function parseDate(input) {
    if (!input) return null;
    const [datePart, timePart] = String(input).split(" ");
    const [day, month, year] = datePart.split("/").map(Number);
    const [hour = 0, minute = 0] = (timePart || "00:00").split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute);
}

function parseCodeName(str) {
    if (!str) return { code: null, name: null };
    const match = String(str).match(/\((.*?)\)(.*)/);
    if (match) return { code: match[1], name: match[2].trim() };
    return { code: null, name: String(str).trim() };
}

function parseProduct(str) {
    if (!str) return { brand: null, name: null };
    const [brand, ...rest] = String(str).split(":");
    return { brand: brand.trim(), name: rest.join(":").trim() };
}

function parseFloatWithComma(v) {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/,/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

// header ภาษาไทย → key อังกฤษ (ตาม Prisma)
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
// Logic เร็วขึ้น: ลดจำนวน loop
// =======================

// ลบคู่เอกสารขาย (+qty / -qty) แบบ optimized
function removeMatchedSalesPairs(rows) {
    const groupMap = new Map();

    // group เฉพาะเอกสารขาย ตาม bill_number + product_code
    for (const row of rows) {
        if (row.doc_type !== "เอกสารขาย") continue;

        if (typeof row._qty !== "number") {
            row._qty = parseFloatWithComma(row.quantity);
        }

        const key = `${row.bill_number || ""}|${row.product_code || ""}`;
        let group = groupMap.get(key);
        if (!group) {
            group = [];
            groupMap.set(key, group);
        }
        group.push(row);
    }

    const idsToRemove = new Set();

    // ใช้ Map ต่อ group ลดจาก O(N^2) → O(N)
    for (const group of groupMap.values()) {
        const negMap = new Map(); // qty- → rows

        for (const r of group) {
            if (r._qty < 0) {
                const list = negMap.get(r._qty) || [];
                list.push(r);
                negMap.set(r._qty, list);
            }
        }

        for (const r of group) {
            if (r._qty > 0 && !idsToRemove.has(r._tempId)) {
                const list = negMap.get(-r._qty);
                if (list && list.length > 0) {
                    const target = list.shift();
                    idsToRemove.add(r._tempId);
                    idsToRemove.add(target._tempId);
                }
            }
        }
    }

    const cleaned = rows.filter((r) => !idsToRemove.has(r._tempId));
    log(`🧹 Removed matched sales pairs = ${idsToRemove.size} rows`);

    return cleaned;
}

// รวมข้อมูลหัว + ท้ายบิล
function mergeBillHeaderFooter(rows) {
    const byBill = new Map();
    const noBill = [];

    for (const row of rows) {
        if (!row.bill_number) {
            noBill.push(row);
            continue;
        }
        let group = byBill.get(row.bill_number);
        if (!group) {
            group = [];
            byBill.set(row.bill_number, group);
        }
        group.push(row);
    }

    const result = [];

    for (const [bill, group] of byBill.entries()) {
        if (group.length === 1) {
            result.push(group[0]);
            continue;
        }

        const first = { ...group[0] };
        const last = group[group.length - 1];

        const paymentFields = [
            "total_payment",
            "payment_method",
            "bank",
            "reference_number",
        ];

        for (const f of paymentFields) {
            if (
                last[f] !== undefined &&
                last[f] !== null &&
                String(last[f]).trim() !== ""
            ) {
                first[f] = last[f];
            }
        }

        result.push(first);

        for (let i = 1; i < group.length - 1; i++) {
            result.push(group[i]);
        }
        // ไม่ push last
    }

    return [...result, ...noBill];
}

// =======================
// main worker logic
// =======================

(async () => {
    try {
        const buffer = workerData.buffer;

        //
        // 1) อ่าน XLSX เป็น raw rows
        //
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        log("📘 Raw rows =", rows.length);

        //
        // 2) ตัดหัว 2 ท้าย 3
        //
        rows = rows.slice(2, rows.length - 3);
        if (rows.length < 2) {
            throw new Error("ไม่พบข้อมูลหลังตัดแถวบน/ล่าง");
        }

        //
        // 3) header ภาษาไทย → อังกฤษ
        //
        const thHeader = rows[0];
        const enHeader = thHeader.map((h) => headerMap[h] || h);

        //
        // 4) แปลงเป็น object + tempId + _qty (รอบเดียว)
        //
        const dataRows = rows.slice(1);
        let results = dataRows.map((r, idx) => {
            const obj = {};
            enHeader.forEach((key, i) => {
                obj[key] = r[i] ?? "";
            });

            // tempId สำหรับจับคู่
            obj._tempId = idx + 1;

            // เตรียม _qty ไว้เลยสำหรับเอกสารขาย
            if (obj.doc_type === "เอกสารขาย") {
                obj._qty = parseFloatWithComma(obj.quantity);
            }

            return obj;
        });

        log("📗 Parsed rows =", results.length);

        //
        // 5) ลบคู่เอกสารขาย
        //
        results = removeMatchedSalesPairs(results);

        //
        // 6) รวมหัว + ท้ายบิล
        //
        results = mergeBillHeaderFooter(results);

        log("📙 After clean rows =", results.length);

        //
        // 7) โหลด mapping จาก DB
        //
        const [
            branchesInDb,
            channelsInDb,
            customersInDb,
            productsInDb,
            billsInDb,
        ] = await Promise.all([
            prisma.branch.findMany(),
            prisma.salesChannel.findMany(),
            prisma.customer.findMany(),
            prisma.product.findMany(),
            prisma.bill.findMany({ select: { bill_number: true, id: true } }),
        ]);

        const branchIdMap = Object.fromEntries(
            branchesInDb.map((b) => [b.branch_code, b.id])
        );
        const channelIdMap = Object.fromEntries(
            channelsInDb.map((c) => [c.channel_code, c.id])
        );
        const customerIdMap = Object.fromEntries(
            customersInDb.map((c) => [c.customer_code, c.id])
        );
        const productIdMap = Object.fromEntries(
            productsInDb.map((p) => [`${p.product_code}|${p.product_brand}`, p.id])
        );
        const existingBillSet = new Set(
            billsInDb.map((b) => b.bill_number)
        );

        //
        // 8) เตรียมชุดข้อมูลใหม่ไว้ insert
        //
        const newBranches = new Map();
        const newChannels = new Map();
        const newCustomers = new Map();
        const newProducts = new Map();
        const newBills = [];
        const newBillItems = [];

        for (const row of results) {
            // ข้ามทั้งบิลถ้ามีอยู่แล้ว
            if (existingBillSet.has(row.bill_number)) continue;

            // BRANCH
            if (
                row.branch_code &&
                !branchIdMap[row.branch_code] &&
                !newBranches.has(row.branch_code)
            ) {
                newBranches.set(row.branch_code, row.branch_name);
            }

            // CHANNEL
            const { code: cCode, name: cName } = parseCodeName(
                row.sales_channel
            );
            if (cCode && !channelIdMap[cCode] && !newChannels.has(cCode)) {
                newChannels.set(cCode, cName || "unknown");
            }

            // CUSTOMER
            const { code: custCode, name: custName } = parseCodeName(
                row.customer
            );
            let customerId = custCode ? customerIdMap[custCode] || null : null;

            if (!customerId && custCode && !newCustomers.has(custCode)) {
                newCustomers.set(custCode, custName || "unknown");
            }

            // PRODUCT
            const { brand, name } = parseProduct(row.product_name);
            const productCodeClean = row.product_code
                ? String(row.product_code).replace(/\.0$/, "")
                : "unknown";
            const productKey = `${productCodeClean}|${brand || "unknown"}`;

            if (!productIdMap[productKey] && !newProducts.has(productKey)) {
                newProducts.set(productKey, {
                    product_code: productCodeClean,
                    product_name: name || "unknown",
                    product_brand: brand || "unknown",
                });
            }

            // BILL
            const billDate = parseDate(row.date);

            newBills.push({
                bill_number: row.bill_number,
                date: billDate,
                branchId: branchIdMap[row.branch_code] || null,
                salesChannelId: channelIdMap[cCode || "unknown"] || null,
                customerId,
                customer_code: custCode,
                doc_type: row.doc_type,
                pos_type: row.pos_type,
                reference_doc: row.reference_doc || null,
                value_excl_tax: parseFloatWithComma(row.value_excl_tax),
                vat: parseFloatWithComma(row.vat),
                end_bill_discount: parseFloatWithComma(row.end_bill_discount),
                total_after_discount: parseFloatWithComma(
                    row.total_after_discount
                ),
                rounding: parseFloatWithComma(row.rounding),
                net_sales: parseFloatWithComma(row.net_sales),
                total_sales: parseFloatWithComma(row.total_sales),
                total_payment: parseFloatWithComma(row.total_payment),
                payment_method: row.payment_method || null,
                bank: row.bank || null,
                reference_number: row.reference_number || null,
            });

            // BILL ITEM
            if (row.product_code) {
                newBillItems.push({
                    bill_number: row.bill_number,
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

        //
        // 9) Insert branch / channel / customer / product / bill
        //
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
                newCustomers.size > 0
                    ? prisma.customer.createMany({
                        data: [...newCustomers].map(([code, name]) => ({
                            customer_code: code,
                            customer_name: name,
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
                newBills.length > 0
                    ? prisma.bill.createMany({
                        data: newBills.map((b) => {
                            const { customer_code, ...rest } = b;
                            return rest;
                        }),
                        skipDuplicates: true,
                    })
                    : null,
            ].filter(Boolean)
        );

        //
        // 10) โหลด mapping ใหม่ + insert billItems
        //
        const [customersAll, productsAll, billsAll] = await Promise.all([
            prisma.customer.findMany(),
            prisma.product.findMany(),
            prisma.bill.findMany({ select: { id: true, bill_number: true } }),
        ]);

        const customerIdMapAll = Object.fromEntries(
            customersAll.map((c) => [c.customer_code, c.id])
        );
        const productIdMapAll = Object.fromEntries(
            productsAll.map((p) => [`${p.product_code}|${p.product_brand}`, p.id])
        );
        const billIdMapAll = Object.fromEntries(
            billsAll.map((b) => [b.bill_number, b.id])
        );

        newBills.forEach((bill) => {
            if (!bill.customerId && bill.customer_code) {
                bill.customerId = customerIdMapAll[bill.customer_code] || null;
            }
        });

        if (newBillItems.length > 0) {
            await prisma.billItem.createMany({
                data: newBillItems
                    .filter(
                        (i) =>
                            billIdMapAll[i.bill_number] &&
                            productIdMapAll[i.product_key]
                    )
                    .map((i) => ({
                        billId: billIdMapAll[i.bill_number],
                        productId: productIdMapAll[i.product_key],
                        quantity: i.quantity,
                        unit: i.unit,
                        price_per_unit: i.price_per_unit,
                        sales_amount: i.sales_amount,
                        discount: i.discount,
                        net_sales: i.net_sales,
                    })),
            });
        }

        if (parentPort) {
            parentPort.postMessage({
                type: "result",
                data: {
                    message:
                        "✅ XLSX imported & cleaned via worker (fast mode) successfully!",
                    rows: results.length,
                },
            });
        }
    } catch (err) {
        console.error("❌ Worker Error:", err);
        if (parentPort) {
            parentPort.postMessage({
                type: "error",
                error: err.message,
            });
        }
    } finally {
        await prisma.$disconnect().catch(() => { });
    }
})();
