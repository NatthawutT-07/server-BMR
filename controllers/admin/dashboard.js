// controllers/admin/dashboard.js
const prisma = require("../../config/prisma");
const NodeCache = require("node-cache");

// คำนวณ TTL เหลือจนถึงเที่ยงคืนตามเวลาไทย
const getMidnightTTL = () => {
  const now = new Date();
  const bangkokNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const midnight = new Date(bangkokNow);
  midnight.setHours(24, 0, 0, 0); // ไปเที่ยงคืนของวันถัดไป
  const ttlSeconds = Math.floor((midnight - bangkokNow) / 1000);
  return ttlSeconds;
};

const cache = new NodeCache();

const convertBigInt = (data) =>
  JSON.parse(JSON.stringify(data, (_, value) => (typeof value === "bigint" ? Number(value) : value)));

const getDashboardCacheVersion = async () => {
  try {
    const row = await prisma.dataSync.findUnique({ where: { key: "dashboard" } });
    return row?.updatedAt ? row.updatedAt.toISOString() : "none";
  } catch (err) {
    console.error("Dashboard cache version error:", err);
    return "none";
  }
};

// ✅ normalize query date ให้เหลือ YYYY-MM-DD กันเคสส่ง ISO มาแล้วเพี้ยน -1 วัน
const onlyISODate = (v) => String(v || "").slice(0, 10);
const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

/**
 * ================================
 *   Helper: แปลงช่วงวันไทย → ช่วงเวลา UTC
 * ================================
 */
const getBangkokUtcRange = (startStr, endStr) => {
  const start = new Date(startStr + "T00:00:00+07:00"); // ตี 0 เวลาไทย
  const end = new Date(endStr + "T23:59:59.999+07:00"); // สิ้นวันไทย
  return { start, end };
};

const getBangkokYearRangeUtc = (year) => {
  const start = new Date(`${year}-01-01T00:00:00.000+07:00`);
  const end = new Date(`${year}-12-31T23:59:59.999+07:00`);
  return { startUtc: start, endUtc: end };
};

// ยอดตามวันที่ (รวมทุก doc_type แล้วเก็บ count แยกไว้ด้วย)
const getSalesByDate = async (startUtc, endUtc) => {
  return prisma.$queryRaw`
    SELECT
      (b."date" + INTERVAL '7 hour')::date AS bill_date,
      COALESCE(SUM(b."total_sales"), 0)           AS total_payment,
      COALESCE(SUM(b."rounding"), 0)              AS rounding_sum,
      COALESCE(SUM(b."end_bill_discount"), 0)     AS discount_sum,
      COUNT(*)                                    AS bill_count,
      COALESCE(SUM(CASE WHEN b."doc_type" = 'เอกสารขาย' THEN 1 ELSE 0 END), 0)  AS sale_count,
      COALESCE(SUM(CASE WHEN b."doc_type" = 'เอกสารคืน' THEN 1 ELSE 0 END), 0)  AS return_count
    FROM "Bill" b
    WHERE b."date" >= ${startUtc}
      AND b."date" <= ${endUtc}
    GROUP BY (b."date" + INTERVAL '7 hour')::date
    ORDER BY bill_date
  `;
};

// ยอดตามสาขา + วันที่
const getSalesByBranchAndDate = async (startUtc, endUtc) => {
  return prisma.$queryRaw`
    SELECT 
      (b."date" + INTERVAL '7 hour')::date AS bill_date,
      br."branch_name",
      br."branch_code",
      COALESCE(SUM(b."total_sales"), 0) AS total_payment
    FROM "Bill" b
    JOIN "Branch" br ON br."id" = b."branchId"
    WHERE b."date" >= ${startUtc}
      AND b."date" <= ${endUtc}
    GROUP BY (b."date" + INTERVAL '7 hour')::date,
             br."branch_name",
             br."branch_code"
    ORDER BY bill_date, br."branch_name"
  `;
};

// ✅ ยอด “ชำระรวม” ตามช่องทางขาย + วันที่
const getSalesByChannelAndDate = async (startUtc, endUtc) => {
  return prisma.$queryRaw`
    WITH bills_in_range AS (
      SELECT
        b."id" AS bill_id,
        b."date" AS bill_dt,
        b."salesChannelId" AS sales_channel_id,
        b."total_payment" AS total_payment
      FROM "Bill" b
      WHERE b."date" >= ${startUtc}
        AND b."date" <= ${endUtc}
    ),
    bp_dedup AS (
      SELECT DISTINCT
        bp."billId" AS bill_id,
        bp."amount" AS amount,
        COALESCE(NULLIF(TRIM(bp."payment_method"), ''), 'Unknown') AS payment_method,
        COALESCE(NULLIF(TRIM(bp."bank"), ''), '') AS bank,
        COALESCE(NULLIF(TRIM(bp."reference_number"), ''), '') AS reference_number
      FROM "BillPayment" bp
      JOIN bills_in_range bir ON bir.bill_id = bp."billId"
    ),
    bill_pay AS (
      SELECT
        bir.bill_id,
        bir.bill_dt,
        bir.sales_channel_id,
        COALESCE(SUM(d."amount"), bir.total_payment) AS pay_amount
      FROM bills_in_range bir
      LEFT JOIN bp_dedup d ON d.bill_id = bir.bill_id
      GROUP BY bir.bill_id, bir.bill_dt, bir.sales_channel_id, bir.total_payment
    )
    SELECT
      (bp."bill_dt" + INTERVAL '7 hour')::date AS bill_date,
      sc."channel_name",
      sc."channel_code",
      COALESCE(SUM(bp."pay_amount"), 0) AS total_payment
    FROM bill_pay bp
    JOIN "SalesChannel" sc ON sc."id" = bp."sales_channel_id"
    GROUP BY
      (bp."bill_dt" + INTERVAL '7 hour')::date,
      sc."channel_name",
      sc."channel_code"
    ORDER BY bill_date, sc."channel_name"
  `;
};

// ✅ ยอด “ชำระ” แยกตามช่องทาง + payment_method + วันที่
const getSalesByChannelAndPaymentMethodDate = async (startUtc, endUtc) => {
  return prisma.$queryRaw`
    WITH bills_in_range AS (
      SELECT
        b."id" AS bill_id,
        b."date" AS bill_dt,
        b."salesChannelId" AS sales_channel_id,
        b."total_payment" AS total_payment
      FROM "Bill" b
      WHERE b."date" >= ${startUtc}
        AND b."date" <= ${endUtc}
    ),
    bp_dedup AS (
      SELECT DISTINCT
        bp."billId" AS bill_id,
        bp."amount" AS amount,
        COALESCE(NULLIF(TRIM(bp."payment_method"), ''), 'Unknown') AS payment_method,
        COALESCE(NULLIF(TRIM(bp."bank"), ''), '') AS bank,
        COALESCE(NULLIF(TRIM(bp."reference_number"), ''), '') AS reference_number
      FROM "BillPayment" bp
      JOIN bills_in_range bir ON bir.bill_id = bp."billId"
    ),
    bill_pay_method AS (
      SELECT
        bir.bill_id,
        bir.bill_dt,
        bir.sales_channel_id,
        COALESCE(d.payment_method, 'Unknown') AS payment_method,
        COALESCE(SUM(d.amount), bir.total_payment) AS pay_amount
      FROM bills_in_range bir
      LEFT JOIN bp_dedup d ON d.bill_id = bir.bill_id
      GROUP BY
        bir.bill_id,
        bir.bill_dt,
        bir.sales_channel_id,
        COALESCE(d.payment_method, 'Unknown'),
        bir.total_payment
    )
    SELECT
      (x."bill_dt" + INTERVAL '7 hour')::date AS bill_date,
      sc."channel_name",
      sc."channel_code",
      x."payment_method",
      COALESCE(SUM(x."pay_amount"), 0) AS total_payment
    FROM bill_pay_method x
    JOIN "SalesChannel" sc ON sc."id" = x."sales_channel_id"
    GROUP BY
      (x."bill_dt" + INTERVAL '7 hour')::date,
      sc."channel_name",
      sc."channel_code",
      x."payment_method"
    ORDER BY bill_date, sc."channel_name", x."payment_method"
  `;
};

// --------------------------------------
//  MAIN: /api/dashboard-data
// --------------------------------------
exports.getDashboardData = async (req, res) => {
  try {
    let { start, end } = req.query;

    start = onlyISODate(start);
    end = onlyISODate(end);

    if (!isISODate(start) || !isISODate(end)) {
      return res.status(400).json({
        error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)",
      });
    }

    const version = await getDashboardCacheVersion();
    const cacheKey = `dashboard:${start}:${end}:${version}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { start: startUtc, end: endUtc } = getBangkokUtcRange(start, end);

    const [
      salesByDateRaw,
      salesByBranchDateRaw,
      salesByChannelDateRaw,
      salesByChannelPaymentMethodDateRaw,
    ] = await Promise.all([
      getSalesByDate(startUtc, endUtc),
      getSalesByBranchAndDate(startUtc, endUtc),
      getSalesByChannelAndDate(startUtc, endUtc),
      getSalesByChannelAndPaymentMethodDate(startUtc, endUtc),
    ]);

    const salesByDate = convertBigInt(salesByDateRaw);
    const salesByBranchDate = convertBigInt(salesByBranchDateRaw);
    const salesByChannelDate = convertBigInt(salesByChannelDateRaw);
    const salesByChannelPaymentMethodDate = convertBigInt(salesByChannelPaymentMethodDateRaw);

    // summary รวม
    const summaryAgg = salesByDate.reduce(
      (acc, row) => {
        acc.total_payment += Number(row.total_payment || 0);
        acc.rounding_sum += Number(row.rounding_sum || 0);
        acc.discount_sum += Number(row.discount_sum || 0);
        acc.bill_count += Number(row.bill_count || 0);
        acc.sale_count += Number(row.sale_count || 0);
        acc.return_count += Number(row.return_count || 0);
        return acc;
      },
      {
        total_payment: 0,
        rounding_sum: 0,
        discount_sum: 0,
        bill_count: 0,
        sale_count: 0,
        return_count: 0,
      }
    );

    const saleBillCount = summaryAgg.sale_count; // เฉพาะเอกสารขาย
    const totalBillCount = summaryAgg.bill_count; // ขาย+คืนทั้งหมด

    const finalSummary = {
      total_payment: summaryAgg.total_payment,
      rounding_sum: summaryAgg.rounding_sum,
      discount_sum: summaryAgg.discount_sum,
      bill_count: saleBillCount,
      net_bill_count: totalBillCount,
    };

    const result = {
      summary: finalSummary,
      salesByDate,
      salesByBranchDate,
      salesByChannelDate,
      salesByChannelPaymentMethodDate,
    };

    cache.set(cacheKey, result, getMidnightTTL());
    return res.json(result);
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "dashboard error" });
  }
};

// ---------------------------
// ดึงยอดขายตามสินค้า (ทุกตัว)
// ---------------------------
const getAllProducts = async (start, end) => {
  return prisma.$queryRaw`
    SELECT
      p."product_code",
      p."product_name",
      p."product_brand",
      lih."groupName" AS "groupName",
      COALESCE(SUM(bi."quantity"), 0)   AS qty,
      COALESCE(SUM(bi."net_sales"), 0)  AS sales,
      COALESCE(SUM(bi."discount"), 0)   AS discount_total
    FROM "BillItem" bi
    JOIN "Bill" b     ON b."id" = bi."billId"
    JOIN "Product" p  ON p."id" = bi."productId"
    LEFT JOIN "ListOfItemHold" lih
      ON lih."codeProduct" =
         NULLIF(regexp_replace(p."product_code", '[^0-9]', '', 'g'), '')::int
    WHERE b."date" >= ${start} AND b."date" <= ${end}
    GROUP BY
      p."product_code",
      p."product_name",
      p."product_brand",
      lih."groupName"
    ORDER BY sales DESC
  `;
};

// --------------------------------------
//  GET /api/dashboard-product-list
// --------------------------------------
exports.getDashboardProductList = async (req, res) => {
  try {
    let { start, end } = req.query;

    start = onlyISODate(start);
    end = onlyISODate(end);

    if (!isISODate(start) || !isISODate(end)) {
      return res.status(400).json({
        error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)",
      });
    }

    const version = await getDashboardCacheVersion();
    const cacheKey = `dashboard:product:${start}:${end}:${version}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { start: startDate, end: endDate } = getBangkokUtcRange(start, end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)",
      });
    }

    const currentYear = Number(end.slice(0, 4));
    const prevYear = currentYear - 1;

    const selectionStart = startDate;
    const selectionEnd = endDate;

    const getYearIntersectionRange = (year) => {
      const { startUtc: yearStartUtc, endUtc: yearEndUtc } = getBangkokYearRangeUtc(year);

      const rangeStart = selectionStart > yearStartUtc ? selectionStart : yearStartUtc;
      const rangeEnd = selectionEnd < yearEndUtc ? selectionEnd : yearEndUtc;

      if (rangeStart > rangeEnd) return null;
      return { start: rangeStart, end: rangeEnd };
    };

    const currentRange = getYearIntersectionRange(currentYear);
    const prevRange = getYearIntersectionRange(prevYear);

    const [rowsCurrentRaw, rowsPrevRaw] = await Promise.all([
      currentRange ? getAllProducts(currentRange.start, currentRange.end) : Promise.resolve([]),
      prevRange ? getAllProducts(prevRange.start, prevRange.end) : Promise.resolve([]),
    ]);

    const rowsCurrent = convertBigInt(rowsCurrentRaw);
    const rowsPrev = convertBigInt(rowsPrevRaw);

    const map = new Map();
    const makeKey = (code, brand) => `${code}__${brand || ""}`;

    const ensureRow = (code, name, brand, groupName) => {
      const key = makeKey(code, brand);
      let row = map.get(key);
      if (!row) {
        row = {
          product_code: code,
          product_name: name,
          product_brand: brand,
          groupName: groupName ?? null,
          qty: 0,
          sales: 0,
          discount_total: 0,
        };
        map.set(key, row);
      } else {
        if ((row.groupName == null || row.groupName === "") && groupName) row.groupName = groupName;
      }
      return row;
    };

    let totalProductsCurrent = 0;
    let totalQtyCurrent = 0;
    let totalSalesCurrent = 0;
    let totalDiscountCurrent = 0;

    rowsCurrent.forEach((r) => {
      const code = r.product_code;
      const name = r.product_name;
      const brand = r.product_brand;
      const groupName = r.groupName;

      const qty = Number(r.qty || 0);
      const sales = Number(r.sales || 0);
      const discount = Number(r.discount_total || 0);

      const row = ensureRow(code, name, brand, groupName);

      row.qty = qty;
      row.sales = sales;
      row.discount_total = discount;

      row[`qty_${currentYear}`] = qty;
      row[`sales_${currentYear}`] = sales;
      row[`discount_total_${currentYear}`] = discount;

      totalQtyCurrent += qty;
      totalSalesCurrent += sales;
      totalDiscountCurrent += discount;
    });

    totalProductsCurrent = rowsCurrent.length;

    let totalProductsPrev = 0;
    let totalQtyPrev = 0;
    let totalSalesPrev = 0;
    let totalDiscountPrev = 0;

    rowsPrev.forEach((r) => {
      const code = r.product_code;
      const name = r.product_name;
      const brand = r.product_brand;
      const groupName = r.groupName;

      const qty = Number(r.qty || 0);
      const sales = Number(r.sales || 0);
      const discount = Number(r.discount_total || 0);

      const row = ensureRow(code, name, brand, groupName);

      if (row[`qty_${currentYear}`] === undefined) row[`qty_${currentYear}`] = 0;
      if (row[`sales_${currentYear}`] === undefined) row[`sales_${currentYear}`] = 0;
      if (row[`discount_total_${currentYear}`] === undefined) row[`discount_total_${currentYear}`] = 0;

      row[`qty_${prevYear}`] = qty;
      row[`sales_${prevYear}`] = sales;
      row[`discount_total_${prevYear}`] = discount;

      totalQtyPrev += qty;
      totalSalesPrev += sales;
      totalDiscountPrev += discount;
    });

    totalProductsPrev = rowsPrev.length;

    let mergedRows = Array.from(map.values());

    mergedRows = mergedRows.map((r) => {
      const salesCurrent = Number(r[`sales_${currentYear}`] ?? 0);
      const salesPrev = Number(r[`sales_${prevYear}`] ?? 0);

      const ratioCurrent = totalSalesCurrent > 0 ? salesCurrent / totalSalesCurrent : 0;
      const ratioPrev = totalSalesPrev > 0 ? salesPrev / totalSalesPrev : 0;

      return {
        ...r,
        sales_ratio: ratioCurrent,
        [`sales_ratio_${currentYear}`]: ratioCurrent,
        [`sales_ratio_${prevYear}`]: ratioPrev,
      };
    });

    const summary = {
      currentYear,
      prevYear,
      totalProducts: totalProductsCurrent,
      totalQty: totalQtyCurrent,
      totalSales: totalSalesCurrent,
      totalDiscount: totalDiscountCurrent,

      [`totalProducts_${currentYear}`]: totalProductsCurrent,
      [`totalProducts_${prevYear}`]: rowsPrev.length > 0 ? totalProductsPrev : 0,

      [`totalQty_${currentYear}`]: totalQtyCurrent,
      [`totalQty_${prevYear}`]: rowsPrev.length > 0 ? totalQtyPrev : 0,

      [`totalSales_${currentYear}`]: totalSalesCurrent,
      [`totalSales_${prevYear}`]: rowsPrev.length > 0 ? totalSalesPrev : 0,

      [`totalDiscount_${currentYear}`]: totalDiscountCurrent,
      [`totalDiscount_${prevYear}`]: rowsPrev.length > 0 ? totalDiscountPrev : 0,
    };

    const payload = { summary, rows: mergedRows };

    cache.set(cacheKey, payload, getMidnightTTL());
    return res.json(payload);
  } catch (err) {
    console.error("Dashboard product list error:", err);
    res.status(500).json({ error: "dashboard product list error" });
  }
};
