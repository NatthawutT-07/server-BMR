// controllers/admin/<your-file>.js
const prisma = require("../../config/prisma");
const NodeCache = require("node-cache");

// cache (ตอนนี้ตั้งไว้ 5 วิ)
const cache = new NodeCache({ stdTTL: 5 });

/**
 * Helper: แปลง "ช่วงเดือนตามเวลาไทย" → เป็นช่วงเวลา UTC (Date)
 * - year: ปี (เช่น 2025)
 * - month: เดือน 1–12
 *
 * Thai start  = YYYY-MM-01 00:00:00 ที่โซน Asia/Bangkok
 * Thai end    = วันสุดท้ายของเดือนนั้น 23:59:59.999 ที่โซน Asia/Bangkok
 * แล้วแปลงเป็น UTC ทั้งคู่ → ใช้ใน WHERE b."date"
 */
const getMonthRangeUtcFromBangkok = (year, month) => {
  const mm = String(month).padStart(2, "0");
  const startLocal = new Date(`${year}-${mm}-01T00:00:00+07:00`);

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth === 13) {
    nextMonth = 1;
    nextYear += 1;
  }
  const nextMm = String(nextMonth).padStart(2, "0");
  const nextMonthLocal = new Date(`${nextYear}-${nextMm}-01T00:00:00+07:00`);

  const endLocal = new Date(nextMonthLocal.getTime() - 1);

  return {
    startUtc: startLocal,
    endUtc: endLocal,
  };
};

/**
 * Helper: คืนค่า meta ของเดือนตามเวลาไทย
 */
const getBangkokMonthMeta = () => {
  const now = new Date();
  const bangkokNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));

  const currentYear = bangkokNow.getFullYear();
  const currentMonth = bangkokNow.getMonth() + 1; // 1–12

  const { startUtc: currentMonthStartUtc, endUtc: currentMonthEndUtc } =
    getMonthRangeUtcFromBangkok(currentYear, currentMonth);

  const prevMonths = [];
  for (let i = 1; i <= 3; i++) {
    let y = currentYear;
    let m = currentMonth - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }

    const { startUtc, endUtc } = getMonthRangeUtcFromBangkok(y, m);

    prevMonths.push({
      year: y,
      month: m,
      startUtc,
      endUtc,
    });
  }

  return {
    currentYear,
    currentMonth,
    currentMonthStartUtc,
    currentMonthEndUtc,
    prevMonths,
  };
};

// ✅ แปลง Date ที่ Prisma ตีความเป็น UTC (แต่จริง ๆ คือเวลาไทยใน DB)
// ให้กลายเป็น ISO ที่ติด +07:00 เพื่อให้แสดงตรงกับ DB
const toBangkokOffsetISOString = (val) => {
  if (!val) return null;

  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return null;

  const pad2 = (n) => String(n).padStart(2, "0");
  const pad3 = (n) => String(n).padStart(3, "0");

  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  const ms = pad3(d.getUTCMilliseconds());

  return `${y}-${m}-${day}T${hh}:${mm}:${ss}.${ms}+07:00`;
};

// ======================================================
// ✅ NEW: ดึงเวลาอัปเดต Stock ล่าสุด (แค่ 1 ค่าไว้โชว์)
// ต้องมี Prisma model: DataSync { key @id, updatedAt, rowCount? }
// ======================================================
exports.getStockLastUpdate = async (req, res) => {
  try {
    const row = await prisma.dataSync.findUnique({ where: { key: "stock" } });

    return res.json({
      updatedAt: row?.updatedAt ? toBangkokOffsetISOString(row.updatedAt) : null,
      rowCount: row?.rowCount || 0,
    });
  } catch (error) {
    console.error("❌ getStockLastUpdate error:", error);
    return res.status(500).json({ msg: "❌ Failed to load stock last update" });
  }
};

// ======================================================
// ✅ UserTemplateItem
// - ส่ง branchName แค่ครั้งเดียว (meta)
// - JOIN Tamplate เพื่อเอา fullName (ชื่อ shelf)
// ======================================================
exports.UserTemplateItem = async (req, res) => {
  const { branchCode } = req.body;

  if (!branchCode) {
    return res.status(400).json({ msg: "❌ branchCode is required" });
  }

  const { currentYear, currentMonth } = getBangkokMonthMeta();

  // key cache ผูกกับ branch + เดือนปี (กันการ reuse ข้ามเดือน)
  const key = `template-item-v4-${branchCode}-${currentYear}-${currentMonth}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    // ✅ ดึงชื่อสาขา "ครั้งเดียว" ไม่ต้องซ้ำในทุกแถว
    const br = await prisma.branch.findUnique({
      where: { branch_code: branchCode },
      select: { branch_code: true, branch_name: true },
    });

    const rawResult = await prisma.$queryRaw`
      SELECT 
          s."branchCode",
          s."codeProduct",
          s."shelfCode",
          s."rowNo",
          s."index",

          -- ✅ ชื่อ shelf จาก Tamplate
          t."fullName" AS "fullName",

          p."nameProduct",
          p."nameBrand",
          p."shelfLife",
          p."salesPriceIncVAT",
          p."barcode",
          im."minStore",
          im."maxStore",

          -- 🟢 Stock ปัจจุบัน
          COALESCE(st."stockQuantity", 0)::int AS "stockQuantity"

      FROM "Sku" s

      -- ✅ Tamplate (ชื่อ shelf)
      LEFT JOIN "Tamplate" t
        ON t."branchCode" = s."branchCode"
       AND t."shelfCode"  = s."shelfCode"

      -- Stock ปัจจุบัน (ตามตาราง Stock)
      LEFT JOIN (
          SELECT "branchCode", "codeProduct",
              SUM("quantity")::int AS "stockQuantity"
          FROM "Stock"
          WHERE "branchCode" = ${branchCode}
          GROUP BY "branchCode", "codeProduct"
      ) st 
      ON s."branchCode" = st."branchCode" 
      AND s."codeProduct" = st."codeProduct"

      -- ข้อมูลสินค้า
      LEFT JOIN "ListOfItemHold" p 
          ON s."codeProduct" = p."codeProduct"

      -- Min / Max
      LEFT JOIN "ItemMinMax" im 
          ON s."branchCode" = im."branchCode" 
          AND s."codeProduct" = im."codeProduct"

      WHERE s."branchCode" = ${branchCode}
      ORDER BY s."shelfCode", s."index", s."rowNo"
    `;

    const items = rawResult.map((r) => ({
      branchCode: r.branchCode,
      shelfCode: r.shelfCode,
      rowNo: r.rowNo,
      index: r.index,

      // ✅ ชื่อ shelf จาก Tamplate
      fullName: r.fullName ?? null,

      codeProduct:
        r.codeProduct !== null && r.codeProduct !== undefined ? Number(r.codeProduct) : null,

      nameProduct: r.nameProduct ?? null,
      nameBrand: r.nameBrand ?? null,
      shelfLife: r.shelfLife ?? null,

      salesPriceIncVAT:
        r.salesPriceIncVAT !== null && r.salesPriceIncVAT !== undefined
          ? Number(r.salesPriceIncVAT)
          : null,

      barcode: r.barcode ?? null,

      minStore: r.minStore !== null && r.minStore !== undefined ? Number(r.minStore) : null,
      maxStore: r.maxStore !== null && r.maxStore !== undefined ? Number(r.maxStore) : null,

      stockQuantity: Number(r.stockQuantity ?? 0),
    }));

    // ✅ ส่ง branchName แค่ครั้งเดียว
    const payload = {
      branchCode,
      branchName: br?.branch_name ?? null,
      items,
    };

    cache.set(key, payload);
    return res.json(payload);
  } catch (error) {
    console.error("❌ UserTemplateItem error:", error);
    return res.status(500).json({ msg: "❌ Failed to load data" });
  }
};

// exports.UserTemplateItem = async (req, res) => {
//     const { branchCode } = req.body;

//     if (!branchCode) {
//         return res.status(400).json({ msg: "❌ branchCode is required" });
//     }

//     const {
//         currentYear,
//         currentMonth,
//         currentMonthStartUtc,
//         currentMonthEndUtc,
//         prevMonths,
//     } = getBangkokMonthMeta();

//     // key cache ผูกกับ branch + เดือนปี (กันการ reuse ข้ามเดือน)
//     const key = `template-item-v2-${branchCode}-${currentYear}-${currentMonth}`;
//     const cached = cache.get(key);
//     if (cached) {
//         return res.json(cached);
//     }

//     try {
//         const rawResult = await prisma.$queryRaw`
//       SELECT 
//           s."branchCode",
//           s."codeProduct",
//           s."shelfCode",
//           s."rowNo",
//           s."index",
//           p."nameProduct",
//           p."nameBrand",
//           p."shelfLife",
//           p."salesPriceIncVAT",
//           p."barcode",
//           im."minStore",
//           im."maxStore",

//           -- 🟢 Stock ปัจจุบัน
//           COALESCE(st."stockQuantity", 0)::int AS "stockQuantity",

//           -- 🟢 ยอดขาย 3 เดือนก่อนหน้า (ตามเดือนเวลาไทย)
//           COALESCE(p3."sales3mQty", 0)::int AS "sales3mQty",

//           -- 🟢 ยอดขายเดือนปัจจุบันเท่านั้น (ตามเดือนเวลาไทย)
//           COALESCE(cm."salesCurrentMonthQty", 0)::int AS "salesCurrentMonthQty",

//           -- 🟢 Withdraw (เฉพาะ docStatus = 'อนุมัติแล้ว')
//           COALESCE(wd."withdrawQuantity", 0)::int AS "withdrawQuantity"

//       FROM "Sku" s

//       -- Stock ปัจจุบัน (ตามตาราง Stock)
//       LEFT JOIN (
//           SELECT "branchCode", "codeProduct",
//               SUM("quantity")::int AS "stockQuantity"
//           FROM "Stock"
//           WHERE "branchCode" = ${branchCode}
//           GROUP BY "branchCode", "codeProduct"
//       ) st 
//       ON s."branchCode" = st."branchCode" 
//       AND s."codeProduct" = st."codeProduct"

//       -- 🟢 Sales 3 เดือนก่อนหน้า จาก Bill / BillItem (รวมทุก channel)
//       LEFT JOIN (
//           SELECT 
//               br."branch_code"            AS "branchCode",
//               (prod."product_code")::int  AS "codeProduct",
//               SUM(bi."quantity")::int     AS "sales3mQty"
//           FROM "BillItem" bi
//           JOIN "Bill" b
//               ON bi."billId" = b."id"
//           JOIN "Branch" br
//               ON b."branchId" = br."id"
//           JOIN "Product" prod
//               ON bi."productId" = prod."id"
//           WHERE br."branch_code" = ${branchCode}
//             AND (
//                   (
//                       b."date" >= ${prevMonths[0].startUtc}
//                       AND b."date" <= ${prevMonths[0].endUtc}
//                   )
//                   OR
//                   (
//                       b."date" >= ${prevMonths[1].startUtc}
//                       AND b."date" <= ${prevMonths[1].endUtc}
//                   )
//                   OR
//                   (
//                       b."date" >= ${prevMonths[2].startUtc}
//                       AND b."date" <= ${prevMonths[2].endUtc}
//                   )
//             )
//           GROUP BY 
//               br."branch_code",
//               (prod."product_code")::int
//       ) p3
//       ON s."branchCode" = p3."branchCode" 
//       AND s."codeProduct" = p3."codeProduct"

//       -- 🟢 Sales เดือนปัจจุบัน จาก Bill / BillItem
//       LEFT JOIN (
//           SELECT 
//               br."branch_code"            AS "branchCode",
//               (prod."product_code")::int  AS "codeProduct",
//               SUM(bi."quantity")::int     AS "salesCurrentMonthQty"
//           FROM "BillItem" bi
//           JOIN "Bill" b
//               ON bi."billId" = b."id"
//           JOIN "Branch" br
//               ON b."branchId" = br."id"
//           JOIN "Product" prod
//               ON bi."productId" = prod."id"
//           WHERE br."branch_code" = ${branchCode}
//             AND b."date" >= ${currentMonthStartUtc}
//             AND b."date" <= ${currentMonthEndUtc}
//           GROUP BY 
//               br."branch_code",
//               (prod."product_code")::int
//       ) cm
//       ON s."branchCode" = cm."branchCode" 
//       AND s."codeProduct" = cm."codeProduct"

//       -- 🟢 Withdraw: เฉพาะ docStatus = 'อนุมัติแล้ว'
//       LEFT JOIN (
//           SELECT 
//               "branchCode",
//               "codeProduct",
//               SUM("quantity")::int AS "withdrawQuantity"
//           FROM "withdraw"
//           WHERE "branchCode" = ${branchCode}
//             AND "docStatus" = 'อนุมัติแล้ว'
//           GROUP BY "branchCode", "codeProduct"
//       ) wd
//       ON s."branchCode" = wd."branchCode"
//       AND s."codeProduct" = wd."codeProduct"

//       -- ข้อมูลสินค้า
//       LEFT JOIN "ListOfItemHold" p 
//           ON s."codeProduct" = p."codeProduct"

//       -- Min / Max
//       LEFT JOIN "ItemMinMax" im 
//           ON s."branchCode" = im."branchCode" 
//           AND s."codeProduct" = im."codeProduct"

//       WHERE s."branchCode" = ${branchCode}
//       ORDER BY s."shelfCode", s."index", s."rowNo"
//     `;

//         const result = rawResult.map((r) => {
//             const sales3mQty = Number(r.sales3mQty ?? 0);
//             const sales3mAvgQty = sales3mQty / 3; // เฉลี่ย 3 เดือน
//             const salesTargetQty = sales3mAvgQty * 0.8; // 80% ของ avg

//             return {
//                 branchCode: r.branchCode,
//                 shelfCode: r.shelfCode,
//                 rowNo: r.rowNo,
//                 index: r.index,

//                 codeProduct:
//                     r.codeProduct !== null && r.codeProduct !== undefined ? Number(r.codeProduct) : null,

//                 nameProduct: r.nameProduct ?? null,
//                 nameBrand: r.nameBrand ?? null,
//                 shelfLife: r.shelfLife ?? null,

//                 salesPriceIncVAT:
//                     r.salesPriceIncVAT !== null && r.salesPriceIncVAT !== undefined
//                         ? Number(r.salesPriceIncVAT)
//                         : null,

//                 barcode: r.barcode ?? null,

//                 minStore: r.minStore !== null && r.minStore !== undefined ? Number(r.minStore) : null,
//                 maxStore: r.maxStore !== null && r.maxStore !== undefined ? Number(r.maxStore) : null,

//                 stockQuantity: Number(r.stockQuantity ?? 0),

//                 // 🔹 ยอดขาย 3 เดือนก่อนหน้า (รวม 3 เดือน)
//                 sales3mQty,

//                 // 🔹 target = 80% ของ avg (ไปปัด int ที่หน้าบ้าน)
//                 salesTargetQty,

//                 // 🔹 ยอดขายเดือนปัจจุบันเท่านั้น
//                 salesCurrentMonthQty: Number(r.salesCurrentMonthQty ?? 0),

//                 // 🔹 Withdraw (เฉพาะอนุมัติแล้ว)
//                 withdrawQuantity: Number(r.withdrawQuantity ?? 0),
//             };
//         });

//         cache.set(key, result);
//         return res.json(result);
//     } catch (error) {
//         console.error("❌ UserTemplateItem error:", error);
//         return res.status(500).json({ msg: "❌ Failed to load data" });
//     }
// };
