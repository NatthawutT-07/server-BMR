const prisma = require('../../../config/prisma');
const { Prisma } = require("@prisma/client");
const XLSX = require("xlsx");
const { initUploadJob, setUploadJob, finishUploadJob, failUploadJob, touchDataSync } = require('./uploadJob');

// =======================
// Helpers
// =======================
const EPS = 1e-9;
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function parseDateBangkok(input) {
    if (!input) return null;

    const [datePart, timePartRaw] = String(input).trim().split(" ");
    const [day, month, year] = datePart.split("/").map(Number);

    const timePart = timePartRaw || "00:00:00";
    const [hour = 0, minute = 0, second = 0] = timePart
        .split(":")
        .map((v) => Number(v));

    // ✅ ใช้ Date.UTC() เพื่อบังคับให้เวลาที่ parse ตรงกับ Excel เป๊ะ ๆ
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
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
    return code !== "" && Math.abs(qty) > EPS;
};

const hasPaymentInfo = (r) => {
    const fields = ["total_payment", "payment_method", "bank", "reference_number"];
    return fields.some((f) => {
        const v = r?.[f];
        return v !== undefined && v !== null && String(v).trim() !== "";
    });
};

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

function pickPaymentRows(group) {
    if (!Array.isArray(group) || group.length === 0) return [];

    const startIdx = group.length > 1 ? 1 : 0;

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

        if (existed._seen.has(p.amount)) continue;

        existed.amount = round2(existed.amount + p.amount);
        existed._seen.add(p.amount);
    }

    return Array.from(map.values()).map(({ _seen, ...rest }) => rest);
}

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

        result.push(header);

        for (let i = 1; i < group.length; i++) {
            result.push(group[i]);
        }
    }

    return [...result, ...noBill];
}

// ✅ BATCH SIZE สำหรับ raw SQL insert
const BATCH_SIZE = 5000;

// =======================
// Controller หลัก (OPTIMIZED)
// =======================
exports.uploadBillXLSX = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const jobId = initUploadJob(req, "upload-bill");
    setUploadJob(jobId, 5, "reading file");

    try {
        // 1) อ่าน XLSX
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        setUploadJob(jobId, 15, "parsing rows");

        console.log("📘 Raw rows =", rows.length);

        // 2) ตัดแถวบน/ล่าง
        rows = rows.slice(2, rows.length - 3);
        if (rows.length < 2) {
            return res.status(400).json({ error: "ไม่พบข้อมูลหลังตัดแถวบน/ล่าง" });
        }

        // 3) header ไทย → key อังกฤษ
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

        console.log("📗 Parsed rows =", results.length);
        setUploadJob(jobId, 25, `parsed ${results.length} rows`);

        // 5) merge header/footer
        setUploadJob(jobId, 35, "cleaning data");
        results = mergeBillHeaderFooter(results);
        console.log("📙 After merge header/footer rows =", results.length);
        setUploadJob(jobId, 40, `grouped ${results.length} rows`);

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
        const newBranches = new Map();
        const newChannels = new Map();
        const newProducts = new Map();
        const newCustomers = new Map(); // ✅ เก็บ customer ใหม่ทั้งหมดก่อน

        const createdCustomerList = [];
        const createdProductKeyList = [];

        // ✅ PASS 1: scan หา branch/channel/product/customer ใหม่ทั้งหมดก่อน
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

            // ✅ CUSTOMER - เก็บไว้ก่อน ไม่ upsert ทีละตัว
            const { code: custCode, name: custName } = parseCodeName(meta.customer);
            if (custCode && !customerIdMap[custCode] && !newCustomers.has(custCode)) {
                newCustomers.set(custCode, custName || "unknown");
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

        setUploadJob(jobId, 45, "creating master data");

        // 11) ✅ Bulk create branch/channel/product/customer ทีเดียว
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

                // ✅ Bulk create customers แทนที่จะ upsert ทีละตัว
                newCustomers.size > 0
                    ? prisma.customer.createMany({
                        data: [...newCustomers].map(([code, name]) => ({
                            customer_code: code,
                            customer_name: name,
                        })),
                        skipDuplicates: true,
                    })
                    : null,
            ].filter(Boolean)
        );

        // 12) refresh maps หลังสร้าง
        const [branchesAll, channelsAll, productsAll, customersAll] = await Promise.all([
            prisma.branch.findMany(),
            prisma.salesChannel.findMany(),
            prisma.product.findMany(),
            prisma.customer.findMany({ select: { id: true, customer_code: true } }),
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
        const customerIdMapAll = Object.fromEntries(
            customersAll.map((c) => [c.customer_code, c.id])
        );

        // Track created customers
        for (const [code, name] of newCustomers) {
            if (customerIdMapAll[code]) {
                createdCustomerList.push({
                    customer_code: code,
                    customer_name: name,
                    id: customerIdMapAll[code],
                });
            }
        }

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

        setUploadJob(jobId, 55, "preparing bills");

        // 13) สร้าง Bills + BillItems + BillPayments
        const newBills = [];
        const pendingBillItems = [];
        const pendingBillPayments = [];

        for (const [billNo, group] of billGroups.entries()) {
            if (existingBillSet.has(billNo)) continue;

            const meta = group[0];

            const billDate = parseDateBangkok(meta.date);

            // ✅ ใช้ customerIdMapAll แทน upsert ทีละตัว
            const { code: custCode } = parseCodeName(meta.customer);
            const customerId = custCode ? customerIdMapAll[custCode] || null : null;

            const { code: cCode } = parseCodeName(meta.sales_channel);

            const paymentList = pickPaymentRows(group);

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

        setUploadJob(jobId, 65, "saving bills");

        // 14) ✅ Insert Bills แบบ batch
        if (newBills.length > 0) {
            for (let i = 0; i < newBills.length; i += BATCH_SIZE) {
                const chunk = newBills.slice(i, i + BATCH_SIZE);
                await prisma.bill.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                const progress = 65 + Math.floor((i / newBills.length) * 10);
                setUploadJob(jobId, progress, `saving bills ${Math.min(i + BATCH_SIZE, newBills.length)}/${newBills.length}`);
            }
        }

        // 15) ✅ โหลดเฉพาะ billId ที่เพิ่งสร้าง (ไม่โหลดทั้งหมด)
        const newBillNumbers = newBills.map(b => b.bill_number);
        const createdBills = await prisma.bill.findMany({
            where: { bill_number: { in: newBillNumbers } },
            select: { id: true, bill_number: true },
        });
        const billIdMapAll = Object.fromEntries(
            createdBills.map((b) => [b.bill_number, b.id])
        );

        setUploadJob(jobId, 80, "saving bill items");

        // 16) ✅ Insert BillItems แบบ batch
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
            for (let i = 0; i < billItemsToInsert.length; i += BATCH_SIZE) {
                const chunk = billItemsToInsert.slice(i, i + BATCH_SIZE);
                await prisma.billItem.createMany({
                    data: chunk,
                });
                const progress = 80 + Math.floor((i / billItemsToInsert.length) * 5);
                setUploadJob(jobId, progress, `saving items ${Math.min(i + BATCH_SIZE, billItemsToInsert.length)}/${billItemsToInsert.length}`);
            }
        }

        setUploadJob(jobId, 90, "saving bill payments");

        // 17) ✅ Insert BillPayments แบบ batch
        const billPaymentsToInsert = pendingBillPayments
            .filter((p) => billIdMapAll[p.bill_number])
            .map((p) => ({
                billId: billIdMapAll[p.bill_number],
                amount: round2(p.amount),
                payment_method: normPaymentMethod(p.payment_method),
                bank: normBank(p.bank),
                reference_number: normRef(p.reference_number),
            }));

        let bill_payments_created = 0;
        if (billPaymentsToInsert.length > 0) {
            for (let i = 0; i < billPaymentsToInsert.length; i += BATCH_SIZE) {
                const chunk = billPaymentsToInsert.slice(i, i + BATCH_SIZE);
                const created = await prisma.billPayment.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                bill_payments_created += created?.count ?? 0;
            }
        }

        await touchDataSync("dashboard", newBills.length);

        finishUploadJob(jobId, "completed");
        return res.json({
            message: "Import สำเร็จ (OPTIMIZED: batch insert + no individual upserts)",
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
        failUploadJob(jobId, err?.message || "failed");
        return res.status(500).json({ error: err.message });
    }
};
