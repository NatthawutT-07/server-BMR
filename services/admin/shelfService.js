const prisma = require("../../config/prisma");
const { lockKey, releaseLock, acquireLock } = require("../../utils/lock");
const { markShelfUpdated, createShelfChangeLogs, createSingleChangeLog } = require("../../controllers/admin/shelfUpdate");

const safeStr = (v) => (v == null ? "" : String(v));
const digitsOnly = (s) => safeStr(s).replace(/\D/g, "");

const { toBkkDateStr, getBangkok90DaysRange: get90DaysRangeUtc } = require("../../utils/dateHelper");

const makeUtcDate = (year, month, day, h = 0, m = 0, s = 0, ms = 0) => {
  return new Date(Date.UTC(year, month - 1, day, h, m, s, ms));
};


const getMonthRangeUtc = (year, month) => {
  const startUtc = makeUtcDate(year, month, 1, 0, 0, 0, 0);
  const endUtc = makeUtcDate(year, month + 1, 0, 23, 59, 59, 999);
  return { startUtc, endUtc };
};

const getMonthMetaUtc = () => {
  const [currentYear, currentMonth] = toBkkDateStr(new Date()).split("-").map(Number);

  const prevMonths = [];
  for (let i = 1; i <= 3; i++) {
    let y = currentYear;
    let m = currentMonth - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }

    const { startUtc, endUtc } = getMonthRangeUtc(y, m);
    prevMonths.push({ year: y, month: m, startUtc, endUtc });
  }

  const { startUtc: currentMonthStartUtc, endUtc: currentMonthEndUtc } = getMonthRangeUtc(currentYear, currentMonth);

  return { currentYear, currentMonth, currentMonthStartUtc, currentMonthEndUtc, prevMonths };
};

exports.getMasterItem = async (qRaw) => {
  const qDigits = digitsOnly(qRaw);

  const normal = await prisma.masterItem.findMany({
    where: {
      OR: [
        { barcode: { contains: qRaw, mode: "insensitive" } },
        { item_name: { contains: qRaw, mode: "insensitive" } },
        { brand_name: { contains: qRaw, mode: "insensitive" } },
      ],
    },
    select: { item_code: true, barcode: true, item_name: true, brand_name: true },
    take: 50,
  });

  let normalized = [];
  if (qDigits.length >= 6) {
    normalized = await prisma.$queryRaw`
        SELECT "item_code", "barcode", "item_name", "brand_name"
        FROM "MasterItem"
        WHERE regexp_replace(COALESCE("barcode", ''), '\\D', '', 'g') LIKE ${"%" + qDigits + "%"}
        LIMIT 50;
      `;
  }

  const map = new Map();
  [...normal, ...normalized].forEach((it) => {
    if (it?.item_code != null) map.set(it.item_code, it);
  });

  return Array.from(map.values()).slice(0, 20);
};

exports.createItems = async (items, userName) => {
  let key = null;
  const { branch_code, shelf_code } = items[0];
  
  try {
    key = lockKey(branch_code, shelf_code);
    await acquireLock(prisma, key);

    const itemsToInsert = items.map((item) => ({
      branch_code: item.branch_code,
      item_code: item.item_code,
      shelf_code: item.shelf_code,
      shelf_row_number: Number(item.shelf_row_number),
      shelf_index_number: Number(item.shelf_index_number),
    }));

    await prisma.skuPosition.createMany({
      data: itemsToInsert,
      skipDuplicates: true,
    });

    await createSingleChangeLog(branch_code, shelf_code, "add", itemsToInsert, userName);
    await markShelfUpdated(branch_code, userName);

    return true;
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("releaseLock failed (createItems):", e?.message || e);
      }
    }
  }
};

exports.deleteItem = async (deleteData, userName) => {
  let key = null;
  const { id, branch_code, shelf_code, shelf_row_number, item_code, shelf_index_number } = deleteData;

  let bc = branch_code;
  let sc = shelf_code;

  if ((bc == null || sc == null) && id != null) {
    const found = await prisma.skuPosition.findUnique({ where: { id: Number(id) } });
    if (!found) throw new Error("Item not found");
    bc = found.branch_code;
    sc = found.shelf_code;
  }

  try {
    key = lockKey(bc, sc);
    await acquireLock(prisma, key);

    let deletedItem = null;
    if (id != null && id !== "") {
      deletedItem = await prisma.skuPosition.findUnique({ where: { id: Number(id) } });
    } else {
      deletedItem = {
        branch_code: bc,
        shelf_code: sc,
        shelf_row_number: Number(shelf_row_number),
        shelf_index_number: Number(shelf_index_number),
        item_code: item_code,
      };
    }

    if (id != null && id !== "") {
      await prisma.skuPosition.deleteMany({ where: { id: Number(id) } });
    } else {
      await prisma.skuPosition.deleteMany({
        where: {
          branch_code: bc,
          shelf_code: sc,
          shelf_row_number: Number(shelf_row_number),
          item_code: item_code,
          shelf_index_number: Number(shelf_index_number),
        },
      });
    }

    const remainingItems = await prisma.skuPosition.findMany({
      where: { branch_code: bc, shelf_code: sc, shelf_row_number: Number(shelf_row_number) },
      orderBy: { shelf_index_number: "asc" },
    });

    if (remainingItems.length > 0) {
      const updateOps = remainingItems.map((item, i) =>
        prisma.skuPosition.update({
          where: { id: item.id },
          data: { shelf_index_number: i + 1 },
        })
      );
      await prisma.$transaction(updateOps);
    }

    if (deletedItem) {
      await createSingleChangeLog(bc, sc, "delete", [deletedItem], userName);
    }

    await markShelfUpdated(bc, userName);

    return true;
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("releaseLock failed (deleteItem):", e?.message || e);
      }
    }
  }
};

exports.updateItems = async (items, userName) => {
  let key = null;
  const branch_code = items[0].branch_code;
  const shelf_code = items[0].shelf_code;

  try {
    key = lockKey(branch_code, shelf_code);
    await acquireLock(prisma, key);

    const oldItems = await prisma.skuPosition.findMany({
      where: { branch_code, shelf_code },
      select: { item_code: true, shelf_row_number: true, shelf_index_number: true },
    });

    const itemsToInsert = items.map((item) => ({
      branch_code: item.branch_code,
      shelf_code: item.shelf_code,
      shelf_row_number: Number(item.shelf_row_number),
      shelf_index_number: Number(item.shelf_index_number),
      item_code: item.item_code,
    }));

    await prisma.$transaction([
      prisma.skuPosition.deleteMany({ where: { branch_code, shelf_code } }),
      prisma.skuPosition.createMany({ data: itemsToInsert }),
    ]);

    const newItems = itemsToInsert.map((i) => ({
      item_code: i.item_code,
      shelf_row_number: i.shelf_row_number,
      shelf_index_number: i.shelf_index_number,
    }));
    await createShelfChangeLogs(branch_code, shelf_code, oldItems, newItems, userName);

    await markShelfUpdated(branch_code, userName);

    return true;
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("releaseLock failed (updateItems):", e?.message || e);
      }
    }
  }
};

exports.getTemplates = async () => {
  return await prisma.shelfTemplate.findMany({
    orderBy: { id: "asc" },
  });
};

exports.getSkuData = async (branch_code) => {
  const { startUtc, endUtc, startDateStr, endDateStr } = get90DaysRangeUtc();

  const rawResult = await prisma.$queryRaw`
        SELECT 
            s."branch_code", s."item_code", s."shelf_code", s."shelf_row_number", s."shelf_index_number",
            p."item_name", p."brand_name", p."purchase_price", p."selling_price_vat", p."shelf_life_days", p."barcode",
            p."group_name",
            im."min_stock", im."max_stock", im."pack_order",
            COALESCE(st."quantity_stock", 0)::int AS "quantity_stock",
            COALESCE(wd."quantity_withdraw", 0)::int   AS "quantity_withdraw",
            COALESCE(wd."value_withdraw", 0)::float8   AS "value_withdraw",
            COALESCE(bs."quantity_sale_bill", 0)::int     AS "quantity_sale_bill",
            COALESCE(bs."total_sales_rounding_no_end_discount", 0)::float8 AS "total_sales_rounding_no_end_discount",
            CASE
              WHEN ls."lastSaleDate" IS NOT NULL THEN
                GREATEST(((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - 1) - (ls."lastSaleDate" AT TIME ZONE 'Asia/Bangkok')::date, 0)
              ELSE NULL
            END AS "dayOff"
        FROM "SkuPosition" s
        LEFT JOIN (
            SELECT "branch_code", "item_code", SUM("quantity_stock")::int AS "quantity_stock"
            FROM "Stock" WHERE "branch_code" = ${branch_code} GROUP BY "branch_code", "item_code"
        ) st ON s."branch_code" = st."branch_code" AND s."item_code" = st."item_code"
        LEFT JOIN (
            SELECT "branch_code", "item_code", SUM("quantity_withdraw")::int AS "quantity_withdraw", SUM("value_withdraw"::numeric)::float8 AS "value_withdraw"
            FROM "Withdraw"
            WHERE "branch_code" = ${branch_code} AND "document_status" = 'อนุมัติแล้ว' AND "reason" != 'เบิกเพื่อขาย'
              AND to_date("date_withdraw", 'DD/MM/YYYY') >= to_date(${startDateStr}, 'YYYY-MM-DD') AND to_date("date_withdraw", 'DD/MM/YYYY') <= to_date(${endDateStr}, 'YYYY-MM-DD')
            GROUP BY "branch_code", "item_code"
        ) wd ON s."branch_code" = wd."branch_code" AND s."item_code" = wd."item_code"
        LEFT JOIN (
            SELECT br."branch_code" AS "branch_code", bi."item_code" AS "item_code", SUM(bi."quantity_sale_bill")::int AS "quantity_sale_bill", SUM(bi."total_sales_rounding_no_end_discount")::float8 AS "total_sales_rounding_no_end_discount"
            FROM "BillItem" bi
            JOIN "BillHeader" b ON bi."billId" = b."id"
            JOIN "BranchMain" br ON b."branchId" = br."id"
            WHERE br."branch_code" = ${branch_code} AND b."date" >= ${startUtc} AND b."date" <= ${endUtc}
            GROUP BY br."branch_code", bi."item_code"
        ) bs ON s."branch_code" = bs."branch_code" AND s."item_code" = bs."item_code"
        LEFT JOIN (
            SELECT br."branch_code" AS "branch_code", bi."item_code" AS "item_code", MAX(b."date") AS "lastSaleDate"
            FROM "BillItem" bi
            JOIN "BillHeader" b ON bi."billId" = b."id"
            JOIN "BranchMain" br ON b."branchId" = br."id"
            WHERE br."branch_code" = ${branch_code} AND b."date" >= ${startUtc} AND b."date" <= ${endUtc}
            GROUP BY br."branch_code", bi."item_code"
        ) ls ON s."branch_code" = ls."branch_code" AND s."item_code" = ls."item_code"
        LEFT JOIN "MasterItem" p ON s."item_code" = p."item_code"
        LEFT JOIN "MinMaxAutoPO" im ON s."branch_code" = im."branch_code" AND s."item_code" = im."item_code"
        WHERE s."branch_code" = ${branch_code}
        ORDER BY s."shelf_code", s."shelf_index_number", s."shelf_row_number"
    `;

  return { result: rawResult, startUtc, endUtc };
};

exports.getDashboardSummary = async () => {
  const { startUtc, endUtc, startDateStr, endDateStr } = get90DaysRangeUtc();

  const rows = await prisma.$queryRaw`
      WITH sku_rows AS (SELECT "branch_code", "shelf_code", "item_code" FROM "SkuPosition"),
      stock_map AS (SELECT "branch_code", "item_code", SUM("quantity_stock")::float8 AS stock_qty FROM "Stock" GROUP BY "branch_code", "item_code"),
      withdraw_map AS (
          SELECT "branch_code", "item_code", SUM("value_withdraw")::float8 AS withdraw_value
          FROM "Withdraw"
          WHERE "document_status" = 'อนุมัติแล้ว' AND "reason" != 'เบิกเพื่อขาย'
            AND to_date("date_withdraw", 'DD/MM/YYYY') >= to_date(${startDateStr}, 'YYYY-MM-DD') AND to_date("date_withdraw", 'DD/MM/YYYY') <= to_date(${endDateStr}, 'YYYY-MM-DD')
          GROUP BY "branch_code", "item_code"
      ),
      sales_map AS (
          SELECT br."branch_code" AS "branch_code", bi."item_code" AS "item_code", SUM(bi."total_sales_rounding_no_end_discount")::float8 AS sales_total
          FROM "BillItem" bi
          JOIN "BillHeader" b ON bi."billId" = b."id"
          JOIN "BranchMain" br ON b."branchId" = br."id"
          WHERE b."date" >= ${startUtc} AND b."date" <= ${endUtc}
          GROUP BY br."branch_code", bi."item_code"
      ),
      branch_sums AS (
          SELECT sr."branch_code" AS branch_code, COUNT(DISTINCT sr."shelf_code")::int AS shelf_count, COUNT(DISTINCT sr."item_code")::int AS product_count,
              SUM(CASE WHEN COALESCE(sm.stock_qty, 0) > 0 THEN COALESCE(sm.stock_qty, 0) * COALESCE(p."purchase_price", 0) ELSE 0 END)::float8 AS stock_cost,
              SUM(COALESCE(wm.withdraw_value, 0))::float8 AS withdraw_value, SUM(COALESCE(sa.sales_total, 0))::float8 AS sales_total
          FROM sku_rows sr
          LEFT JOIN stock_map sm ON sm."branch_code" = sr."branch_code" AND sm."item_code" = sr."item_code"
          LEFT JOIN "MasterItem" p ON p."item_code" = sr."item_code"
          LEFT JOIN withdraw_map wm ON wm."branch_code" = sr."branch_code" AND wm."item_code" = sr."item_code"
          LEFT JOIN sales_map sa ON sa."branch_code" = sr."branch_code" AND sa."item_code" = sr."item_code"
          GROUP BY sr."branch_code"
      )
      SELECT b."branch_code" AS "branch_code", b."branch_name" AS "branchName", COALESCE(bs.shelf_count, 0)::int AS "shelfCount",
          COALESCE(bs.product_count, 0)::int AS "productCount", COALESCE(bs.stock_cost, 0)::float8 AS "stockCost",
          COALESCE(bs.withdraw_value, 0)::float8 AS "value_withdraw", COALESCE(bs.sales_total, 0)::float8 AS "salesTotal"
      FROM "BranchMain" b LEFT JOIN branch_sums bs ON bs.branch_code = b."branch_code" ORDER BY b."branch_code" ASC
  `;

  const overallSkuResult = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT "item_code")::int AS "overallUniqueSkus"
      FROM "SkuPosition"
  `;
  const overallUniqueSkus = overallSkuResult[0]?.overallUniqueSkus || 0;

  const missingSalesDatesResult = await prisma.$queryRaw`
      WITH RECURSIVE date_series AS (
          SELECT ${startUtc}::date AS d
          UNION ALL
          SELECT (d + interval '1 day')::date
          FROM date_series
          WHERE d < ${endUtc}::date
      ),
      sales_dates AS (
          SELECT DISTINCT b."date"::date AS sale_date
          FROM "BillHeader" b
          WHERE b."date" >= ${startUtc} AND b."date" <= ${endUtc}
      )
      SELECT ds.d::text AS missing_date
      FROM date_series ds
      LEFT JOIN sales_dates sd ON ds.d = sd.sale_date
      WHERE sd.sale_date IS NULL
      ORDER BY ds.d ASC
  `;
  
  const missingSalesDates = missingSalesDatesResult.map(r => r.missing_date);

  return { rows, startUtc, endUtc, overallUniqueSkus, missingSalesDates };
};

exports.getShelfSales = async (branch_code) => {
  const { startUtc, endUtc, startDateStr, endDateStr } = get90DaysRangeUtc();

  const rows = await prisma.$queryRaw`
      WITH sku_rows AS (SELECT "branch_code", "shelf_code", "item_code" FROM "SkuPosition" WHERE "branch_code" = ${branch_code}),
      shelf_names AS (SELECT "branch_code", "shelf_code", "shelf_name" FROM "ShelfTemplate" WHERE "branch_code" = ${branch_code}),
      stock_map AS (SELECT "branch_code", "item_code", SUM("quantity_stock")::float8 AS stock_qty FROM "Stock" WHERE "branch_code" = ${branch_code} GROUP BY "branch_code", "item_code"),
      withdraw_map AS (
          SELECT "branch_code", "item_code", SUM("value_withdraw")::float8 AS withdraw_value
          FROM "Withdraw"
          WHERE "document_status" = 'อนุมัติแล้ว' AND "reason" != 'เบิกเพื่อขาย' AND "branch_code" = ${branch_code}
            AND to_date("date_withdraw", 'DD/MM/YYYY') >= to_date(${startDateStr}, 'YYYY-MM-DD') AND to_date("date_withdraw", 'DD/MM/YYYY') <= to_date(${endDateStr}, 'YYYY-MM-DD')
          GROUP BY "branch_code", "item_code"
      ),
      sales_map AS (
          SELECT br."branch_code" AS "branch_code", bi."item_code" AS "item_code", SUM(bi."total_sales_rounding_no_end_discount")::float8 AS sales_total
          FROM "BillItem" bi JOIN "BillHeader" b ON bi."billId" = b."id" JOIN "BranchMain" br ON b."branchId" = br."id"
          WHERE br."branch_code" = ${branch_code} AND b."date" >= ${startUtc} AND b."date" <= ${endUtc}
          GROUP BY br."branch_code", bi."item_code"
      ),
      shelf_sums AS (
          SELECT sr."branch_code" AS branch_code, sr."shelf_code" AS shelf_code, COUNT(DISTINCT sr."item_code")::int AS sku_count,
              SUM(CASE WHEN COALESCE(sm.stock_qty, 0) > 0 THEN COALESCE(sm.stock_qty, 0) * COALESCE(p."purchase_price", 0) ELSE 0 END)::float8 AS stock_cost,
              SUM(COALESCE(wm.withdraw_value, 0))::float8 AS withdraw_value, SUM(COALESCE(sa.sales_total, 0))::float8 AS sales_total
          FROM sku_rows sr
          LEFT JOIN stock_map sm ON sm."branch_code" = sr."branch_code" AND sm."item_code" = sr."item_code"
          LEFT JOIN "MasterItem" p ON p."item_code" = sr."item_code"
          LEFT JOIN withdraw_map wm ON wm."branch_code" = sr."branch_code" AND wm."item_code" = sr."item_code"
          LEFT JOIN sales_map sa ON sa."branch_code" = sr."branch_code" AND sa."item_code" = sr."item_code"
          GROUP BY sr."branch_code", sr."shelf_code"
      )
      SELECT ss.branch_code AS "branch_code", ss.shelf_code AS "shelf_code", sn."shelf_name" AS "shelfName",
          COALESCE(ss.sales_total, 0)::float8 AS "salesTotal", COALESCE(ss.withdraw_value, 0)::float8 AS "value_withdraw",
          COALESCE(ss.sku_count, 0)::int AS "skuCount", COALESCE(ss.stock_cost, 0)::float8 AS "stockCost"
      FROM shelf_sums ss LEFT JOIN shelf_names sn ON sn."branch_code" = ss.branch_code AND sn."shelf_code" = ss.shelf_code
      ORDER BY ss.shelf_code
  `;

  return rows;
};
