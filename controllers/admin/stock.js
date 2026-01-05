// controllers/admin/download.js

const prisma = require("../../config/prisma");
const NodeCache = require("node-cache");

const cache = new NodeCache({
  stdTTL: 3600, // 60 นาที
});

// ✅ สาขาที่ "ไม่คำนวณยอดขาย" ให้เป็น null ทั้งหมด
const EXCLUDED_SALES_BRANCHES = new Set(["EC000", "ST000", "ST036", "ST037"]);
const normalizeBranchCode = (v) => String(v || "").trim().toUpperCase();

/**
 * Helper: แปลง "วันเวลาไทย" → Date UTC
 */
const makeBangkokDateTimeUtc = (year, month, day, timeStr) => {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T${timeStr}+07:00`);
};

/**
 * helper: ช่วงเวลา 90 วันย้อนหลัง (ยึดตามเวลา Asia/Bangkok) และใช้ yesterday เป็นวันสุดท้าย
 * → คืนค่าเป็น Date UTC { startUtc, endUtc }
 * → start = yesterday - 89 วัน (รวมเป็น 90 วัน)
 */
const getBangkok90DaysRangeUtc = () => {
  const now = new Date();
  const bangkokNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })
  );

  // yesterday ตามเวลาไทย
  const endThai = new Date(bangkokNow);
  endThai.setDate(endThai.getDate() - 1);

  // start = yesterday - 89 วัน (รวมเป็น 90 วัน)
  const startThai = new Date(endThai);
  startThai.setDate(startThai.getDate() - 89);

  const startUtc = makeBangkokDateTimeUtc(
    startThai.getFullYear(),
    startThai.getMonth() + 1,
    startThai.getDate(),
    "00:00:00.000"
  );

  const endUtc = makeBangkokDateTimeUtc(
    endThai.getFullYear(),
    endThai.getMonth() + 1,
    endThai.getDate(),
    "23:59:59.999"
  );

  return { startUtc, endUtc };
};

exports.getStock = async (req, res) => {
  try {
    const { branchCode } = req.query;

    // ✅ rolling 90 วัน (yesterday -> ย้อน 90 วัน)
    const { startUtc, endUtc } = getBangkok90DaysRangeUtc();

    // กัน cache ค้างข้ามวัน (เพราะช่วง rolling เปลี่ยนทุกวัน)
    const startKey = startUtc.toISOString().slice(0, 10);
    const endKey = endUtc.toISOString().slice(0, 10);

    const cacheKey = branchCode
      ? `stock_branch_${branchCode}_${startKey}_${endKey}`
      : `stock_all_nonzero_${startKey}_${endKey}`;

    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let rows;

    // =========================================================
    // Case A) ระบุ branchCode และเป็นสาขาที่ "ไม่คำนวณยอดขาย"
    // -> ส่ง sales90dQty = NULL ทั้งหมด (ไม่ join Bill เลย)
    // =========================================================
    const normalized = normalizeBranchCode(branchCode);
    if (branchCode && EXCLUDED_SALES_BRANCHES.has(normalized)) {
      rows = await prisma.$queryRaw`
        WITH stock_rows AS (
          SELECT s."branchCode", s."codeProduct", s."quantity"
          FROM "Stock" AS s
          WHERE s."branchCode" = ${branchCode}
            AND s."quantity" != 0
        )
        SELECT
          sr."branchCode" AS "branch_code",
          (sr."branchCode" || ' : ' || COALESCE(b."branch_name", '')) AS "branchCode",
          b."branch_name" AS "branch_name",

          sr."codeProduct",
          sr."quantity",
          l."nameProduct",
          l."nameBrand",
          l."purchasePriceExcVAT",
          l."salesPriceIncVAT",

          NULL::int AS "sales90dQty"

        FROM stock_rows AS sr
        JOIN "ListOfItemHold" AS l
          ON sr."codeProduct" = l."codeProduct"
        LEFT JOIN "Branch" AS b
          ON b."branch_code" = sr."branchCode"
        ORDER BY sr."branchCode", sr."codeProduct";
      `;

      const data = JSON.parse(
        JSON.stringify(rows, (_, value) =>
          typeof value === "bigint" ? Number(value) : value
        )
      );

      cache.set(cacheKey, data);
      return res.json(data);
    }

    // =========================================================
    // Case B) ระบุ branchCode (ปกติ) -> คำนวณยอดขาย rolling 90 วัน
    // (ไม่ต้อง CASE แล้ว เพราะ 4 สาขาถูกดักใน Case A ไปก่อน)
    // =========================================================
    if (branchCode) {
      rows = await prisma.$queryRaw`
        WITH stock_rows AS (
          SELECT s."branchCode", s."codeProduct", s."quantity"
          FROM "Stock" AS s
          WHERE s."branchCode" = ${branchCode}
            AND s."quantity" != 0
        ),
        sales90 AS (
          SELECT
            br."branch_code"           AS "branchCode",
            (prod."product_code")::int AS "codeProduct",
            SUM(bi."quantity")::int    AS "sales90dQty"
          FROM "BillItem" bi
          JOIN "Bill" b
            ON bi."billId" = b."id"
          JOIN "Branch" br
            ON b."branchId" = br."id"
          JOIN "Product" prod
            ON bi."productId" = prod."id"
          JOIN stock_rows sr
            ON sr."branchCode" = br."branch_code"
           AND sr."codeProduct" = (prod."product_code")::int
          WHERE br."branch_code" = ${branchCode}
            AND b."date" >= ${startUtc}
            AND b."date" <= ${endUtc}
          GROUP BY br."branch_code", (prod."product_code")::int
        )
        SELECT
          sr."branchCode" AS "branch_code",
          (sr."branchCode" || ' : ' || COALESCE(b."branch_name", '')) AS "branchCode",
          b."branch_name" AS "branch_name",

          sr."codeProduct",
          sr."quantity",
          l."nameProduct",
          l."nameBrand",
          l."purchasePriceExcVAT",
          l."salesPriceIncVAT",

          s90."sales90dQty"::int AS "sales90dQty"

        FROM stock_rows AS sr
        JOIN "ListOfItemHold" AS l
          ON sr."codeProduct" = l."codeProduct"
        LEFT JOIN "Branch" AS b
          ON b."branch_code" = sr."branchCode"
        LEFT JOIN sales90 s90
          ON sr."branchCode" = s90."branchCode"
         AND sr."codeProduct" = s90."codeProduct"
        ORDER BY sr."branchCode", sr."codeProduct";
      `;
    } else {
      // =========================================================
      // Case C) ไม่ระบุ branchCode (ทุกสาขา)
      // -> คำนวณยอดขายเฉพาะสาขาที่ไม่อยู่ใน exclude
      // -> สาขา exclude จะได้ sales90dQty = NULL
      // =========================================================
      rows = await prisma.$queryRaw`
        WITH stock_rows AS (
          SELECT s."branchCode", s."codeProduct", s."quantity"
          FROM "Stock" AS s
          WHERE s."quantity" != 0
        ),
        sales90 AS (
          SELECT
            br."branch_code"           AS "branchCode",
            (prod."product_code")::int AS "codeProduct",
            SUM(bi."quantity")::int    AS "sales90dQty"
          FROM "BillItem" bi
          JOIN "Bill" b
            ON bi."billId" = b."id"
          JOIN "Branch" br
            ON b."branchId" = br."id"
          JOIN "Product" prod
            ON bi."productId" = prod."id"
          JOIN stock_rows sr
            ON sr."branchCode" = br."branch_code"
           AND sr."codeProduct" = (prod."product_code")::int
          WHERE b."date" >= ${startUtc}
            AND b."date" <= ${endUtc}
            -- ✅ ไม่คำนวณยอดขายให้ 4 สาขานี้เลย
            AND br."branch_code" NOT IN ('EC000','ST000','ST036','ST037')
          GROUP BY br."branch_code", (prod."product_code")::int
        )
        SELECT
          sr."branchCode" AS "branch_code",
          (sr."branchCode" || ' : ' || COALESCE(b."branch_name", '')) AS "branchCode",
          b."branch_name" AS "branch_name",

          sr."codeProduct",
          sr."quantity",
          l."nameProduct",
          l."nameBrand",
          l."purchasePriceExcVAT",
          l."salesPriceIncVAT",

          CASE
            WHEN UPPER(TRIM(sr."branchCode")) IN ('EC000','ST000','ST036','ST037')
              THEN NULL::int
            ELSE s90."sales90dQty"::int
          END AS "sales90dQty"

        FROM stock_rows AS sr
        JOIN "ListOfItemHold" AS l
          ON sr."codeProduct" = l."codeProduct"
        LEFT JOIN "Branch" AS b
          ON b."branch_code" = sr."branchCode"
        LEFT JOIN sales90 s90
          ON sr."branchCode" = s90."branchCode"
         AND sr."codeProduct" = s90."codeProduct"
        ORDER BY sr."branchCode", sr."codeProduct";
      `;
    }

    const data = JSON.parse(
      JSON.stringify(rows, (_, value) =>
        typeof value === "bigint" ? Number(value) : value
      )
    );

    cache.set(cacheKey, data);
    return res.json(data);
  } catch (err) {
    console.error("getStock error:", err);
    return res.status(500).json({ error: "select station error" });
  }
};
