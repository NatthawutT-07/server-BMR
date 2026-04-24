const cacheManager = require("../../utils/cacheManager");
const cache = cacheManager.getCache("shelf-sku", { stdTTL: 60 });
const summaryCache = cacheManager.getCache("shelf-summary", { stdTTL: 300 });

const shelfService = require("../../services/admin/shelfService");
const { serialize } = require("../../utils/serializer");
const response = require("../../utils/responseHelper");

const dateHelper = require("../../utils/dateHelper");

const safeStr = (v) => (v == null ? "" : String(v));

exports.getMasterItem = async (req, res) => {
  try {
    const qRaw = safeStr(req.query.q).trim();
    if (!qRaw || qRaw.length < 2) return response.success(res, { items: [] });

    const items = await shelfService.getMasterItem(qRaw);
    return response.success(res, { items });
  } catch (error) {
    console.error("getMasterItem error:", error);
    return response.error(res, "Server error");
  }
};

exports.itemCreate = async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || items.length === 0) {
      return response.error(res, "No items provided.", "BAD_REQUEST", 400);
    }

    await shelfService.createItems(items, req.user?.name);

    return response.success(res, null, null, "Information added successfully.", 201);
  } catch (error) {
    console.error("Error in itemCreate:", error);
    return response.error(res, "Server error");
  }
};

exports.itemDelete = async (req, res) => {
  try {
    const { id, branchCode, shelfCode, rowNo, codeProduct, index } = req.body;

    if (
      (id == null || id === "") &&
      (!branchCode || !shelfCode || rowNo == null || codeProduct == null || index == null)
    ) {
      return response.error(res, "Missing delete identifiers", "BAD_REQUEST", 400);
    }

    await shelfService.deleteItem({ id, branchCode, shelfCode, rowNo, codeProduct, index }, req.user?.name);

    return response.success(res, null, null, "Deleted and rearranged successfully");
  } catch (error) {
    console.error("itemDelete error:", error?.message || error);
    if (error.message === "Item not found") {
      return response.error(res, "Item not found", "NOT_FOUND", 404);
    }
    return response.error(res, "Failed to delete data");
  }
};

exports.itemUpdate = async (req, res) => {
  try {
    const items = req.body;
    if (!items || items.length === 0) {
      return response.error(res, "No items provided", "BAD_REQUEST", 400);
    }

    await shelfService.updateItems(items, req.user?.name);

    return response.success(res, null, null, "Shelf update successful");
  } catch (error) {
    console.error("itemUpdate error:", error);
    return response.error(res, "Shelf update failed");
  }
};


exports.tamplate = async (req, res) => {
  try {
    const result = await shelfService.getTemplates();
    return response.success(res, result);
  } catch (error) {
    console.error("tamplate error:", error);
    return response.error(res, "Failed to load templates");
  }
};

exports.sku = async (req, res) => {
  const { branchCode } = req.body;

  if (!branchCode) {
    return response.error(res, "branchCode is required", "BAD_REQUEST", 400);
  }

  const { startUtc, endUtc } = await shelfService.getDashboardSummary();

  const key = `sku-${branchCode}-${new Date().toISOString().slice(0, 10)}`;

  const cached = cache.get(key);
  if (cached) return response.success(res, cached);

  try {
    const { result: rawResult } = await shelfService.getSkuData(branchCode);

    const result = rawResult.map((r) => {
      return {
        branchCode: r.branchCode,
        codeProduct: r.codeProduct !== null && r.codeProduct !== undefined ? Number(r.codeProduct) : null,
        shelfCode: r.shelfCode,
        rowNo: r.rowNo,
        index: r.index,
        nameProduct: r.nameProduct ?? null,
        nameBrand: r.nameBrand ?? null,
        shelfLife: r.shelfLife ?? null,
        purchasePriceExcVAT: r.purchasePriceExcVAT !== null && r.purchasePriceExcVAT !== undefined ? Number(r.purchasePriceExcVAT) : null,
        salesPriceIncVAT: r.salesPriceIncVAT !== null && r.salesPriceIncVAT !== undefined ? Number(r.salesPriceIncVAT) : null,
        barcode: r.barcode ?? null,
        minStore: r.minStore !== null && r.minStore !== undefined ? Number(r.minStore) : null,
        maxStore: r.maxStore !== null && r.maxStore !== undefined ? Number(r.maxStore) : null,
        packOrder: r.packOrder !== null && r.packOrder !== undefined ? Number(r.packOrder) : null,
        groupName: r.groupName ?? null,
        stockQuantity: Number(r.stockQuantity ?? 0),
        withdrawQuantity: Number(r.withdrawQuantity ?? 0),
        withdrawValue: Number(r.withdrawValue ?? 0),
        salesQuantity: Number(r.salesQuantity ?? 0),
        salesTotalPrice: Number(r.salesTotalPrice ?? 0),
        dayOff: r.dayOff !== null && r.dayOff !== undefined ? Number(r.dayOff) : null,
      };
    });

    cache.set(key, result);
    return response.success(res, result);
  } catch (error) {
    console.error("sku error:", error);
    return response.error(res, "Failed to retrieve data");
  }
};

exports.getShelfDashboardSummary = async (req, res) => {
  try {
    const { rows, startUtc, endUtc, overallUniqueSkus, missingSalesDates } = await shelfService.getDashboardSummary();

    const data = serialize(rows);
    const meta = {
      range: {
        start: startUtc.toISOString().slice(0, 10),
        end: endUtc.toISOString().slice(0, 10),
      },
      overallUniqueSkus,
      missingSalesDates
    };

    return response.success(res, data, meta);
  } catch (error) {
    console.error("getShelfDashboardSummary error:", error);
    return response.error(res, "shelf dashboard summary error");
  }
};

exports.getShelfDashboardShelfSales = async (req, res) => {
  const branchCode = String(req.query.branchCode || "").trim();
  if (!branchCode) {
    return response.error(res, "branchCode is required", "BAD_REQUEST", 400);
  }

  try {
    const shelfSalesRows = await shelfService.getShelfSales(branchCode);

    const shelves = shelfSalesRows.map((row) => ({
      shelfCode: row.shelfCode,
      shelfName: row.shelfName || null,
      salesTotal: Number(row.salesTotal || 0),
      withdrawValue: Number(row.withdrawValue || 0),
      skuCount: Number(row.skuCount || 0),
      stockCost: Number(row.stockCost || 0),
    }));

    return response.success(res, { branchCode, shelves });
  } catch (error) {
    console.error("getShelfDashboardShelfSales error:", error);
    return response.error(res, "shelf dashboard shelf sales error");
  }
};
