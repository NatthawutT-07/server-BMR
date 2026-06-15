const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");
const { serialize } = require("../../utils/serializer");


exports.stockBrandLookup = async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return response.error(
        res,
        "กรุณาระบุวันที่เริ่มต้นและสิ้นสุด",
        "VALIDATION_ERROR",
        400
      );
    }

    const items = await prisma.masterItem.findMany({
      select: {
        item_code: true,
        item_name: true,
        brand_name: true,
        is_consignment: true,
      },
    });

    const salesRows = serialize(
      await prisma.$queryRaw`
        SELECT
          LPAD(COALESCE(NULLIF(regexp_replace(rb."item_code", '[^0-9]', '', 'g'), ''), '0'), 5, '0') AS "item_code",
          COALESCE(SUM(rb."quantity_sale_bill"), 0)      AS "quantity_sale_bill",
          COALESCE(SUM(rb."total_sales_Finally"), 0)   AS "total_sales_Finally"
        FROM "RawBill" rb
        WHERE rb."item_code" IS NOT NULL
          AND rb."item_code" != ''
          AND rb."date" IS NOT NULL
          AND rb."date" != ''
          AND to_date(rb."date", 'DD/MM/YYYY') >= to_date(${startDate}, 'YYYY-MM-DD')
          AND to_date(rb."date", 'DD/MM/YYYY') <= to_date(${endDate}, 'YYYY-MM-DD')
        GROUP BY LPAD(COALESCE(NULLIF(regexp_replace(rb."item_code", '[^0-9]', '', 'g'), ''), '0'), 5, '0')
      `
    );

    const withdrawRows = serialize(
      await prisma.$queryRaw`
        SELECT
          "item_code",
          COALESCE(SUM("quantity"), 0)::int AS "quantity_withdraw"
        FROM "Withdraw"
        WHERE "document_status" = 'อนุมัติแล้ว'
          AND "reason" = 'เบิกหมดอายุ'
          AND to_date("date_withdraw", 'DD/MM/YYYY') >= to_date(${startDate}, 'YYYY-MM-DD')
          AND to_date("date_withdraw", 'DD/MM/YYYY') <= to_date(${endDate}, 'YYYY-MM-DD')
        GROUP BY "item_code"
      `
    );

    const stockRows = serialize(
      await prisma.$queryRaw`
        SELECT
          "item_code",
          COALESCE(SUM("quantity"), 0)::int AS "quantity_stock"
        FROM "Stock"
        GROUP BY "item_code"
      `
    );

    const salesMap = new Map();
    for (const r of salesRows) {
      if (r.item_code !== null && r.item_code !== undefined) {
        const existing = salesMap.get(r.item_code) || { quantity_sale_bill: 0, total_sales_Finally: 0 };
        salesMap.set(r.item_code, {
          quantity_sale_bill: existing.quantity_sale_bill + (Number(r.quantity_sale_bill) || 0),
          total_sales_Finally: existing.total_sales_Finally + (Number(r.total_sales_Finally) || 0),
        });
      }
    }
    const withdrawMap = new Map(
      withdrawRows.map((r) => [r.item_code, r.quantity_withdraw])
    );
    const stockMap = new Map(
      stockRows.map((r) => [r.item_code, r.quantity_stock])
    );

    const brandMap = new Map();

    for (const item of items) {
      const brand = item.brand_name ? item.brand_name.trim() : "";
      if (!brand || brand === "ไม่ระบุ") {
        continue;
      }
      const code = item.item_code;

      const sales = salesMap.get(code) || { quantity_sale_bill: 0, total_sales_Finally: 0 };
      const wdQty = withdrawMap.get(code) || 0;
      const skQty = stockMap.get(code) || 0;

      if (!brandMap.has(brand)) {
        brandMap.set(brand, {
          brand_name: brand,
          is_consignment: item.is_consignment || "-",
          quantity_stock: 0,
          quantity_sale_bill: 0,
          total_sales_Finally: 0,
          quantity_withdraw: 0,
        });
      }

      const b = brandMap.get(brand);
      b.quantity_stock += skQty;
      b.quantity_sale_bill += Number(sales.quantity_sale_bill) || 0;
      b.total_sales_Finally += Number(sales.total_sales_Finally) || 0;
      b.quantity_withdraw += wdQty;
    }

    const rows = Array.from(brandMap.values());

    rows.sort((a, b) => b.total_sales_Finally - a.total_sales_Finally);

    const kpi = {
      totalSalesValue: rows.reduce((s, r) => s + r.total_sales_Finally, 0),
      totalSalesQty: rows.reduce((s, r) => s + r.quantity_sale_bill, 0),
      totalWithdrawQty: rows.reduce((s, r) => s + r.quantity_withdraw, 0),
      totalStockQty: rows.reduce((s, r) => s + r.quantity_stock, 0),
    };

    return response.success(res, { kpi, rows });
  } catch (err) {
    console.error("stockBrandLookup error:", err);
    return response.error(res, "เกิดข้อผิดพลาดในการค้นหาข้อมูล");
  }
};
