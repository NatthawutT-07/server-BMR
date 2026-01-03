const prisma = require("../../config/prisma");

const getShelfBlocks = async (req, res) => {
  try {
    const { branchCode, shelfCode } = req.query;

    if (!branchCode || !shelfCode) {
      return res.status(400).json({ message: "branchCode, shelfCode required" });
    }

    const shelf = await prisma.tamplate.findUnique({
      where: { branchCode_shelfCode: { branchCode, shelfCode } },
      select: { shelfCode: true, fullName: true, rowQty: true, type: true },
    });

    if (!shelf) return res.status(404).json({ message: "SHELF_NOT_FOUND" });

    const skus = await prisma.sku.findMany({
      where: { branchCode, shelfCode },
      select: { rowNo: true, index: true, codeProduct: true },
      orderBy: [{ rowNo: "asc" }, { index: "asc" }],
    });

    if (!skus.length) {
      return res.json({ shelf, rows: [] });
    }

    const codeProducts = [...new Set(skus.map((x) => x.codeProduct))];

    const items = await prisma.listOfItemHold.findMany({
      where: { codeProduct: { in: codeProducts } },
      select: {
        codeProduct: true,
        nameProduct: true,
        nameBrand: true,
        barcode: true,
        salesPriceIncVAT: true,
      },
    });

    const itemMap = new Map(items.map((it) => [it.codeProduct, it]));

    const rows = {};
    for (const s of skus) {
      if (!rows[s.rowNo]) rows[s.rowNo] = [];
      const it = itemMap.get(s.codeProduct);

      rows[s.rowNo].push({
        codeProduct: s.codeProduct,
        index: s.index,
        barcode: it?.barcode ?? null,
        name: it?.nameProduct ?? null,
        brand: it?.nameBrand ?? null,
        price: it?.salesPriceIncVAT ?? null,
      });
    }

    return res.json({
      shelf,
      rows: Object.keys(rows)
        .sort((a, b) => Number(a) - Number(b))
        .map((r) => ({
          rowNo: Number(r),
          items: rows[r],
        })),
    });
  } catch (err) {
    console.error("getShelfBlocks error:", err);
    return res.status(500).json({ message: "INTERNAL_ERROR" });
  }
};

module.exports = { getShelfBlocks };
