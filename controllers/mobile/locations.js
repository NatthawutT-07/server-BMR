// C:\BMR\bmr_data\edit\server-BMR\controllers\mobile\locations.js
const prisma = require("../../config/prisma");

// GET /api/lookup?branchCode=ST002&barcode=8859566512531
const lookupByBarcode = async (req, res) => {
  try {
    const { branchCode, barcode } = req.query;

    if (!branchCode || !barcode) {
      return res.status(400).json({ message: "branchCode, barcode required" });
    }

    // barcode unique อยู่แล้ว ใช้ findUnique ได้
    const item = await prisma.listOfItemHold.findUnique({
      where: { barcode: String(barcode) },
      select: {
        codeProduct: true,
        barcode: true,
        nameProduct: true,
        nameBrand: true,
        salesPriceIncVAT: true,
      },
    });

    if (!item) {
      return res.json({ found: false, reason: "BARCODE_NOT_FOUND" });
    }

    const loc = await prisma.sku.findMany({
      where: { branchCode, codeProduct: item.codeProduct },
      select: { shelfCode: true, rowNo: true, index: true },
      orderBy: [{ shelfCode: "asc" }, { rowNo: "asc" }, { index: "asc" }],
      take: 10,
    });

    if (!loc.length) {
      return res.json({ found: false, reason: "NO_LOCATION_IN_POG", product: item });
    }

    const shelfCodes = [...new Set(loc.map((x) => x.shelfCode))];

    const shelves = await prisma.tamplate.findMany({
      where: { branchCode, shelfCode: { in: shelfCodes } },
      select: { shelfCode: true, fullName: true, rowQty: true },
    });

    const shelfMap = new Map(shelves.map((s) => [s.shelfCode, s]));

    return res.json({
      found: true,
      product: {
        codeProduct: item.codeProduct,
        barcode: item.barcode,
        name: item.nameProduct,
        brand: item.nameBrand,
        price: item.salesPriceIncVAT,
      },
      locations: loc.map((x) => ({
        shelfCode: x.shelfCode,
        shelfName: shelfMap.get(x.shelfCode)?.fullName ?? x.shelfCode,
        rowNo: x.rowNo,
        index: x.index,
      })),
    });
  } catch (err) {
    console.error("lookupByBarcode error:", err);
    return res.status(500).json({ message: "INTERNAL_ERROR" });
  }
};

module.exports = { lookupByBarcode };
