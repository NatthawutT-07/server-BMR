// controllers/admin/<your-file>.js
const prisma = require("../../config/prisma");
const cacheManager = require("../../utils/cacheManager");
const { normalizeLegacyBangkokStoredDate, toBangkokOffsetISOString } = require("../../utils/dateHelper");
const cache = cacheManager.getCache("user-template", { stdTTL: 60 }); // Increased from 5s to 60s for better performance

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
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type) => parts.find(p => p.type === type).value;
  const bkkYear = parseInt(getPart("year"));
  const bkkMonth = parseInt(getPart("month"));
  const bkkDay = parseInt(getPart("day"));
  const bangkokNow = new Date(`${bkkYear}-${String(bkkMonth).padStart(2, "0")}-${String(bkkDay).padStart(2, "0")}T00:00:00+07:00`);

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

// ======================================================
// NEW: ดึงเวลาอัปเดต Stock ล่าสุด (แค่ 1 ค่าไว้โชว์)
// ต้องมี Prisma model: DataSync { key @id, updatedAt, rowCount? }
// ======================================================
exports.getStockLastUpdate = async (req, res) => {
  try {
    const { branch_code } = req.query;
    const userBranch = branch_code || req.user?.storecode || req.user?.name;

    // 1. ดึงเวลาส่วนกลาง (Admin upload / Global sync)
    const globalRow = await prisma.dataSync.findUnique({ where: { key: "stock" } });

    // 2. ดึงเวลารายสาขา (User upload เฉพาะสาขา)
    let branchRow = null;
    if (userBranch) {
      const bRows = await prisma.$queryRaw`
        SELECT "updatedAt", "rowCount" FROM "BranchDataSync" 
        WHERE "branch_code" = ${userBranch} AND "key" = 'stock' 
        LIMIT 1
      `;
      branchRow = bRows[0] || null;
    }

    // 3. เทียบหาเวลาที่ล่าสุดกว่า (Latest between Global and Branch-specific)
    let latestRow = globalRow || null;
    let latestUpdate = normalizeLegacyBangkokStoredDate(globalRow?.updatedAt);
    if (branchRow?.updatedAt) {
      const bDate = normalizeLegacyBangkokStoredDate(branchRow.updatedAt);
      if (!latestUpdate || bDate > latestUpdate) {
        latestRow = branchRow;
        latestUpdate = bDate;
      }
    }

    return res.json({
      updatedAt: latestUpdate ? toBangkokOffsetISOString(latestUpdate) : null,
      rowCount: latestRow?.rowCount ?? 0,
    });
  } catch (error) {
    console.error("getStockLastUpdate error:", error);
    return res.status(500).json({ msg: "Failed to load stock last update" });
  }
};

// ======================================================
// NEW: ดึง shelf templates ของสาขา (สำหรับ dropdown)
// - ดึงจาก Template table (โครงสร้าง shelf)
// - รวม SKU items สำหรับคำนวณ available index
// ======================================================
exports.getBranchShelves = async (req, res) => {
  const { branch_code } = req.query;

  if (!branch_code) {
    return res.status(400).json({ msg: "branch_code is required" });
  }

  try {
    // ดึงชื่อสาขา
    const branch = await prisma.branch.findUnique({
      where: { branch_code: branch_code },
      select: { branch_name: true },
    });

    // ดึง shelf templates
    const templates = await prisma.Template.findMany({
      where: { branch_code },
      orderBy: { shelfCode: "asc" },
      select: {
        shelfCode: true,
        fullName: true,
        rowQty: true,
      },
    });

    // ดึง SKU items สำหรับคำนวณ index
    const skus = await prisma.sku.findMany({
      where: { branch_code },
      select: {
        shelfCode: true,
        rowNo: true,
        index: true,
      },
    });

    // Group SKU items by shelf
    const skuByShelf = {};
    skus.forEach((sku) => {
      if (!skuByShelf[sku.shelfCode]) skuByShelf[sku.shelfCode] = [];
      skuByShelf[sku.shelfCode].push(sku);
    });

    // รวม templates กับ items
    const shelves = templates.map((t) => ({
      shelfCode: t.shelfCode,
      fullName: t.fullName || "",
      rowQty: t.rowQty || 1,
      items: skuByShelf[t.shelfCode] || [],
    }));

    return res.json({
      branch_code,
      branchName: branch?.branch_name || null,
      shelves,
    });
  } catch (error) {
    console.error("getBranchShelves error:", error);
    return res.status(500).json({ msg: "Failed to load shelves" });
  }
};

// ======================================================
// UserTemplateItem
// - ส่ง branchName แค่ครั้งเดียว (meta)
// - JOIN Template เพื่อเอา fullName (ชื่อ shelf)
// ======================================================
exports.UserTemplateItem = async (req, res) => {
  const { branch_code } = req.body;

  if (!branch_code) {
    return res.status(400).json({ msg: "branch_code is required" });
  }

  const { currentYear, currentMonth } = getBangkokMonthMeta();

  // key cache ผูกกับ branch + เดือนปี (กันการ reuse ข้ามเดือน)
  const key = `template-item-v4-${branch_code}-${currentYear}-${currentMonth}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    // ดึงชื่อสาขา "ครั้งเดียว" ไม่ต้องซ้ำในทุกแถว
    const br = await prisma.branch.findUnique({
      where: { branch_code: branch_code },
      select: { branch_code: true, branch_name: true },
    });

    const rawResult = await prisma.$queryRaw`
      SELECT 
          s."branch_code",
          s."item_code",
          s."shelfCode",
          s."rowNo",
          s."index",

          -- ชื่อ shelf จาก Template
          t."fullName" AS "fullName",

          p."nameProduct",
          p."nameBrand",
          p."shelfLife",
          p."salesPriceIncVAT",
          p."barcode",
          im."minStore",
          im."maxStore",
          im."packOrder",

          --  Stock ปัจจุบัน
          COALESCE(st."stockQuantity", 0)::int AS "stockQuantity"

      FROM "Sku" s

      -- Template (ชื่อ shelf)
      LEFT JOIN "Template" t
        ON t."branch_code" = s."branch_code"
       AND t."shelfCode"  = s."shelfCode"

      -- Stock ปัจจุบัน (ตามตาราง Stock)
      LEFT JOIN (
          SELECT "branch_code", "item_code",
              SUM("quantity")::int AS "stockQuantity"
          FROM "Stock"
          WHERE "branch_code" = ${branch_code}
          GROUP BY "branch_code", "item_code"
      ) st 
      ON s."branch_code" = st."branch_code" 
      AND s."item_code" = st."item_code"

      -- ข้อมูลสินค้า
      LEFT JOIN "ListOfItemHold" p 
          ON s."item_code" = p."item_code"

      -- Min / Max
      LEFT JOIN "ItemMinMax" im 
          ON s."branch_code" = im."branch_code" 
          AND s."item_code" = im."item_code"

      WHERE s."branch_code" = ${branch_code}
      ORDER BY s."shelfCode", s."index", s."rowNo"
    `;

    const items = rawResult.map((r) => ({
      branch_code: r.branch_code,
      shelfCode: r.shelfCode,
      rowNo: r.rowNo,
      index: r.index,

      // ชื่อ shelf จาก Template
      fullName: r.fullName ?? null,

      item_code:
        r.item_code !== null && r.item_code !== undefined ? r.item_code : null,

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
      packOrder: r.packOrder !== null && r.packOrder !== undefined ? Number(r.packOrder) : null,

      stockQuantity: Number(r.stockQuantity ?? 0),
    }));

    // ส่ง branchName แค่ครั้งเดียว
    const payload = {
      branch_code,
      branchName: br?.branch_name ?? null,
      items,
    };

    cache.set(key, payload);
    return res.json(payload);
  } catch (error) {
    console.error("UserTemplateItem error:", error);
    return res.status(500).json({ msg: "Failed to load data" });
  }
};

// exports.UserTemplateItem = async (req, res) => {
//     const { branch_code } = req.body;

//     if (!branch_code) {
//         return res.status(400).json({ msg: "branch_code is required" });
//     }

//     const {
//         currentYear,
//         currentMonth,
//         currentMonthStartUtc,
//         currentMonthEndUtc,
//         prevMonths,
//     } = getBangkokMonthMeta();

//     // key cache ผูกกับ branch + เดือนปี (กันการ reuse ข้ามเดือน)
//     const key = `template-item-v2-${branch_code}-${currentYear}-${currentMonth}`;
//     const cached = cache.get(key);
//     if (cached) {
//         return res.json(cached);
//     }

//     try {
//         const rawResult = await prisma.$queryRaw`
//       SELECT
//           s."branch_code",
//           s."item_code",
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

//           --  Stock ปัจจุบัน
//           COALESCE(st."stockQuantity", 0)::int AS "stockQuantity",

//           --  ยอดขาย 3 เดือนก่อนหน้า (ตามเดือนเวลาไทย)
//           COALESCE(p3."sales3mQty", 0)::int AS "sales3mQty",

//           --  ยอดขายเดือนปัจจุบันเท่านั้น (ตามเดือนเวลาไทย)
//           COALESCE(cm."salesCurrentMonthQty", 0)::int AS "salesCurrentMonthQty",

//           --  Withdraw (เฉพาะ docStatus = 'อนุมัติแล้ว')
//           COALESCE(wd."withdrawQuantity", 0)::int AS "withdrawQuantity"

//       FROM "Sku" s

//       -- Stock ปัจจุบัน (ตามตาราง Stock)
//       LEFT JOIN (
//           SELECT "branch_code", "item_code",
//               SUM("quantity")::int AS "stockQuantity"
//           FROM "Stock"
//           WHERE "branch_code" = ${branch_code}
//           GROUP BY "branch_code", "item_code"
//       ) st
//       ON s."branch_code" = st."branch_code"
//       AND s."item_code" = st."item_code"

//       --  Sales 3 เดือนก่อนหน้า จาก Bill / BillItem (รวมทุก channel)
//       LEFT JOIN (
//           SELECT
//               br."branch_code"            AS "branch_code",
//               (prod."item_code")::int  AS "item_code",
//               SUM(bi."quantity")::int     AS "sales3mQty"
//           FROM "BillItem" bi
//           JOIN "Bill" b
//               ON bi."billId" = b."id"
//           JOIN "Branch" br
//               ON b."branchId" = br."id"
//           JOIN "Product" prod
//               ON bi."productId" = prod."id"
//           WHERE br."branch_code" = ${branch_code}
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
//               (prod."item_code")::int
//       ) p3
//       ON s."branch_code" = p3."branch_code"
//       AND s."item_code" = p3."item_code"

//       --  Sales เดือนปัจจุบัน จาก Bill / BillItem
//       LEFT JOIN (
//           SELECT
//               br."branch_code"            AS "branch_code",
//               (prod."item_code")::int  AS "item_code",
//               SUM(bi."quantity")::int     AS "salesCurrentMonthQty"
//           FROM "BillItem" bi
//           JOIN "Bill" b
//               ON bi."billId" = b."id"
//           JOIN "Branch" br
//               ON b."branchId" = br."id"
//           JOIN "Product" prod
//               ON bi."productId" = prod."id"
//           WHERE br."branch_code" = ${branch_code}
//             AND b."date" >= ${currentMonthStartUtc}
//             AND b."date" <= ${currentMonthEndUtc}
//           GROUP BY
//               br."branch_code",
//               (prod."item_code")::int
//       ) cm
//       ON s."branch_code" = cm."branch_code"
//       AND s."item_code" = cm."item_code"

//       --  Withdraw: เฉพาะ docStatus = 'อนุมัติแล้ว'
//       LEFT JOIN (
//           SELECT
//               "branch_code",
//               "item_code",
//               SUM("quantity")::int AS "withdrawQuantity"
//           FROM "withdraw"
//           WHERE "branch_code" = ${branch_code}
//             AND "docStatus" = 'อนุมัติแล้ว'
//           GROUP BY "branch_code", "item_code"
//       ) wd
//       ON s."branch_code" = wd."branch_code"
//       AND s."item_code" = wd."item_code"

//       -- ข้อมูลสินค้า
//       LEFT JOIN "ListOfItemHold" p
//           ON s."item_code" = p."item_code"

//       -- Min / Max
//       LEFT JOIN "ItemMinMax" im
//           ON s."branch_code" = im."branch_code"
//           AND s."item_code" = im."item_code"

//       WHERE s."branch_code" = ${branch_code}
//       ORDER BY s."shelfCode", s."index", s."rowNo"
//     `;

//         const result = rawResult.map((r) => {
//             const sales3mQty = Number(r.sales3mQty ?? 0);
//             const sales3mAvgQty = sales3mQty / 3; // เฉลี่ย 3 เดือน
//             const salesTargetQty = sales3mAvgQty * 0.8; // 80% ของ avg

//             return {
//                 branch_code: r.branch_code,
//                 shelfCode: r.shelfCode,
//                 rowNo: r.rowNo,
//                 index: r.index,

//                 item_code:
//                     r.item_code !== null && r.item_code !== undefined ? r.item_code : null,

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
//         console.error("UserTemplateItem error:", error);
//         return res.status(500).json({ msg: "Failed to load data" });
//     }
// };
