const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");
const { serialize } = require("../../utils/serializer");

/**
 * POST /api/stock-brand-lookup
 * Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
 *
 * ดึงข้อมูลสินค้าจาก ListOfItemHold ทั้งหมด
 * ยอดขาย → query จาก RawBill (ตารางแยกอิสระ) โดยแปลง date (DD/MM/YYYY) เป็น date จริง
 * withdraw, Stock → query จากตารางเดิม
 * รวมกลุ่มตาม nameBrand → ส่ง KPI + rows
 */
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

    // ─── 1) ListOfItemHold: สินค้าทั้งหมด ───
    const items = await prisma.listOfItemHold.findMany({
      select: {
        item_code: true,
        nameProduct: true,
        nameBrand: true,
        consingItem: true,
      },
    });

    // ─── 2) Sales: query จาก RawBill (date เก็บเป็น DD/MM/YYYY) ───
    // ใช้ quantity สำหรับจำนวน และ total_sales สำหรับยอดขาย
    const salesRows = serialize(
      await prisma.$queryRaw`
        SELECT
          LPAD(COALESCE(NULLIF(regexp_replace(rb."item_code", '[^0-9]', '', 'g'), ''), '0'), 5, '0') AS "item_code",
          COALESCE(SUM(rb."quantity"), 0)      AS "salesQty",
          COALESCE(SUM(rb."total_sales"), 0)   AS "salesValue"
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

    // ─── 3) Withdraw: date range (date เป็น String "DD/MM/YYYY" ใน DB) ───
    const withdrawRows = serialize(
      await prisma.$queryRaw`
        SELECT
          "item_code",
          COALESCE(SUM("quantity"), 0)::int AS "withdrawQty"
        FROM "withdraw"
        WHERE "docStatus" = 'อนุมัติแล้ว'
          AND "reason" = 'เบิกหมดอายุ'
          AND to_date("date", 'DD/MM/YYYY') >= to_date(${startDate}, 'YYYY-MM-DD')
          AND to_date("date", 'DD/MM/YYYY') <= to_date(${endDate}, 'YYYY-MM-DD')
        GROUP BY "item_code"
      `
    );

    // ─── 4) Stock: current quantity (ไม่ขึ้นกับ date) ───
    const stockRows = serialize(
      await prisma.$queryRaw`
        SELECT
          "item_code",
          COALESCE(SUM("quantity"), 0)::int AS "stockQty"
        FROM "Stock"
        GROUP BY "item_code"
      `
    );

    // ─── Build lookup maps ───
    const salesMap = new Map();
    for (const r of salesRows) {
      if (r.item_code !== null && r.item_code !== undefined) {
        const existing = salesMap.get(r.item_code) || { salesQty: 0, salesValue: 0 };
        salesMap.set(r.item_code, {
          salesQty: existing.salesQty + (Number(r.salesQty) || 0),
          salesValue: existing.salesValue + (Number(r.salesValue) || 0),
        });
      }
    }
    const withdrawMap = new Map(
      withdrawRows.map((r) => [r.item_code, r.withdrawQty])
    );
    const stockMap = new Map(
      stockRows.map((r) => [r.item_code, r.stockQty])
    );

    // ─── Merge & group by nameBrand ───
    const brandMap = new Map();

    for (const item of items) {
      const brand = item.nameBrand ? item.nameBrand.trim() : "";
      // ข้ามถ้าไม่มีแบรนด์ที่แมพกันได้ หรือเป็น "ไม่ระบุ"
      if (!brand || brand === "ไม่ระบุ") {
        continue;
      }
      const code = item.item_code;

      const sales = salesMap.get(code) || { salesQty: 0, salesValue: 0 };
      const wdQty = withdrawMap.get(code) || 0;
      const skQty = stockMap.get(code) || 0;

      if (!brandMap.has(brand)) {
        brandMap.set(brand, {
          nameBrand: brand,
          consingItem: item.consingItem || "-",
          stockQty: 0,
          salesQty: 0,
          salesValue: 0,
          withdrawQty: 0,
        });
      }

      const b = brandMap.get(brand);
      b.stockQty += skQty;
      b.salesQty += Number(sales.salesQty) || 0;
      b.salesValue += Number(sales.salesValue) || 0;
      b.withdrawQty += wdQty;
    }

    const rows = Array.from(brandMap.values());

    // เรียงตาม salesValue มากสุดขึ้นก่อน
    rows.sort((a, b) => b.salesValue - a.salesValue);

    // ─── KPI totals ───
    const kpi = {
      totalSalesValue: rows.reduce((s, r) => s + r.salesValue, 0),
      totalSalesQty: rows.reduce((s, r) => s + r.salesQty, 0),
      totalWithdrawQty: rows.reduce((s, r) => s + r.withdrawQty, 0),
      totalStockQty: rows.reduce((s, r) => s + r.stockQty, 0),
    };

    return response.success(res, { kpi, rows });
  } catch (err) {
    console.error("stockBrandLookup error:", err);
    return response.error(res, "เกิดข้อผิดพลาดในการค้นหาข้อมูล");
  }
};
