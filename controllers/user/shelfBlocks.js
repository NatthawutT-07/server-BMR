const prisma = require("../../config/prisma");

const getShelfBlocks = async (req, res) => {
  try {
    const { branch_code, shelf_code } = req.query;

    if (!branch_code || !shelf_code) {
      return res.status(400).json({ message: "branch_code, shelf_code required" });
    }

    const shelf = await prisma.shelfTemplate.findUnique({
      where: { branch_code_shelf_code: { branch_code, shelf_code } },
      select: { shelf_code: true, shelf_name: true, shelf_total_row: true, type: true },
    });

    if (!shelf) return res.status(404).json({ message: "SHELF_NOT_FOUND" });

    const skus = await prisma.skuPosition.findMany({
      where: { branch_code, shelf_code },
      select: { shelf_row_number: true, shelf_index_number: true, item_code: true },
      orderBy: [{ shelf_row_number: "asc" }, { shelf_index_number: "asc" }],
    });

    if (!skus.length) {
      return res.json({ shelf, rows: [] });
    }

    const item_codes = [...new Set(skus.map((x) => x.item_code))];

    const items = await prisma.masterItem.findMany({
      where: { item_code: { in: item_codes } },
      select: {
        item_code: true,
        item_name: true,
        brand_name: true,
        barcode: true,
        selling_price_vat: true,
      },
    });

    const itemMap = new Map(items.map((it) => [it.item_code, it]));

    const rows = {};
    for (const s of skus) {
      if (!rows[s.shelf_row_number]) rows[s.shelf_row_number] = [];
      const it = itemMap.get(s.item_code);

      rows[s.shelf_row_number].push({
        item_code: s.item_code,
        shelf_index_number: s.shelf_index_number,
        barcode: it?.barcode ?? null,
        name: it?.item_name ?? null,
        brand: it?.brand_name ?? null,
        price: it?.selling_price_vat ?? null,
      });
    }

    return res.json({
      shelf,
      rows: Object.keys(rows)
        .sort((a, b) => Number(a) - Number(b))
        .map((r) => ({
          shelf_row_number: Number(r),
          items: rows[r],
        })),
    });
  } catch (err) {
    console.error("getShelfBlocks error:", err);
    return res.status(500).json({ message: "INTERNAL_ERROR" });
  }
};

module.exports = { getShelfBlocks };
