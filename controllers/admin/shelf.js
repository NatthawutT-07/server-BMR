const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 1 });
const summaryCache = new NodeCache({ stdTTL: 60 });

const shelfService = require("../../services/admin/shelfService");

const safeStr = (v) => (v == null ? "" : String(v));

const toBkkDateStr = (dateObj) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dateObj);

exports.getMasterItem = async (req, res) => {
  try {
    const qRaw = safeStr(req.query.q).trim();
    if (!qRaw || qRaw.length < 2) return res.json({ items: [] });

    const items = await shelfService.getMasterItem(qRaw);
    return res.json({ items });
  } catch (error) {
    console.error("❌ getMasterItem error:", error);
    return res.status(500).json({ error: "❌ Server error" });
  }
};

exports.itemCreate = async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "❌ No items provided." });
    }

    await shelfService.createItems(items, req.user?.name);

    return res.status(201).json({ success: true, message: "✅ Information added successfully." });
  } catch (error) {
    console.error("❌ Error in itemCreate:", error);
    return res.status(500).json({ success: false, error: "❌ Server error" });
  }
};

exports.itemDelete = async (req, res) => {
  try {
    const { id, branchCode, shelfCode, rowNo, codeProduct, index } = req.body;

    if (
      (id == null || id === "") &&
      (!branchCode || !shelfCode || rowNo == null || codeProduct == null || index == null)
    ) {
      return res.status(400).json({ success: false, message: "❌ Missing delete identifiers" });
    }

    await shelfService.deleteItem({ id, branchCode, shelfCode, rowNo, codeProduct, index }, req.user?.name);

    return res.json({ success: true, message: "✅ Deleted and rearranged successfully" });
  } catch (error) {
    console.error("❌ itemDelete error:", error?.message || error);
    if (error.message === "Item not found") {
      return res.status(404).json({ success: false, message: "❌ Item not found" });
    }
    return res.status(500).json({ success: false, message: "❌ Failed to delete data" });
  }
};

exports.itemUpdate = async (req, res) => {
  try {
    const items = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: "❌ No items provided" });
    }

    await shelfService.updateItems(items, req.user?.name);

    return res.json({ success: true, message: "✅ Shelf update successful" });
  } catch (error) {
    console.error("❌ itemUpdate error:", error);
    return res.status(500).json({ success: false, message: "❌ Shelf update failed" });
  }
};


exports.tamplate = async (req, res) => {
  try {
    const result = await shelfService.getTemplates();
    res.json(result);
  } catch (error) {
    console.error("❌ tamplate error:", error);
    res.status(500).json({ msg: "❌ error" });
  }
};

exports.sku = async (req, res) => {
  const { branchCode } = req.body;

  if (!branchCode) {
    return res.status(400).json({ msg: "❌ branchCode is required" });
  }

  const { startUtc, endUtc } = await shelfService.getDashboardSummary(); // Get dates from service helper if needed, but here we just use the cache key logic

  const key = `sku-${branchCode}-${new Date().toISOString().slice(0, 10)}`;

  const cached = cache.get(key);
  if (cached) return res.json(cached);

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
        stockQuantity: Number(r.stockQuantity ?? 0),
        withdrawQuantity: Number(r.withdrawQuantity ?? 0),
        withdrawValue: Number(r.withdrawValue ?? 0),
        salesQuantity: Number(r.salesQuantity ?? 0),
        salesTotalPrice: Number(r.salesTotalPrice ?? 0),
        salesCurrentMonthQty: Number(r.salesCurrentMonthQty ?? 0),
      };
    });

    cache.set(key, result);
    return res.json(result);
  } catch (error) {
    console.error("❌ sku error:", error);
    return res.status(500).json({ msg: "❌ Failed to retrieve data" });
  }
};

exports.getShelfDashboardSummary = async (req, res) => {
  try {
    const { rows, startUtc, endUtc } = await shelfService.getDashboardSummary();

    const mapped = rows.map((r) => {
      return {
        branchCode: r.branchCode,
        branchName: r.branchName,
        shelfCount: Number(r.shelfCount || 0),
        productCount: Number(r.productCount || 0),
        stockCost: Number(r.stockCost || 0),
        withdrawValue: Number(r.withdrawValue || 0),
        salesTotal: Number(r.salesTotal || 0),
      };
    });

    const payload = {
      range: {
        start: toBkkDateStr(startUtc),
        end: toBkkDateStr(endUtc),
      },
      rows: mapped,
    };

    return res.json(payload);
  } catch (error) {
    console.error("❌ getShelfDashboardSummary error:", error);
    return res.status(500).json({ error: "shelf dashboard summary error" });
  }
};

exports.getShelfDashboardShelfSales = async (req, res) => {
  const branchCode = String(req.query.branchCode || "").trim();
  if (!branchCode) {
    return res.status(400).json({ error: "branchCode is required" });
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

    return res.json({
      branchCode,
      shelves,
    });
  } catch (error) {
    console.error("❌ getShelfDashboardShelfSales error:", error);
    return res.status(500).json({ error: "shelf dashboard shelf sales error" });
  }
};
