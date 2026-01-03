const prisma = require("../../config/prisma");

const NodeCache = require("node-cache");

// cache สำหรับ sales search (TTL = 1 ชั่วโมง)
const salesCache = new NodeCache({ stdTTL: 60 * 60 }); // 3600 วินาที


exports.getBranchListSales = async (req, res) => {
    try {
        const itemall = await prisma.branch.findMany();
        res.json(itemall).status(200);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'select station error' });
    }
};

// ================================
// 1. ยอดขายสาขา 
// ================================
exports.getSearchBranchSales = async (req, res) => {
    const { branch_code } = req.body;

    try {
        const branch = await prisma.branch.findUnique({
            where: { branch_code },
        });
        if (!branch) {
            return res.status(404).json({ msg: "Branch not found" });
        }

        const channels = await prisma.salesChannel.findMany();
        const channelMap = Object.fromEntries(
            channels.map((c) => [c.id, c.channel_name])
        );

        /* ========================================================
            1) ดึงยอดขาย + คืน แยกตามเดือน
        ======================================================== */
        const rows = await prisma.$queryRaw`
            SELECT
                DATE_TRUNC('month', "date" + INTERVAL '7 hour') AS month,
                "doc_type",
                "salesChannelId",
                SUM("total_sales") AS total_sales,
                SUM("end_bill_discount") AS end_bill_discount,
                SUM("rounding") AS rounding,
                COUNT(id) AS bill_count
            FROM "Bill"
            WHERE "branchId" = ${branch.id}
              AND "doc_type" IN ('เอกสารขาย', 'เอกสารคืน')
            GROUP BY month, "doc_type", "salesChannelId"
            ORDER BY month;
        `;

        /* ========================================================
            2) ดึงจำนวนวันจริงที่มีรายการ (DISTINCT day)
        ======================================================== */
        const dayRows = await prisma.$queryRaw`
            SELECT
                DATE_TRUNC('month', b."date" + INTERVAL '7 hour') AS month,
                COUNT(DISTINCT DATE_TRUNC('day', b."date" + INTERVAL '7 hour')) AS days_count
            FROM "Bill" b
            WHERE b."branchId" = ${branch.id}
            GROUP BY month
            ORDER BY month;
        `;

        // แปลงเป็น map เช่น { "12/2025": 10 }
        const dayMap = {};
        for (const d of dayRows) {
            const dt = new Date(d.month);
            const key = `${dt.getMonth() + 1}/${dt.getFullYear()}`;
            dayMap[key] = Number(d.days_count || 0);
        }

        /* ========================================================
            3) สร้าง salesData / returnsData
        ======================================================== */
        const salesData = {};
        const returnsData = {};

        for (const r of rows) {
            const date = new Date(r.month);
            const monthYear = `${date.getMonth() + 1}/${date.getFullYear()}`;

            const totalSalesRaw = Number(r.total_sales || 0);
            const endBillDiscount = Number(r.end_bill_discount || 0);
            const rounding = Number(r.rounding || 0);
            const billCount = Number(r.bill_count || 0);

            const channelName = channelMap[r.salesChannelId] || "Unknown";

            if (r.doc_type === "เอกสารขาย") {
                if (!salesData[monthYear]) {
                    salesData[monthYear] = {
                        total: 0,
                        billCount: 0,
                        endBillDiscount: 0,
                        rounding: 0,
                        channels: {},
                    };
                }

                salesData[monthYear].channels[channelName] =
                    (salesData[monthYear].channels[channelName] || 0) + totalSalesRaw;

                salesData[monthYear].total += totalSalesRaw;
                salesData[monthYear].endBillDiscount += endBillDiscount;
                salesData[monthYear].rounding += rounding;
                salesData[monthYear].billCount += billCount;
            }

            else {
                if (!returnsData[monthYear]) {
                    returnsData[monthYear] = {
                        total: 0,
                        endBillDiscount: 0,
                        rounding: 0,
                        billCount: 0,
                        channels: {},
                    };
                }

                const negativeReturn = -Math.abs(totalSalesRaw);

                returnsData[monthYear].channels[channelName] =
                    (returnsData[monthYear].channels[channelName] || 0) + negativeReturn;

                returnsData[monthYear].total += totalSalesRaw;
                returnsData[monthYear].endBillDiscount += endBillDiscount;
                returnsData[monthYear].rounding += rounding;
                returnsData[monthYear].billCount += billCount;
            }
        }

        /* ========================================================
            4) ประมวลผลและรวมข้อมูลสำหรับ frontend
        ======================================================== */
        const result = Object.keys(salesData).map((monthYear) => {
            const s = salesData[monthYear];
            const r = returnsData[monthYear] || {
                total: 0,
                endBillDiscount: 0,
                rounding: 0,
                billCount: 0,
                channels: {},
            };

            const netSales = s.total + r.total;
            const totalBillCount = s.billCount;
            const salesPerBill = totalBillCount > 0 ? netSales / totalBillCount : 0;

            /* ====== รวมยอดตามช่องทาง ====== */
            const mergedChannels = {};

            Object.entries(s.channels || {}).forEach(([name, total]) => {
                mergedChannels[name] = (mergedChannels[name] || 0) + total;
            });

            Object.entries(r.channels || {}).forEach(([name, total]) => {
                mergedChannels[name] = (mergedChannels[name] || 0) + total;
            });

            const salesChannels = Object.entries(mergedChannels).map(
                ([channelName, total]) => ({
                    channelName,
                    totalSales: Number(total.toFixed(2)),
                })
            );

            /* ⭐⭐ ส่งจำนวนวันจริงไปให้ frontend ⭐⭐ */
            const daysCount = dayMap[monthYear] || 0;

            return {
                monthYear,
                days: daysCount, // 👍 ส่งจำนวนวันจริงให้ frontend

                totalReturns: Number((r.total + r.rounding).toFixed(2)),
                netSales: Number(netSales.toFixed(2)),
                endBillDiscount: Number((s.endBillDiscount + r.endBillDiscount).toFixed(2)),
                rounding: Number((s.rounding + r.rounding).toFixed(2)),
                billCount: s.billCount,
                salesPerBill: Number(salesPerBill.toFixed(2)),
                salesChannels,
            };
        });

        res.json(result);
    } catch (error) {
        console.error("❌ getSearchBranchSales error:", error);
        res.status(500).json({ msg: "❌ error" });
    }
};

exports.getSearchBranchSalesDay = async (req, res) => {
    const { branch_code, date } = req.body;

    try {
        const [monthStr, yearStr] = date.split("/");
        const month = Number(monthStr);
        const year = Number(yearStr);

        const branch = await prisma.branch.findUnique({
            where: { branch_code },
        });
        if (!branch) return res.status(404).json({ msg: "Branch not found" });

        const channels = await prisma.salesChannel.findMany();
        const channelMap = Object.fromEntries(
            channels.map((c) => [c.id, c.channel_name])
        );

        // ⭐ ใช้เวลาไทย
        const rows = await prisma.$queryRaw`
            SELECT
                DATE_TRUNC('day', "date" + INTERVAL '7 hour') AS day,
                "doc_type",
                "salesChannelId",
                SUM("total_sales") AS total_sales,
                SUM("end_bill_discount") AS end_bill_discount,
                SUM("rounding") AS rounding,
                COUNT(id) AS bill_count
            FROM "Bill"
            WHERE "branchId" = ${branch.id}
              AND EXTRACT(YEAR FROM "date" + INTERVAL '7 hour') = ${year}
              AND EXTRACT(MONTH FROM "date" + INTERVAL '7 hour') = ${month}
              AND "doc_type" IN ('เอกสารขาย', 'เอกสารคืน')
            GROUP BY day, "doc_type", "salesChannelId"
            ORDER BY day;
        `;

        const salesData = {};   // ขาย
        const returnsData = {}; // คืน (เพิ่ม channels ด้วย)

        for (const r of rows) {
            const d = new Date(r.day);
            const dayNum = d.getDate();

            const totalSalesRaw = Number(r.total_sales || 0);
            const endBillDiscount = Number(r.end_bill_discount || 0);
            const rounding = Number(r.rounding || 0);
            const billCount = Number(r.bill_count || 0);

            const channelName = channelMap[r.salesChannelId] || "Unknown";

            /* ===============================
                    เอกสารขาย
            =============================== */
            if (r.doc_type === "เอกสารขาย") {
                if (!salesData[dayNum]) {
                    salesData[dayNum] = {
                        total: 0,
                        billCount: 0,
                        endBillDiscount: 0,
                        rounding: 0,
                        channels: {}, // ⭐ เพิ่มช่องทาง
                    };
                }

                salesData[dayNum].channels[channelName] =
                    (salesData[dayNum].channels[channelName] || 0) +
                    totalSalesRaw;

                salesData[dayNum].total += totalSalesRaw;
                salesData[dayNum].endBillDiscount += endBillDiscount;
                salesData[dayNum].rounding += rounding;
                salesData[dayNum].billCount += billCount;
            }

            /* ===============================
                    เอกสารคืน (เป็นยอดลบ)
            =============================== */
            if (r.doc_type === "เอกสารคืน") {
                if (!returnsData[dayNum]) {
                    returnsData[dayNum] = {
                        total: 0,
                        endBillDiscount: 0,
                        rounding: 0,
                        billCount: 0,
                        channels: {}, // ⭐ เพิ่มช่องทาง
                    };
                }

                const negativeReturn = -Math.abs(totalSalesRaw);

                returnsData[dayNum].channels[channelName] =
                    (returnsData[dayNum].channels[channelName] || 0) +
                    negativeReturn;

                returnsData[dayNum].total += totalSalesRaw;
                returnsData[dayNum].endBillDiscount += endBillDiscount;
                returnsData[dayNum].rounding += rounding;
                returnsData[dayNum].billCount += billCount;
            }
        }

        /* ===================================
            สร้างผลลัพธ์ (รวม channel)
        =================================== */
        const result = Object.keys(salesData)
            .sort((a, b) => Number(a) - Number(b))
            .map((day) => {
                const s = salesData[day];
                const r =
                    returnsData[day] || {
                        total: 0,
                        endBillDiscount: 0,
                        rounding: 0,
                        billCount: 0,
                        channels: {},
                    };

                const netSales = s.total + r.total;
                const totalBillCount = s.billCount;

                const salesPerBill =
                    totalBillCount > 0 ? netSales / totalBillCount : 0;

                /* ⭐ รวมยอดช่องทางจากขาย + คืน */
                const mergedChannels = {};

                Object.entries(s.channels || {}).forEach(([name, total]) => {
                    mergedChannels[name] = (mergedChannels[name] || 0) + total;
                });

                Object.entries(r.channels || {}).forEach(([name, total]) => {
                    mergedChannels[name] = (mergedChannels[name] || 0) + total;
                });

                const salesChannels = Object.entries(mergedChannels).map(
                    ([channelName, total]) => ({
                        channelName,
                        totalSales: Number(total.toFixed(2)),
                    })
                );

                return {
                    dayMonthYear: `${day}/${month}/${year}`,

                    /* คืน */
                    totalReturns: Number((r.total + r.rounding).toFixed(2)),

                    netSales: Number(netSales.toFixed(2)),

                    endBillDiscount: Number(
                        (s.endBillDiscount + r.endBillDiscount).toFixed(2)
                    ),
                    rounding: Number(
                        (s.rounding + r.rounding).toFixed(2)
                    ),

                    billCount: s.billCount,

                    salesPerBill: Number(salesPerBill.toFixed(2)),

                    // ⭐ ส่งช่องทางออกไปเหมือนรายเดือน
                    salesChannels,
                };
            });

        res.json(result);
    } catch (err) {
        console.error("❌ getSearchBranchSalesDay error:", err);
        res.status(500).json({ error: "select day error" });
    }
};

exports.getSearchBranchSalesProductMonth = async (req, res) => {
    const { branch_code, date } = req.body; // เช่น "10/2025"

    const cacheKey = `branchSales:productMonth:${branch_code || "none"}:${date || "none"}`;
    const cached = salesCache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const [monthStr, yearStr] = date.split("/");
        const month = Number(monthStr);
        const year = Number(yearStr);

        const branch = await prisma.branch.findUnique({
            where: { branch_code },
        });
        if (!branch) {
            return res.status(404).json({ msg: "Branch not found" });
        }

        // ✅ ใช้ EXTRACT จาก b.date + 7 ชม. เพื่ออ้างอิงเดือน/ปีแบบเวลาไทย
        const rows = await prisma.$queryRaw`
            SELECT 
                p.product_code,
                p.product_name,
                p.product_brand,
                SUM(
                    CASE 
                        WHEN b.doc_type IN ('เอกสารคืน', 'Return') 
                        THEN bi.quantity ELSE 0 
                    END
                ) AS return_quantity,

                SUM(
                    CASE 
                        WHEN b.doc_type = 'เอกสารขาย' 
                        THEN bi.quantity ELSE 0 
                    END
                ) AS sale_quantity,

                SUM(bi.discount) AS total_discount,
                SUM(bi.net_sales) AS total_net_sales

            FROM "BillItem" bi
            JOIN "Bill" b ON b.id = bi."billId"
            JOIN "Product" p ON p.id = bi."productId"

            WHERE b."branchId" = ${branch.id}
              AND EXTRACT(YEAR FROM b."date" + INTERVAL '7 hour') = ${year}
              AND EXTRACT(MONTH FROM b."date" + INTERVAL '7 hour') = ${month}

            GROUP BY p.product_code, p.product_name, p.product_brand
            ORDER BY p.product_code;
        `;

        salesCache.set(cacheKey, rows);

        res.json(rows);
    } catch (err) {
        console.error("❌ getSearchBranchSalesProductMonth error:", err);
        res.status(500).json({ error: "select branch sales product month error" });
    }
};

exports.getSearchBranchSalesProductDay = async (req, res) => {
    const { branch_code, date } = req.body; // "2/10/2025"

    const cacheKey = `branchSales:productDay:${branch_code || "none"}:${date || "none"}`;
    const cached = salesCache.get(cacheKey);
    if (cached) {
        return res.json(cached);
    }

    try {
        const [dayStr, monthStr, yearStr] = date.split("/");
        const day = Number(dayStr);
        const month = Number(monthStr); // 1–12
        const year = Number(yearStr);

        const branch = await prisma.branch.findUnique({
            where: { branch_code },
        });
        if (!branch) {
            return res.status(404).json({ msg: "Branch not found" });
        }

        // ✅ ใช้ EXTRACT จาก b.date + 7 ชม. ให้ตรงวันไทย
        const rows = await prisma.$queryRaw`
            SELECT
                p.product_code,
                p.product_name,
                p.product_brand,

                SUM(
                    CASE 
                        WHEN b.doc_type IN ('เอกสารคืน', 'Return') 
                        THEN bi.quantity ELSE 0 
                    END
                ) AS return_quantity,

                SUM(
                    CASE
                        WHEN b.doc_type = 'เอกสารขาย'
                        THEN bi.quantity ELSE 0
                    END
                ) AS sale_quantity,

                SUM(bi.discount) AS total_discount,
                SUM(bi.net_sales) AS total_net_sales

            FROM "BillItem" bi
            JOIN "Bill" b ON b.id = bi."billId"
            JOIN "Product" p ON p.id = bi."productId"

            WHERE b."branchId" = ${branch.id}
              AND EXTRACT(YEAR FROM b."date" + INTERVAL '7 hour') = ${year}
              AND EXTRACT(MONTH FROM b."date" + INTERVAL '7 hour') = ${month}
              AND EXTRACT(DAY FROM b."date" + INTERVAL '7 hour') = ${day}

            GROUP BY p.product_code, p.product_name, p.product_brand
            ORDER BY p.product_code;
        `;

        salesCache.set(cacheKey, rows);

        res.json(rows);

    } catch (err) {
        console.error("❌ getSearchBranchSalesProductDay error:", err);
        res.status(500).json({ error: "select product/day error" });
    }
};



// 2. ยอดขายสินค้า
// =========================
// PRODUCT SALES (SEARCH + DETAIL)
// =========================
const convertBigInt = (data) =>
    JSON.parse(
        JSON.stringify(data, (_, value) =>
            typeof value === "bigint" ? Number(value) : value
        )
    );

exports.searchProductSales = async (req, res) => {
    try {
        const { q } = req.query;
        const keyword = (q || "").trim();

        if (!keyword) {
            return res.json({ total: 0, items: [] });
        }

        const products = await prisma.product.findMany({
            where: {
                OR: [
                    {
                        product_name: {
                            contains: keyword,
                            mode: "insensitive",
                        },
                    },
                    {
                        product_brand: {
                            contains: keyword,
                            mode: "insensitive",
                        },
                    },
                    {
                        product_code: {
                            contains: keyword,
                        },
                    },
                ],
            },
            // ✅ ส่งเท่าที่หน้าบ้านใช้
            select: {
                id: true,
                product_code: true,
                product_name: true,
                product_brand: true,
            },
            orderBy: [
                { product_brand: "asc" },
                { product_name: "asc" },
            ],
            take: 50,
        });

        return res.json({
            total: products.length,
            items: products,
        });
    } catch (err) {
        console.error("searchProductSales error:", err);
        res.status(500).json({ error: "product search error" });
    }
};

// cache รายงาน product sales detail (ตาม productId + date range)
const productSalesCache = new NodeCache({
    stdTTL: 28800, // cache 60 วินาที (อยากให้มากกว่านี้ก็ปรับได้ เช่น 300 = 5 นาที)
});

exports.getProductSalesDetail = async (req, res) => {
    try {
        const { productId, start, end } = req.body;

        if (!productId) {
            return res.status(400).json({ error: "productId is required" });
        }

        // key สำหรับ cache (ผูกกับ product + ช่วงวันที่ใช้)
        const cacheKey = `${productId}:${start || "auto"}:${end || "auto"}`;
        const cached = productSalesCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const product = await prisma.product.findUnique({
            where: { id: Number(productId) },
        });

        if (!product) {
            return res.status(404).json({ error: "Product not found" });
        }

        // ถ้าไม่ได้ส่งช่วงวันที่มา → default = 12 เดือนล่าสุด
        let startDate, endDate;
        if (start && end) {
            startDate = new Date(start + "T00:00:00");
            endDate = new Date(end + "T23:59:59");
        } else {
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);

            startDate = new Date(endDate);
            startDate.setMonth(startDate.getMonth() - 11); // 12 เดือนย้อนหลัง
            startDate.setDate(1);
        }

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ error: "invalid date format" });
        }

        // ✅ ตัด JOIN "Product" ทิ้ง ใช้ bi."productId" แทน
        const rowsRaw = await prisma.$queryRaw`
      SELECT
        br."branch_code",
        br."branch_name",
        EXTRACT(YEAR FROM b."date")::int   AS year,
        EXTRACT(MONTH FROM b."date")::int  AS month,

        SUM(
          CASE 
            WHEN b."doc_type" IN ('เอกสารคืน', 'Return')
            THEN bi."quantity" ELSE 0 
          END
        ) AS return_quantity,

        SUM(
          CASE 
            WHEN b."doc_type" = 'เอกสารขาย'
            THEN bi."quantity" ELSE 0 
          END
        ) AS sale_quantity

      FROM "BillItem" bi
      JOIN "Bill"   b  ON b."id" = bi."billId"
      JOIN "Branch" br ON br."id" = b."branchId"

      WHERE b."date" >= ${startDate}
        AND b."date" <= ${endDate}
        AND bi."productId" = ${product.id}

      GROUP BY br."branch_code", br."branch_name", year, month
      ORDER BY year, month, br."branch_code";
    `;

        const rowsConverted = convertBigInt(rowsRaw);

        // ✅ เคลียร์ field ให้เหลือเท่าที่หน้าบ้านใช้จริง
        const rows = rowsConverted.map((r) => ({
            branch_code: r.branch_code,
            branch_name: r.branch_name,
            year: Number(r.year),
            month: Number(r.month),
            sale_quantity: Number(r.sale_quantity || 0),
            return_quantity: Number(r.return_quantity || 0),
        }));

        const responsePayload = {
            product: {
                id: product.id,
                product_code: product.product_code,
                product_name: product.product_name,
                product_brand: product.product_brand,
            },
            range: {
                start: startDate.toISOString().slice(0, 10),
                end: endDate.toISOString().slice(0, 10),
            },
            rows,
        };

        // เก็บลง cache ก่อนส่งกลับ
        productSalesCache.set(cacheKey, responsePayload);

        return res.json(responsePayload);
    } catch (err) {
        console.error("getProductSalesDetail error:", err);
        res.status(500).json({ error: "product sales detail error" });
    }
};






// controllers/admin/member.js

/** -----------------------------
 * Bangkok-safe date helpers
 * ------------------------------*/
const toBangkokUtcRange = (startStr, endStr) => {
  const start = new Date(`${startStr}T00:00:00+07:00`);
  const end = new Date(`${endStr}T23:59:59.999+07:00`);
  return { start, end };
};

const toBkkDayStart = (iso) => new Date(`${iso}T00:00:00+07:00`);

const diffDays = (endISO, startISO) => {
  const end = toBkkDayStart(endISO);
  const start = toBkkDayStart(startISO);
  return Math.max(0, Math.floor((end - start) / 86400000));
};

// DateTime -> YYYY-MM-DD ในเวลา Bangkok
const toISODateBkk = (dateObj) => {
  if (!dateObj) return null;
  const d = new Date(dateObj);
  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const dd = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !dd) return null;
  return `${y}-${m}-${dd}`;
};

const safeDiv = (a, b) => {
  const x = Number(a || 0);
  const y = Number(b || 0);
  return y === 0 ? 0 : x / y;
};

// ตรวจบิลคืน (รองรับชื่อไทย/อังกฤษแบบคร่าว ๆ)
const isReturnDoc = (docType) => {
  const s = String(docType || "").toLowerCase();
  return s.includes("คืน") || s.includes("return") || s.includes("refund");
};

/**
 * POST /sales-member
 * body:
 * {
 *   startDate: "YYYY-MM-DD",
 *   endDate: "YYYY-MM-DD",
 *   customerId?: number  // ส่งมาด้วย => detail
 * }
 */
exports.getCustomers = async (req, res) => {
  try {
    const { startDate, endDate, customerId } = req.body || {};
    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        message: "ต้องส่ง startDate และ endDate (YYYY-MM-DD)",
      });
    }

    const { start, end } = toBangkokUtcRange(startDate, endDate);

    // =========================
    // DETAIL MODE (เฉพาะช่วงที่เลือก)
    // =========================
    if (customerId) {
      const custId = Number(customerId);

      const customer = await prisma.customer.findUnique({
        where: { id: custId },
        select: { id: true, customer_code: true, customer_name: true },
      });
      if (!customer) {
        return res.status(404).json({ ok: false, message: "ไม่พบลูกค้า" });
      }

      // bills in range เท่านั้น (ไม่ดึงทั้งชีวิต)
      const bills = await prisma.bill.findMany({
        where: {
          customerId: custId,
          date: { gte: start, lte: end },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          bill_number: true,
          date: true,
          doc_type: true,
          total_payment: true,
          branch: { select: { branch_code: true, branch_name: true } },
          salesChannel: { select: { channel_code: true, channel_name: true } },
          payments: {
            select: {
              id: true,
              amount: true,
              payment_method: true,
              bank: true,
              reference_number: true,
            },
            orderBy: { id: "asc" },
          },
        },
      });

      const visits = bills.length;

      let salesAmount = 0;
      let returnAmount = 0;

      const visitsRows = bills.map((b) => {
        const absAmt = Math.abs(Number(b.total_payment || 0));
        const ret = isReturnDoc(b.doc_type);

        if (ret) returnAmount += absAmt;
        else salesAmount += absAmt;

        return {
          billId: b.id,
          billNumber: b.bill_number,
          date: b.date,
          docType: b.doc_type,
          isReturn: ret,

          amountRaw: Number(b.total_payment || 0),
          amountNet: ret ? -absAmt : absAmt,

          branch: b.branch,
          channel: b.salesChannel,
          payments: (b.payments || []).map((p) => ({
            id: p.id,
            amount: Number(p.amount || 0),
            method: p.payment_method || null,
            bank: p.bank || null,
            ref: p.reference_number || null,
          })),
        };
      });

      const netAmount = salesAmount - returnAmount;
      const lastVisitInRange = bills.length ? bills[bills.length - 1].date : null;

      // absentDays:
      // - ถ้ามี lastVisitInRange: end - lastVisitInRange (ไม่รวมวันล่าสุด)
      // - ถ้าไม่มีเลยในช่วง: end - start + 1 (ขาดทั้งช่วง)
      const lastInRangeISO = toISODateBkk(lastVisitInRange);
      const absentDays =
        lastInRangeISO ? diffDays(endDate, lastInRangeISO) : diffDays(endDate, startDate) + 1;

      return res.json({
        ok: true,
        mode: "detail",
        meta: { startDate, endDate },
        customer,
        totals: {
          visits,
          salesAmount,
          returnAmount,
          netAmount,
          avgNetPerVisit: safeDiv(netAmount, visits),
          lastVisitInRange,
          absentDays,
        },
        visits: visitsRows,
      });
    }

    // =========================
    // SUMMARY MODE (เฉพาะช่วงที่เลือก)
    // ✅ ไม่ group ทั้งชีวิตแล้ว
    // ✅ WHERE date อยู่ในช่วงเท่านั้น
    // =========================

    const rows = await prisma.$queryRaw`
      SELECT
        c.id AS "customerId",
        c.customer_code AS "customer_code",
        c.customer_name AS "customer_name",

        COUNT(*)::int AS "visits",
        MAX(b.date) AS "lastVisitInRange",

        SUM(
          CASE
            WHEN NOT (
              LOWER(COALESCE(b.doc_type,'')) LIKE '%คืน%'
              OR LOWER(COALESCE(b.doc_type,'')) LIKE '%return%'
              OR LOWER(COALESCE(b.doc_type,'')) LIKE '%refund%'
            )
            THEN ABS(COALESCE(b.total_payment, 0))
            ELSE 0
          END
        ) AS "salesAmount",

        SUM(
          CASE
            WHEN (
              LOWER(COALESCE(b.doc_type,'')) LIKE '%คืน%'
              OR LOWER(COALESCE(b.doc_type,'')) LIKE '%return%'
              OR LOWER(COALESCE(b.doc_type,'')) LIKE '%refund%'
            )
            THEN ABS(COALESCE(b.total_payment, 0))
            ELSE 0
          END
        ) AS "returnAmount",

        SUM(
          CASE
            WHEN (
              LOWER(COALESCE(b.doc_type,'')) LIKE '%คืน%'
              OR LOWER(COALESCE(b.doc_type,'')) LIKE '%return%'
              OR LOWER(COALESCE(b.doc_type,'')) LIKE '%refund%'
            )
            THEN -ABS(COALESCE(b.total_payment, 0))
            ELSE  ABS(COALESCE(b.total_payment, 0))
          END
        ) AS "netAmount"

      FROM "Bill" b
      JOIN "Customer" c ON c.id = b."customerId"
      WHERE b."customerId" IS NOT NULL
        AND b.date >= ${start}
        AND b.date <= ${end}
      GROUP BY c.id, c.customer_code, c.customer_name
      ORDER BY c.id ASC;
    `;

    const finalRows = rows.map((r) => {
      const visits = Number(r.visits || 0);
      const netAmount = Number(r.netAmount || 0);

      const lastInRangeISO = toISODateBkk(r.lastVisitInRange);
      // ใน summary จะมี lastVisitInRange อยู่แล้ว (เพราะมีบิลในช่วง)
      const absentDays = lastInRangeISO ? diffDays(endDate, lastInRangeISO) : diffDays(endDate, startDate) + 1;

      return {
        customerId: Number(r.customerId),
        customer_code: r.customer_code,
        customer_name: r.customer_name,

        visits,
        lastVisitInRange: r.lastVisitInRange,

        salesAmount: Number(r.salesAmount || 0),
        returnAmount: Number(r.returnAmount || 0),
        netAmount,

        avgNetPerVisit: safeDiv(netAmount, visits),
        absentDays,
      };
    });

    const customers = finalRows.length;
    const totalVisits = finalRows.reduce((s, r) => s + Number(r.visits || 0), 0);
    const totalSales = finalRows.reduce((s, r) => s + Number(r.salesAmount || 0), 0);
    const totalReturn = finalRows.reduce((s, r) => s + Number(r.returnAmount || 0), 0);
    const totalNet = finalRows.reduce((s, r) => s + Number(r.netAmount || 0), 0);

    return res.json({
      ok: true,
      mode: "summary",
      meta: { startDate, endDate },
      totals: {
        customers, // ✅ ลูกค้าที่มีบิลในช่วงนี้เท่านั้น
        visits: totalVisits,
        salesAmount: totalSales,
        returnAmount: totalReturn,
        netAmount: totalNet,
        avgNetPerVisitAll: safeDiv(totalNet, totalVisits),
      },
      rows: finalRows,
    });
  } catch (err) {
    console.error("getCustomers error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: String(err?.message || err),
    });
  }
};
