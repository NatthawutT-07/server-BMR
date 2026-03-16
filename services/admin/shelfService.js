const prisma = require("../../config/prisma");
const { lockKey, releaseLock, acquireLock } = require("../../utils/lock");
const { markShelfUpdated, createShelfChangeLogs, createSingleChangeLog } = require("../../controllers/admin/shelfUpdate");

const safeStr = (v) => (v == null ? "" : String(v));
const digitsOnly = (s) => safeStr(s).replace(/\D/g, "");

const toBkkDateStr = (dateObj) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dateObj);

const makeUtcDate = (year, month, day, h = 0, m = 0, s = 0, ms = 0) => {
  return new Date(Date.UTC(year, month - 1, day, h, m, s, ms));
};

const get90DaysRangeUtc = () => {
  const now = new Date();
  const bangkokNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })
  );

  const endBkk = new Date(bangkokNow);
  endBkk.setDate(endBkk.getDate() - 1);
  endBkk.setHours(23, 59, 59, 999);

  const startBkk = new Date(endBkk);
  startBkk.setDate(startBkk.getDate() - 89);
  startBkk.setHours(0, 0, 0, 0);

  const startUtc = new Date(startBkk.getTime() - 7 * 60 * 60 * 1000);
  const endUtc = new Date(endBkk.getTime() - 7 * 60 * 60 * 1000);

  const formatYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  return {
    startUtc,
    endUtc,
    startDateStr: formatYMD(startBkk),
    endDateStr: formatYMD(endBkk)
  };
};

const getMonthRangeUtc = (year, month) => {
  const startUtc = makeUtcDate(year, month, 1, 0, 0, 0, 0);
  const endUtc = makeUtcDate(year, month + 1, 0, 23, 59, 59, 999);
  return { startUtc, endUtc };
};

const getMonthMetaUtc = () => {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const prevMonths = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - i);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;

    const { startUtc, endUtc } = getMonthRangeUtc(y, m);
    prevMonths.push({ year: y, month: m, startUtc, endUtc });
  }

  const { startUtc: currentMonthStartUtc, endUtc: currentMonthEndUtc } = getMonthRangeUtc(currentYear, currentMonth);

  return { currentYear, currentMonth, currentMonthStartUtc, currentMonthEndUtc, prevMonths };
};

exports.getMasterItem = async (qRaw) => {
  const qDigits = digitsOnly(qRaw);

  const normal = await prisma.listOfItemHold.findMany({
    where: {
      OR: [
        { barcode: { contains: qRaw, mode: "insensitive" } },
        { nameProduct: { contains: qRaw, mode: "insensitive" } },
        { nameBrand: { contains: qRaw, mode: "insensitive" } },
      ],
    },
    select: { codeProduct: true, barcode: true, nameProduct: true, nameBrand: true },
    take: 50,
  });

  let normalized = [];
  if (qDigits.length >= 6) {
    normalized = await prisma.$queryRaw`
        SELECT "codeProduct", "barcode", "nameProduct", "nameBrand"
        FROM "ListOfItemHold"
        WHERE regexp_replace(COALESCE("barcode", ''), '\\D', '', 'g') LIKE ${"%" + qDigits + "%"}
        LIMIT 50;
      `;
  }

  const map = new Map();
  [...normal, ...normalized].forEach((it) => {
    if (it?.codeProduct != null) map.set(Number(it.codeProduct), it);
  });

  return Array.from(map.values()).slice(0, 20);
};

exports.createItems = async (items, userName) => {
  let key = null;
  const { branchCode, shelfCode } = items[0];
  
  try {
    key = lockKey(branchCode, shelfCode);
    await acquireLock(prisma, key);

    const itemsToInsert = items.map((item) => ({
      branchCode: item.branchCode,
      codeProduct: Number(item.codeProduct),
      shelfCode: item.shelfCode,
      rowNo: Number(item.rowNo),
      index: Number(item.index),
    }));

    await prisma.sku.createMany({
      data: itemsToInsert,
      skipDuplicates: true,
    });

    await createSingleChangeLog(branchCode, shelfCode, "add", itemsToInsert, userName);
    await markShelfUpdated(branchCode, userName);

    return true;
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("❌ releaseLock failed (createItems):", e?.message || e);
      }
    }
  }
};

exports.deleteItem = async (deleteData, userName) => {
  let key = null;
  const { id, branchCode, shelfCode, rowNo, codeProduct, index } = deleteData;

  let bc = branchCode;
  let sc = shelfCode;

  if ((bc == null || sc == null) && id != null) {
    const found = await prisma.sku.findUnique({ where: { id: Number(id) } });
    if (!found) throw new Error("Item not found");
    bc = found.branchCode;
    sc = found.shelfCode;
  }

  try {
    key = lockKey(bc, sc);
    await acquireLock(prisma, key);

    let deletedItem = null;
    if (id != null && id !== "") {
      deletedItem = await prisma.sku.findUnique({ where: { id: Number(id) } });
    } else {
      deletedItem = {
        branchCode: bc,
        shelfCode: sc,
        rowNo: Number(rowNo),
        index: Number(index),
        codeProduct: Number(codeProduct),
      };
    }

    if (id != null && id !== "") {
      await prisma.sku.deleteMany({ where: { id: Number(id) } });
    } else {
      await prisma.sku.deleteMany({
        where: {
          branchCode: bc,
          shelfCode: sc,
          rowNo: Number(rowNo),
          codeProduct: Number(codeProduct),
          index: Number(index),
        },
      });
    }

    const remainingItems = await prisma.sku.findMany({
      where: { branchCode: bc, shelfCode: sc, rowNo: Number(rowNo) },
      orderBy: { index: "asc" },
    });

    if (remainingItems.length > 0) {
      const updateOps = remainingItems.map((item, i) =>
        prisma.sku.update({
          where: { id: item.id },
          data: { index: i + 1 },
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
        console.error("❌ releaseLock failed (deleteItem):", e?.message || e);
      }
    }
  }
};

exports.updateItems = async (items, userName) => {
  let key = null;
  const branchCode = items[0].branchCode;
  const shelfCode = items[0].shelfCode;

  try {
    key = lockKey(branchCode, shelfCode);
    await acquireLock(prisma, key);

    const oldItems = await prisma.sku.findMany({
      where: { branchCode, shelfCode },
      select: { codeProduct: true, rowNo: true, index: true },
    });

    const itemsToInsert = items.map((item) => ({
      branchCode: item.branchCode,
      shelfCode: item.shelfCode,
      rowNo: Number(item.rowNo),
      index: Number(item.index),
      codeProduct: Number(item.codeProduct),
    }));

    await prisma.$transaction([
      prisma.sku.deleteMany({ where: { branchCode, shelfCode } }),
      prisma.sku.createMany({ data: itemsToInsert }),
    ]);

    const newItems = itemsToInsert.map((i) => ({
      codeProduct: i.codeProduct,
      rowNo: i.rowNo,
      index: i.index,
    }));
    await createShelfChangeLogs(branchCode, shelfCode, oldItems, newItems, userName);

    await markShelfUpdated(branchCode, userName);

    return true;
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("❌ releaseLock failed (updateItems):", e?.message || e);
      }
    }
  }
};

exports.getTemplates = async () => {
  return await prisma.tamplate.findMany({
    orderBy: { id: "asc" },
  });
};

exports.getSkuData = async (branchCode) => {
  const { startUtc, endUtc, startDateStr, endDateStr } = get90DaysRangeUtc();
  const { currentMonthStartUtc, currentMonthEndUtc } = getMonthMetaUtc();

  const rawResult = await prisma.$queryRaw`
        SELECT 
            s."branchCode", s."codeProduct", s."shelfCode", s."rowNo", s."index",
            p."nameProduct", p."nameBrand", p."purchasePriceExcVAT", p."salesPriceIncVAT", p."shelfLife", p."barcode", 
            im."minStore", im."maxStore",
            COALESCE(st."stockQuantity", 0)::int AS "stockQuantity",
            COALESCE(wd."withdrawQuantity", 0)::int   AS "withdrawQuantity",
            COALESCE(wd."withdrawValue", 0)::float8   AS "withdrawValue",
            COALESCE(bs."quantity_total", 0)::int     AS "salesQuantity",
            COALESCE(bs."net_sales_total", 0)::float8 AS "salesTotalPrice",
            COALESCE(cm."salesCurrentMonthQty", 0)::int AS "salesCurrentMonthQty"
        FROM "Sku" s
        LEFT JOIN (
            SELECT "branchCode", "codeProduct", SUM("quantity")::int AS "stockQuantity"
            FROM "Stock" WHERE "branchCode" = ${branchCode} GROUP BY "branchCode", "codeProduct"
        ) st ON s."branchCode" = st."branchCode" AND s."codeProduct" = st."codeProduct"
        LEFT JOIN (
            SELECT "branchCode", "codeProduct", SUM("quantity")::int AS "withdrawQuantity", SUM("value"::numeric)::float8 AS "withdrawValue"
            FROM "withdraw"
            WHERE "branchCode" = ${branchCode} AND "docStatus" = 'อนุมัติแล้ว' AND "reason" != 'เบิกเพื่อขาย'
              AND to_date("date", 'DD/MM/YYYY') >= to_date(${startDateStr}, 'YYYY-MM-DD') AND to_date("date", 'DD/MM/YYYY') <= to_date(${endDateStr}, 'YYYY-MM-DD')
            GROUP BY "branchCode", "codeProduct"
        ) wd ON s."branchCode" = wd."branchCode" AND s."codeProduct" = wd."codeProduct"
        LEFT JOIN (
            SELECT br."branch_code" AS "branchCode", (p."product_code")::int AS "codeProduct", SUM(bi."quantity")::int AS "quantity_total", SUM(bi."net_sales")::float8 AS "net_sales_total"
            FROM "BillItem" bi
            JOIN "Bill" b ON bi."billId" = b."id"
            JOIN "Branch" br ON b."branchId" = br."id"
            JOIN "Product" p ON bi."productId" = p."id"
            WHERE br."branch_code" = ${branchCode} AND b."date" >= ${startUtc} AND b."date" <= ${endUtc}
            GROUP BY br."branch_code", (p."product_code")::int
        ) bs ON s."branchCode" = bs."branchCode" AND s."codeProduct" = bs."codeProduct"
        LEFT JOIN (
            SELECT br."branch_code" AS "branchCode", (prod."product_code")::int AS "codeProduct", SUM(bi."quantity")::int AS "salesCurrentMonthQty"
            FROM "BillItem" bi
            JOIN "Bill" b ON bi."billId" = b."id"
            JOIN "Branch" br ON b."branchId" = br."id"
            JOIN "Product" prod ON bi."productId" = prod."id"
            WHERE br."branch_code" = ${branchCode} AND b."date" >= ${currentMonthStartUtc} AND b."date" <= ${currentMonthEndUtc}
            GROUP BY br."branch_code", (prod."product_code")::int
        ) cm ON s."branchCode" = cm."branchCode" AND s."codeProduct" = cm."codeProduct"
        LEFT JOIN "ListOfItemHold" p ON s."codeProduct" = p."codeProduct"
        LEFT JOIN "ItemMinMax" im ON s."branchCode" = im."branchCode" AND s."codeProduct" = im."codeProduct"
        WHERE s."branchCode" = ${branchCode}
        ORDER BY s."shelfCode", s."index", s."rowNo"
    `;

  return { result: rawResult, startUtc, endUtc };
};

exports.getDashboardSummary = async () => {
  const { startUtc, endUtc, startDateStr, endDateStr } = get90DaysRangeUtc();

  const rows = await prisma.$queryRaw`
      WITH sku_rows AS (SELECT "branchCode", "shelfCode", "codeProduct" FROM "Sku"),
      stock_map AS (SELECT "branchCode", "codeProduct", SUM("quantity")::float8 AS stock_qty FROM "Stock" GROUP BY "branchCode", "codeProduct"),
      withdraw_map AS (
          SELECT "branchCode", "codeProduct", SUM("value")::float8 AS withdraw_value
          FROM "withdraw"
          WHERE "docStatus" = 'อนุมัติแล้ว' AND "reason" != 'เบิกเพื่อขาย'
            AND to_date("date", 'DD/MM/YYYY') >= to_date(${startDateStr}, 'YYYY-MM-DD') AND to_date("date", 'DD/MM/YYYY') <= to_date(${endDateStr}, 'YYYY-MM-DD')
          GROUP BY "branchCode", "codeProduct"
      ),
      sales_map AS (
          SELECT br."branch_code" AS "branchCode", (pr."product_code")::int AS "codeProduct", SUM(bi."net_sales")::float8 AS sales_total
          FROM "BillItem" bi
          JOIN "Bill" b ON bi."billId" = b."id"
          JOIN "Branch" br ON b."branchId" = br."id"
          JOIN "Product" pr ON bi."productId" = pr."id"
          WHERE b."date" >= ${startUtc} AND b."date" <= ${endUtc}
          GROUP BY br."branch_code", (pr."product_code")::int
      ),
      branch_sums AS (
          SELECT sr."branchCode" AS branch_code, COUNT(DISTINCT sr."shelfCode")::int AS shelf_count, COUNT(*)::int AS product_count,
              SUM(CASE WHEN COALESCE(sm.stock_qty, 0) > 0 THEN COALESCE(sm.stock_qty, 0) * COALESCE(p."purchasePriceExcVAT", 0) ELSE 0 END)::float8 AS stock_cost,
              SUM(COALESCE(wm.withdraw_value, 0))::float8 AS withdraw_value, SUM(COALESCE(sa.sales_total, 0))::float8 AS sales_total
          FROM sku_rows sr
          LEFT JOIN stock_map sm ON sm."branchCode" = sr."branchCode" AND sm."codeProduct" = sr."codeProduct"
          LEFT JOIN "ListOfItemHold" p ON p."codeProduct" = sr."codeProduct"
          LEFT JOIN withdraw_map wm ON wm."branchCode" = sr."branchCode" AND wm."codeProduct" = sr."codeProduct"
          LEFT JOIN sales_map sa ON sa."branchCode" = sr."branchCode" AND sa."codeProduct" = sr."codeProduct"
          GROUP BY sr."branchCode"
      )
      SELECT b."branch_code" AS "branchCode", b."branch_name" AS "branchName", COALESCE(bs.shelf_count, 0)::int AS "shelfCount",
          COALESCE(bs.product_count, 0)::int AS "productCount", COALESCE(bs.stock_cost, 0)::float8 AS "stockCost",
          COALESCE(bs.withdraw_value, 0)::float8 AS "withdrawValue", COALESCE(bs.sales_total, 0)::float8 AS "salesTotal"
      FROM "Branch" b LEFT JOIN branch_sums bs ON bs.branch_code = b."branch_code" ORDER BY b."branch_code" ASC
  `;

  return { rows, startUtc, endUtc };
};

exports.getShelfSales = async (branchCode) => {
  const { startUtc, endUtc, startDateStr, endDateStr } = get90DaysRangeUtc();

  const rows = await prisma.$queryRaw`
      WITH sku_rows AS (SELECT "branchCode", "shelfCode", "codeProduct" FROM "Sku" WHERE "branchCode" = ${branchCode}),
      shelf_names AS (SELECT "branchCode", "shelfCode", "fullName" FROM "Tamplate" WHERE "branchCode" = ${branchCode}),
      stock_map AS (SELECT "branchCode", "codeProduct", SUM("quantity")::float8 AS stock_qty FROM "Stock" WHERE "branchCode" = ${branchCode} GROUP BY "branchCode", "codeProduct"),
      withdraw_map AS (
          SELECT "branchCode", "codeProduct", SUM("value")::float8 AS withdraw_value
          FROM "withdraw"
          WHERE "docStatus" = 'อนุมัติแล้ว' AND "reason" != 'เบิกเพื่อขาย' AND "branchCode" = ${branchCode}
            AND to_date("date", 'DD/MM/YYYY') >= to_date(${startDateStr}, 'YYYY-MM-DD') AND to_date("date", 'DD/MM/YYYY') <= to_date(${endDateStr}, 'YYYY-MM-DD')
          GROUP BY "branchCode", "codeProduct"
      ),
      sales_map AS (
          SELECT br."branch_code" AS "branchCode", (pr."product_code")::int AS "codeProduct", SUM(bi."net_sales")::float8 AS sales_total
          FROM "BillItem" bi JOIN "Bill" b ON bi."billId" = b."id" JOIN "Branch" br ON b."branchId" = br."id" JOIN "Product" pr ON bi."productId" = pr."id"
          WHERE br."branch_code" = ${branchCode} AND b."date" >= ${startUtc} AND b."date" <= ${endUtc}
          GROUP BY br."branch_code", (pr."product_code")::int
      ),
      shelf_sums AS (
          SELECT sr."branchCode" AS branch_code, sr."shelfCode" AS shelf_code, COUNT(*)::int AS sku_count,
              SUM(CASE WHEN COALESCE(sm.stock_qty, 0) > 0 THEN COALESCE(sm.stock_qty, 0) * COALESCE(p."purchasePriceExcVAT", 0) ELSE 0 END)::float8 AS stock_cost,
              SUM(COALESCE(wm.withdraw_value, 0))::float8 AS withdraw_value, SUM(COALESCE(sa.sales_total, 0))::float8 AS sales_total
          FROM sku_rows sr
          LEFT JOIN stock_map sm ON sm."branchCode" = sr."branchCode" AND sm."codeProduct" = sr."codeProduct"
          LEFT JOIN "ListOfItemHold" p ON p."codeProduct" = sr."codeProduct"
          LEFT JOIN withdraw_map wm ON wm."branchCode" = sr."branchCode" AND wm."codeProduct" = sr."codeProduct"
          LEFT JOIN sales_map sa ON sa."branchCode" = sr."branchCode" AND sa."codeProduct" = sr."codeProduct"
          GROUP BY sr."branchCode", sr."shelfCode"
      )
      SELECT ss.branch_code AS "branchCode", ss.shelf_code AS "shelfCode", sn."fullName" AS "shelfName",
          COALESCE(ss.sales_total, 0)::float8 AS "salesTotal", COALESCE(ss.withdraw_value, 0)::float8 AS "withdrawValue",
          COALESCE(ss.sku_count, 0)::int AS "skuCount", COALESCE(ss.stock_cost, 0)::float8 AS "stockCost"
      FROM shelf_sums ss LEFT JOIN shelf_names sn ON sn."branchCode" = ss.branch_code AND sn."shelfCode" = ss.shelf_code
      ORDER BY ss.shelf_code
  `;

  return rows;
};
