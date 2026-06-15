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
    const { id, branch_code, shelf_code, shelf_row_number, item_code, shelf_index_number } = req.body;

    if (
      (id == null || id === "") &&
      (!branch_code || !shelf_code || shelf_row_number == null || item_code == null || index == null)
    ) {
      return response.error(res, "Missing delete identifiers", "BAD_REQUEST", 400);
    }

    await shelfService.deleteItem({ id, branch_code, shelf_code, shelf_row_number, item_code, shelf_index_number }, req.user?.name);

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


exports.Template = async (req, res) => {
  try {
    const result = await shelfService.getTemplates();
    return response.success(res, result);
  } catch (error) {
    console.error("Template error:", error);
    return response.error(res, "Failed to load templates");
  }
};

exports.sku = async (req, res) => {
  const { branch_code } = req.body;

  if (!branch_code) {
    return response.error(res, "branch_code is required", "BAD_REQUEST", 400);
  }

  const key = `sku-${branch_code}-${new Date().toISOString().slice(0, 10)}`;

  const cached = cache.get(key);
  if (cached) return response.success(res, cached);

  try {
    const { result: rawResult } = await shelfService.getSkuData(branch_code);

    const result = rawResult.map((r) => {
      return {
        branch_code: r.branch_code,
        item_code: r.item_code !== null && r.item_code !== undefined ? r.item_code : null,
        shelf_code: r.shelf_code,
        shelf_row_number: r.shelf_row_number,
        shelf_index_number: r.shelf_index_number,
        item_name: r.item_name ?? null,
        brand_name: r.brand_name ?? null,
        shelf_life_days: r.shelf_life_days ?? null,
        purchase_price: r.purchase_price !== null && r.purchase_price !== undefined ? Number(r.purchase_price) : null,
        selling_price_vat: r.selling_price_vat !== null && r.selling_price_vat !== undefined ? Number(r.selling_price_vat) : null,
        barcode: r.barcode ?? null,
        min_stock: r.min_stock !== null && r.min_stock !== undefined ? Number(r.min_stock) : null,
        max_stock: r.max_stock !== null && r.max_stock !== undefined ? Number(r.max_stock) : null,
        pack_order: r.pack_order !== null && r.pack_order !== undefined ? Number(r.pack_order) : null,
        group_name: r.group_name ?? null,
        quantity_stock: Number(r.quantity_stock ?? 0),
        quantity_withdraw: Number(r.quantity_withdraw ?? 0),
        value_withdraw: Number(r.value_withdraw ?? 0),
        quantity_sale_bill: Number(r.quantity_sale_bill ?? 0),
        total_sales_rounding_no_end_discount: Number(r.total_sales_rounding_no_end_discount ?? 0),
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
  const branch_code = String(req.query.branch_code || "").trim();
  if (!branch_code) {
    return response.error(res, "branch_code is required", "BAD_REQUEST", 400);
  }

  try {
    const shelfSalesRows = await shelfService.getShelfSales(branch_code);

    const shelves = shelfSalesRows.map((row) => ({
      shelf_code: row.shelf_code,
      shelfName: row.shelfName || null,
      salesTotal: Number(row.salesTotal || 0),
      value_withdraw: Number(row.value_withdraw || 0),
      skuCount: Number(row.skuCount || 0),
      stockCost: Number(row.stockCost || 0),
    }));

    return response.success(res, { branch_code, shelves });
  } catch (error) {
    console.error("getShelfDashboardShelfSales error:", error);
    return response.error(res, "shelf dashboard shelf sales error");
  }
};
