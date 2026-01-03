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
        SELECT
          s."branchCode" AS "branch_code",
          (s."branchCode" || ' : ' || COALESCE(b."branch_name", '')) AS "branchCode",
          b."branch_name" AS "branch_name",

          s."codeProduct",
          s."quantity",
          l."nameProduct",
          l."nameBrand",
          l."purchasePriceExcVAT",
          l."salesPriceIncVAT",

          NULL::int AS "sales90dQty"

        FROM "Stock" AS s
        JOIN "ListOfItemHold" AS l
          ON s."codeProduct" = l."codeProduct"
        LEFT JOIN "Branch" AS b
          ON b."branch_code" = s."branchCode"
        WHERE s."branchCode" = ${branchCode}
          AND s."quantity" != 0
        ORDER BY s."branchCode", s."codeProduct";
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
        SELECT
          s."branchCode" AS "branch_code",
          (s."branchCode" || ' : ' || COALESCE(b."branch_name", '')) AS "branchCode",
          b."branch_name" AS "branch_name",

          s."codeProduct",
          s."quantity",
          l."nameProduct",
          l."nameBrand",
          l."purchasePriceExcVAT",
          l."salesPriceIncVAT",

          s90."sales90dQty"::int AS "sales90dQty"

        FROM "Stock" AS s
        JOIN "ListOfItemHold" AS l
          ON s."codeProduct" = l."codeProduct"
        LEFT JOIN "Branch" AS b
          ON b."branch_code" = s."branchCode"

        LEFT JOIN (
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
          WHERE br."branch_code" = ${branchCode}
            AND b."date" >= ${startUtc}
            AND b."date" <= ${endUtc}
            AND EXISTS (
              SELECT 1
              FROM "Stock" s2
              WHERE s2."branchCode" = br."branch_code"
                AND s2."codeProduct" = (prod."product_code")::int
                AND s2."quantity" != 0
            )
          GROUP BY br."branch_code", (prod."product_code")::int
        ) s90
          ON s."branchCode" = s90."branchCode"
         AND s."codeProduct" = s90."codeProduct"

        WHERE s."branchCode" = ${branchCode}
          AND s."quantity" != 0
        ORDER BY s."branchCode", s."codeProduct";
      `;
    } else {
      // =========================================================
      // Case C) ไม่ระบุ branchCode (ทุกสาขา)
      // -> คำนวณยอดขายเฉพาะสาขาที่ไม่อยู่ใน exclude
      // -> สาขา exclude จะได้ sales90dQty = NULL
      // =========================================================
      rows = await prisma.$queryRaw`
        SELECT
          s."branchCode" AS "branch_code",
          (s."branchCode" || ' : ' || COALESCE(b."branch_name", '')) AS "branchCode",
          b."branch_name" AS "branch_name",

          s."codeProduct",
          s."quantity",
          l."nameProduct",
          l."nameBrand",
          l."purchasePriceExcVAT",
          l."salesPriceIncVAT",

          CASE
            WHEN UPPER(TRIM(s."branchCode")) IN ('EC000','ST000','ST036','ST037')
              THEN NULL::int
            ELSE s90."sales90dQty"::int
          END AS "sales90dQty"

        FROM "Stock" AS s
        JOIN "ListOfItemHold" AS l
          ON s."codeProduct" = l."codeProduct"
        LEFT JOIN "Branch" AS b
          ON b."branch_code" = s."branchCode"

        LEFT JOIN (
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
          WHERE b."date" >= ${startUtc}
            AND b."date" <= ${endUtc}
            -- ✅ ไม่คำนวณยอดขายให้ 4 สาขานี้เลย
            AND br."branch_code" NOT IN ('EC000','ST000','ST036','ST037')
            AND EXISTS (
              SELECT 1
              FROM "Stock" s2
              WHERE s2."branchCode" = br."branch_code"
                AND s2."codeProduct" = (prod."product_code")::int
                AND s2."quantity" != 0
            )
          GROUP BY br."branch_code", (prod."product_code")::int
        ) s90
          ON s."branchCode" = s90."branchCode"
         AND s."codeProduct" = s90."codeProduct"

        WHERE s."quantity" != 0
        ORDER BY s."branchCode", s."codeProduct";
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
