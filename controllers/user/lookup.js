const prisma = require("../../config/prisma");

// GET /api/lookup?branch_code=ST002&barcode=8859566512531
const lookupByBarcode = async (req, res) => {
  try {
    const { branch_code, barcode } = req.query;

    if (!branch_code || !barcode) {
      return res.status(400).json({ message: "branch_code, barcode required" });
    }

    // barcode ไม่ใช่ unique field ใช้ findFirst แทน
    const item = await prisma.listOfItemHold.findFirst({
      where: { barcode: String(barcode) },
      select: {
        item_code: true,
        barcode: true,
        item_name: true,
        brand_name: true,
        selling_price_vat: true,
      },
    });

    if (!item) {
      return res.json({ found: false, reason: "BARCODE_NOT_FOUND" });
    }

    const loc = await prisma.sku.findMany({
      where: { branch_code, item_code: item.item_code },
      select: { shelf_code: true, shelf_row_number: true, shelf_index_number: true },
      orderBy: [{ shelf_code: "asc" }, { shelf_row_number: "asc" }, { shelf_index_number: "asc" }],
      take: 10,
    });

    if (!loc.length) {
      return res.json({
        found: false,
        reason: "NO_LOCATION_IN_POG",
        product: {
          item_code: item.item_code,
          barcode: item.barcode,
          name: item.item_name,
          brand: item.brand_name,
          price: item.selling_price_vat,
        },
      });
    }

    const shelf_codes = [...new Set(loc.map((x) => x.shelf_code))];

    const shelves = await prisma.Template.findMany({
      where: { branch_code, shelf_code: { in: shelf_codes } },
      select: { shelf_code: true, shelf_name: true, shelf_total_row: true },
    });

    const shelfMap = new Map(shelves.map((s) => [s.shelf_code, s]));

    return res.json({
      found: true,
      product: {
        item_code: item.item_code,
        barcode: item.barcode,
        name: item.item_name,
        brand: item.brand_name,
        price: item.selling_price_vat,
      },
      locations: loc.map((x) => ({
        shelf_code: x.shelf_code,
        shelfName: shelfMap.get(x.shelf_code)?.shelf_name ?? x.shelf_code,
        shelf_row_number: x.shelf_row_number,
        shelf_index_number: x.shelf_index_number,
      })),
    });
  } catch (err) {
    console.error("lookupByBarcode error:", err.message);
    console.error("lookupByBarcode stack:", err.stack);

    // Return standardized error format
    return res.status(500).json({
      ok: false,
      code: "ERROR",
      message: "INTERNAL_ERROR",
      debug: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = { lookupByBarcode };
