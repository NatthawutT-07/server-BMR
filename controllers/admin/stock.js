const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");
const cacheManager = require("../../utils/cacheManager");
const { getBangkok90DaysRange } = require("../../utils/dateHelper");
const { serialize } = require("../../utils/serializer");
const cache = cacheManager.getCache("stock", { stdTTL: 3600 });

// สาขาที่ "ไม่คำนวณยอดขาย" ให้เป็น null ทั้งหมด
const EXCLUDED_SALES_BRANCHES = new Set(["EC000", "ST000", "ST036", "ST037"]);
const normalizeBranchCode = (v) => String(v || "").trim().toUpperCase();


exports.getStock = async (req, res) => {
  try {
    const { branchCode } = req.query;

    // rolling 90 วัน (yesterday -> ย้อน 90 วัน)
    const { startUtc, endUtc } = getBangkok90DaysRange();

    // กัน cache ค้างข้ามวัน (เพราะช่วง rolling เปลี่ยนทุกวัน)
    const startKey = startUtc.toISOString().slice(0, 10);
    const endKey = endUtc.toISOString().slice(0, 10);

    const cacheKey = branchCode
      ? `stock_branch_${branchCode}_${startKey}_${endKey}`
      : `stock_all_nonzero_${startKey}_${endKey}`;

    const cached = cache.get(cacheKey);
    if (cached) return response.success(res, cached.rows, { range: cached.range });

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

      const data = serialize(rows);
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
            -- ไม่คำนวณยอดขายให้ 4 สาขานี้เลย
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

    const data = serialize(rows);
    const meta = { range: { start: startKey, end: endKey } };
    cache.set(cacheKey, { rows: data, range: meta.range });
    return response.success(res, data, meta);
  } catch (err) {
    console.error("getStock error:", err);
    return response.error(res, "select station error");
  }
};
