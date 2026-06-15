const prisma = require("../../config/prisma");
const cacheManager = require("../../utils/cacheManager");
const { normalizeLegacyBangkokStoredDate, toBangkokOffsetISOString } = require("../../utils/dateHelper");
const cache = cacheManager.getCache("user-template", { stdTTL: 60 }); // Increased from 5s to 60s for better performance

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

exports.getStockLastUpdate = async (req, res) => {
  try {
    const { branch_code } = req.query;
    const userBranch = branch_code || req.user?.storecode || req.user?.name;

    const globalRow = await prisma.dataSync.findUnique({ where: { key: "stock" } });

    let branchRow = null;
    if (userBranch) {
      const bRows = await prisma.$queryRaw`
        SELECT "updatedAt", "rowCount" FROM "BranchDataSync" 
        WHERE "branch_code" = ${userBranch} AND "key" = 'stock' 
        LIMIT 1
      `;
      branchRow = bRows[0] || null;
    }

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

exports.getBranchShelves = async (req, res) => {
  const { branch_code } = req.query;

  if (!branch_code) {
    return res.status(400).json({ msg: "branch_code is required" });
  }

  try {
    const branchMain = await prisma.branchMain.findUnique({
      where: { branch_code: branch_code },
      select: { branch_name: true },
    });

    const templates = await prisma.shelfTemplate.findMany({
      where: { branch_code },
      orderBy: { shelf_code: "asc" },
      select: {
        shelf_code: true,
        shelf_name: true,
        shelf_total_row: true,
      },
    });

    const skus = await prisma.skuPosition.findMany({
      where: { branch_code },
      select: {
        shelf_code: true,
        shelf_row_number: true,
        shelf_index_number: true,
      },
    });

    const skuByShelf = {};
    skus.forEach((skuPosition) => {
      if (!skuByShelf[skuPosition.shelf_code]) skuByShelf[skuPosition.shelf_code] = [];
      skuByShelf[skuPosition.shelf_code].push(skuPosition);
    });

    const shelves = templates.map((t) => ({
      shelf_code: t.shelf_code,
      shelf_name: t.shelf_name || "",
      shelf_total_row: t.shelf_total_row || 1,
      items: skuByShelf[t.shelf_code] || [],
    }));

    return res.json({
      branch_code,
      branchName: branchMain?.branch_name || null,
      shelves,
    });
  } catch (error) {
    console.error("getBranchShelves error:", error);
    return res.status(500).json({ msg: "Failed to load shelves" });
  }
};

exports.UserTemplateItem = async (req, res) => {
  const branch_code = req.query.branch_code || req.body.branch_code;

  if (!branch_code) {
    return res.status(400).json({ msg: "branch_code is required" });
  }

  const { currentYear, currentMonth } = getBangkokMonthMeta();

  const key = `template-item-v4-${branch_code}-${currentYear}-${currentMonth}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    const br = await prisma.branchMain.findUnique({
      where: { branch_code: branch_code },
      select: { branch_code: true, branch_name: true },
    });

    const rawResult = await prisma.$queryRaw`
      SELECT 
          s."branch_code",
          s."item_code",
          s."shelf_code",
          s."shelf_row_number",
          s."shelf_index_number",
          t."shelf_name" AS "shelf_name",
          p."item_name",
          p."brand_name",
          p."shelf_life_days",
          p."selling_price_vat",
          p."barcode",
          im."min_stock",
          im."max_stock",
          im."pack_order",

          COALESCE(st."quantity_stock", 0)::int AS "quantity_stock"

      FROM "SkuPosition" s
      LEFT JOIN "ShelfTemplate" t
        ON t."branch_code" = s."branch_code"
       AND t."shelf_code"  = s."shelf_code"
      LEFT JOIN (
          SELECT "branch_code", "item_code",
              SUM("quantity_stock")::int AS "quantity_stock"
          FROM "Stock"
          WHERE "branch_code" = ${branch_code}
          GROUP BY "branch_code", "item_code"
      ) st 
      ON s."branch_code" = st."branch_code" 
      AND s."item_code" = st."item_code"
      LEFT JOIN "MasterItem" p 
          ON s."item_code" = p."item_code"
      LEFT JOIN "MinMaxAutoPO" im 
          ON s."branch_code" = im."branch_code" 
          AND s."item_code" = im."item_code"
      WHERE s."branch_code" = ${branch_code}
      ORDER BY s."shelf_code", s."shelf_index_number", s."shelf_row_number"
    `;

    const items = rawResult.map((r) => ({
      branch_code: r.branch_code,
      shelf_code: r.shelf_code,
      shelf_row_number: r.shelf_row_number,
      shelf_index_number: r.shelf_index_number,

      shelf_name: r.shelf_name ?? null,

      item_code:
        r.item_code !== null && r.item_code !== undefined ? r.item_code : null,

      item_name: r.item_name ?? null,
      brand_name: r.brand_name ?? null,
      shelf_life_days: r.shelf_life_days ?? null,

      selling_price_vat:
        r.selling_price_vat !== null && r.selling_price_vat !== undefined
          ? Number(r.selling_price_vat)
          : null,

      barcode: r.barcode ?? null,

      min_stock: r.min_stock !== null && r.min_stock !== undefined ? Number(r.min_stock) : null,
      max_stock: r.max_stock !== null && r.max_stock !== undefined ? Number(r.max_stock) : null,
      pack_order: r.pack_order !== null && r.pack_order !== undefined ? Number(r.pack_order) : null,

      quantity_stock: Number(r.quantity_stock ?? 0),
    }));

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
