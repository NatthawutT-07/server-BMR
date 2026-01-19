const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 1 });
const summaryCache = new NodeCache({ stdTTL: 60 });

const prisma = require("../../config/prisma");
const { lockKey, releaseLock, acquireLock } = require("../../utils/lock");
const { markShelfUpdated, createShelfChangeLogs, createSingleChangeLog } = require("./shelfUpdate");




const safeStr = (v) => (v == null ? "" : String(v));
const digitsOnly = (s) => safeStr(s).replace(/\D/g, ""); // เหลือแต่ตัวเลข

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

    const qDigits = digitsOnly(qRaw);

    // ค้นแบบปกติ (barcode/name/brand)
    const normal = await prisma.listOfItemHold.findMany({
      where: {
        OR: [
          { barcode: { contains: qRaw, mode: "insensitive" } },
          { nameProduct: { contains: qRaw, mode: "insensitive" } },
          { nameBrand: { contains: qRaw, mode: "insensitive" } },
        ],
      },
      select: { codeProduct: true, barcode: true, nameProduct: true, nameBrand: true },
      take: 50,
    });

    // ถ้าเป็นตัวเลข (barcode) ให้ค้นแบบ normalize เพิ่ม (ตัด \D ใน DB)
    let normalized = [];
    if (qDigits.length >= 6) {
      normalized = await prisma.$queryRaw`
        SELECT "codeProduct", "barcode", "nameProduct", "nameBrand"
        FROM "ListOfItemHold"
        WHERE regexp_replace(COALESCE("barcode", ''), '\\D', '', 'g') LIKE ${"%" + qDigits + "%"}
        LIMIT 50;
      `;
    }

    // merge + กันซ้ำด้วย codeProduct
    const map = new Map();
    [...normal, ...normalized].forEach((it) => {
      if (it?.codeProduct != null) map.set(Number(it.codeProduct), it);
    });

    return res.json({ items: Array.from(map.values()).slice(0, 20) });
  } catch (error) {
    console.error("❌ getMasterItem error:", error);
    return res.status(500).json({ error: "❌ Server error" });
  }
};



exports.itemCreate = async (req, res) => {
  let key = null;

  try {
    const { items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "❌ No items provided." });
    }

    const { branchCode, shelfCode } = items[0];
    key = lockKey(branchCode, shelfCode);

    await acquireLock(prisma, key);

    const itemsToInsert = items.map((item) => ({
      branchCode: item.branchCode,
      codeProduct: Number(item.codeProduct),
      shelfCode: item.shelfCode,
      rowNo: Number(item.rowNo),
      index: Number(item.index),
    }));

    await prisma.sku.createMany({
      data: itemsToInsert,
      skipDuplicates: true,
    });

    // ✅ Create change log for add action
    await createSingleChangeLog(branchCode, shelfCode, "add", itemsToInsert, req.user?.name);

    // ✅ Mark shelf update for this branch
    await markShelfUpdated(branchCode, req.user?.name);

    return res.status(201).json({ success: true, message: "✅ Information added successfully." });
  } catch (error) {
    console.error("❌ Error in itemCreate:", error);
    return res.status(500).json({ success: false, error: "❌ Server error" });
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("❌ releaseLock failed (itemCreate):", e?.message || e);
      }
    }
  }
};

exports.itemDelete = async (req, res) => {
  let key = null;

  try {
    const { id, branchCode, shelfCode, rowNo, codeProduct, index } = req.body;

    // ต้องมีอย่างน้อย id หรือ (branchCode+shelfCode+rowNo+codeProduct+index)
    if (
      (id == null || id === "") &&
      (!branchCode || !shelfCode || rowNo == null || codeProduct == null || index == null)
    ) {
      return res.status(400).json({ success: false, message: "❌ Missing delete identifiers" });
    }

    // ใช้ key จาก branch/shelf (ถ้าไม่มี branch/shelf แต่มี id อย่างเดียว -> หา key จาก DB)
    let bc = branchCode;
    let sc = shelfCode;

    if ((bc == null || sc == null) && id != null) {
      const found = await prisma.sku.findUnique({ where: { id: Number(id) } });
      if (!found) return res.status(404).json({ success: false, message: "❌ Item not found" });
      bc = found.branchCode;
      sc = found.shelfCode;
    }

    key = lockKey(bc, sc);
    await acquireLock(prisma, key);

    // ดึงข้อมูลสินค้าก่อนลบเพื่อเก็บ log
    let deletedItem = null;
    if (id != null && id !== "") {
      deletedItem = await prisma.sku.findUnique({ where: { id: Number(id) } });
    } else {
      deletedItem = {
        branchCode: bc,
        shelfCode: sc,
        rowNo: Number(rowNo),
        index: Number(index),
        codeProduct: Number(codeProduct),
      };
    }

    // ---------- delete target ----------
    if (id != null && id !== "") {
      await prisma.sku.deleteMany({ where: { id: Number(id) } }); // ใช้ deleteMany กันพังถ้าไม่มี
    } else {
      const rowNoNum = Number(rowNo);
      const codeProductNum = Number(codeProduct);
      const indexNum = Number(index);

      await prisma.sku.deleteMany({
        where: {
          branchCode: bc,
          shelfCode: sc,
          rowNo: rowNoNum,
          codeProduct: codeProductNum,
          index: indexNum,
        },
      });
    }

    // ---------- reindex remaining (ต้องมี rowNo แน่นอน) ----------
    const rowNoNum2 = Number(rowNo);

    const remainingItems = await prisma.sku.findMany({
      where: { branchCode: bc, shelfCode: sc, rowNo: rowNoNum2 },
      orderBy: { index: "asc" },
    });

    if (remainingItems.length > 0) {
      const updateOps = remainingItems.map((item, i) =>
        prisma.sku.update({
          where: { id: item.id },
          data: { index: i + 1 },
        })
      );
      await prisma.$transaction(updateOps);
    }

    // ✅ Create change log for delete action
    if (deletedItem) {
      await createSingleChangeLog(bc, sc, "delete", [deletedItem], req.user?.name);
    }

    // ✅ Mark shelf update for this branch
    await markShelfUpdated(bc, req.user?.name);

    return res.json({ success: true, message: "✅ Deleted and rearranged successfully" });
  } catch (error) {
    console.error("❌ itemDelete error:", error?.message || error);
    return res.status(500).json({ success: false, message: "❌ Failed to delete data" });
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("❌ releaseLock failed (itemDelete):", e?.message || e);
      }
    }
  }
};

exports.itemUpdate = async (req, res) => {
  let key = null;

  const items = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: "❌ No items provided" });
  }

  try {
    const branchCode = items[0].branchCode;
    const shelfCode = items[0].shelfCode;

    key = lockKey(branchCode, shelfCode);
    await acquireLock(prisma, key);

    // ✅ ดึงข้อมูลเก่าก่อน (สำหรับ compare change logs)
    const oldItems = await prisma.sku.findMany({
      where: { branchCode, shelfCode },
      select: { codeProduct: true, rowNo: true, index: true },
    });

    const itemsToInsert = items.map((item) => ({
      branchCode: item.branchCode,
      shelfCode: item.shelfCode,
      rowNo: Number(item.rowNo),
      index: Number(item.index),
      codeProduct: Number(item.codeProduct),
    }));

    await prisma.$transaction([
      prisma.sku.deleteMany({ where: { branchCode, shelfCode } }),
      prisma.sku.createMany({ data: itemsToInsert }),
    ]);

    // ✅ สร้าง change logs (compare old vs new)
    const newItems = itemsToInsert.map((i) => ({
      codeProduct: i.codeProduct,
      rowNo: i.rowNo,
      index: i.index,
    }));
    await createShelfChangeLogs(branchCode, shelfCode, oldItems, newItems, req.user?.name);

    // ✅ Mark shelf update for this branch
    await markShelfUpdated(branchCode, req.user?.name);

    return res.json({ success: true, message: "✅ Shelf update successful" });
  } catch (error) {
    console.error("❌ itemUpdate error:", error);
    return res.status(500).json({ success: false, message: "❌ Shelf update failed" });
  } finally {
    if (key) {
      try {
        await releaseLock(prisma, key);
      } catch (e) {
        console.error("❌ releaseLock failed (itemUpdate):", e?.message || e);
      }
    }
  }
};


exports.tamplate = async (req, res) => {
  try {
    const result = await prisma.tamplate.findMany({
      orderBy: { id: "asc" },
    });
    res.json(result);
  } catch (error) {
    console.error("❌ tamplate error:", error);
    res.status(500).json({ msg: "❌ error" });
  }
};



/**
 * Helper: แปลง "วันเวลาไทย" (ปี/เดือน/วัน/เวลา) → เป็น Date UTC
 * year: 2025, month: 1–12, day: 1–31, timeStr: "HH:MM:SS.sss"
 * คืนค่า: Date ที่ตรงกับเวลาไทยนั้น (offset +07:00) ในรูปแบบ UTC
 */
const makeBangkokDateTimeUtc = (year, month, day, timeStr) => {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  // รูปแบบเช่น "2025-01-31T23:59:59.999+07:00"
  return new Date(`${y}-${m}-${d}T${timeStr}+07:00`);
};

/**
 * helper: ช่วงเวลา 90 วันย้อนหลัง (ยึดตามเวลา Asia/Bangkok) และใช้ yesterday เป็นวันสุดท้าย
 * → คืนค่าเป็น Date UTC { startUtc, endUtc }
 * → ใช้สำหรับ Sales Qty / Sales Amount (90 วัน)
 */
const getBangkok90DaysRangeUtc = () => {
  const now = new Date();
  const bangkokNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })
  );

  // yesterday ตามเวลาไทย
  const endThai = new Date(bangkokNow);
  endThai.setDate(endThai.getDate() - 1);
  const endYear = endThai.getFullYear();
  const endMonth = endThai.getMonth() + 1;
  const endDay = endThai.getDate();

  // start = yesterday - 89 วัน (รวมเป็น 90 วัน)
  const startThai = new Date(endThai);
  startThai.setDate(startThai.getDate() - 89);
  const startYear = startThai.getFullYear();
  const startMonth = startThai.getMonth() + 1;
  const startDay = startThai.getDate();

  const startUtc = makeBangkokDateTimeUtc(startYear, startMonth, startDay, "00:00:00.000");
  const endUtc = makeBangkokDateTimeUtc(endYear, endMonth, endDay, "23:59:59.999");

  return { startUtc, endUtc };
};

/**
 * helper: แปลง "ช่วงเดือนตามเวลาไทย" → เป็นช่วงเวลา UTC (Date)
 * - year: ปี (เช่น 2025)
 * - month: เดือน 1–12
 * คืนค่า: { startUtc, endUtc }
 *   startUtc = 00:00:00 ของวันแรกของเดือนนั้น (เวลาไทย) แปลงเป็น UTC
 *   endUtc   = 23:59:59.999 ของวันสุดท้ายของเดือนนั้น (เวลาไทย) แปลงเป็น UTC
 */
const getMonthRangeUtcFromBangkok = (year, month) => {
  const startThai = new Date(year, month - 1, 1, 0, 0, 0, 0); // local แต่เราเอาเฉพาะ y/m/d
  const startYear = startThai.getFullYear();
  const startMonth = startThai.getMonth() + 1;
  const startDay = startThai.getDate();

  // ไปเดือนถัดไป แล้วถอยกลับมา 1 ms = สิ้นเดือน
  const nextMonthThai = new Date(startThai);
  nextMonthThai.setMonth(nextMonthThai.getMonth() + 1);
  nextMonthThai.setMilliseconds(nextMonthThai.getMilliseconds() - 1);

  const endYear = nextMonthThai.getFullYear();
  const endMonth = nextMonthThai.getMonth() + 1;
  const endDay = nextMonthThai.getDate();

  const startUtc = makeBangkokDateTimeUtc(startYear, startMonth, startDay, "00:00:00.000");
  const endUtc = makeBangkokDateTimeUtc(endYear, endMonth, endDay, "23:59:59.999");

  return { startUtc, endUtc };
};

/**
 * helper: คืนค่า meta เดือนตามเวลาไทย
 * - currentYear/currentMonth  = เดือนปัจจุบันตามเวลาไทย
 * - prevMonths = array 3 ตัวของ 3 เดือนก่อนหน้า (ตามเวลาไทย)
 *   แต่ละตัวมี { year, month, startUtc, endUtc }
 */
const getBangkokMonthMeta = () => {
  const now = new Date();
  const bangkokNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })
  );

  const currentYear = bangkokNow.getFullYear();
  const currentMonth = bangkokNow.getMonth() + 1; // 1–12

  const prevMonths = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(bangkokNow);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);

    const y = d.getFullYear();
    const m = d.getMonth() + 1;

    const { startUtc, endUtc } = getMonthRangeUtcFromBangkok(y, m);

    prevMonths.push({
      year: y,
      month: m, // 1–12
      startUtc,
      endUtc,
    });
  }

  // เดือนปัจจุบัน (ไว้ใช้ถ้าต้องการช่วงทั้งเดือน)
  const { startUtc: currentMonthStartUtc, endUtc: currentMonthEndUtc } =
    getMonthRangeUtcFromBangkok(currentYear, currentMonth);

  return {
    currentYear,
    currentMonth,
    currentMonthStartUtc,
    currentMonthEndUtc,
    prevMonths,
  };
};

exports.sku = async (req, res) => {
  const { branchCode } = req.body;

  if (!branchCode) {
    return res.status(400).json({ msg: "❌ branchCode is required" });
  }

  // 🔹 ช่วง 90 วัน (ตามเวลาไทย) → แปลงเป็น UTC สำหรับ WHERE b."date"
  const { startUtc, endUtc } = getBangkok90DaysRangeUtc();

  // 🔹 meta เดือน สำหรับ 3M / current month (คิดจากเวลาไทย)
  const {
    currentYear,
    currentMonth,
    currentMonthStartUtc,
    currentMonthEndUtc,
    prevMonths,
  } = getBangkokMonthMeta();

  // cache key ผูกกับ branchCode + ช่วงวันที่ (กันข้อมูลค้างข้ามวัน)
  const key = `sku-${branchCode}-${startUtc.toISOString().slice(0, 10)}-${endUtc
    .toISOString()
    .slice(0, 10)}`;

  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    const rawResult = await prisma.$queryRaw`
        SELECT 
            s."branchCode",
            s."codeProduct",
            s."shelfCode",
            s."rowNo",
            s."index",
            p."nameProduct",
            p."nameBrand",
            p."purchasePriceExcVAT",
            p."salesPriceIncVAT",
            p."shelfLife",
            p."barcode", 
            im."minStore",
            im."maxStore",

            -- 🟢 รวมยอด Stock
            COALESCE(st."stockQuantity", 0)::int AS "stockQuantity",

            -- 🟢 รวมยอด Withdraw (เฉพาะ docStatus = 'อนุมัติแล้ว')
            COALESCE(wd."withdrawQuantity", 0)::int   AS "withdrawQuantity",
            COALESCE(wd."withdrawValue", 0)::float8   AS "withdrawValue",

            -- 🟢 ยอดขาย 90 วันล่าสุดจาก Bill/BillItem (net_sales) → ใช้ทำ Sales Qty / Amount
            COALESCE(bs."quantity_total", 0)::int     AS "salesQuantity",
            COALESCE(bs."net_sales_total", 0)::float8 AS "salesTotalPrice",

            -- 🟢 ยอดขาย 3 เดือนก่อนหน้า (ตาม "เดือนเวลาไทย" แต่ใช้ช่วง UTC)
            COALESCE(p3."sales3mQty", 0)::int         AS "sales3mQty",

            -- 🟢 ยอดขายเดือนปัจจุบันเท่านั้น (ตาม "เดือนเวลาไทย" แต่ใช้ช่วง UTC)
            COALESCE(cm."salesCurrentMonthQty", 0)::int AS "salesCurrentMonthQty"

        FROM "Sku" s

        -- Stock
        LEFT JOIN (
            SELECT "branchCode", "codeProduct",
                SUM("quantity")::int AS "stockQuantity"
            FROM "Stock"
            WHERE "branchCode" = ${branchCode}
            GROUP BY "branchCode", "codeProduct"
        ) st 
        ON s."branchCode" = st."branchCode" 
        AND s."codeProduct" = st."codeProduct"

        -- Withdraw (เฉพาะ docStatus = 'อนุมัติแล้ว')
        LEFT JOIN (
            SELECT "branchCode", "codeProduct",
                SUM("quantity")::int          AS "withdrawQuantity",
                SUM("value"::numeric)::float8 AS "withdrawValue"
            FROM "withdraw"
            WHERE "branchCode" = ${branchCode}
              AND "docStatus" = 'อนุมัติแล้ว'
            GROUP BY "branchCode", "codeProduct"
        ) wd 
        ON s."branchCode" = wd."branchCode" 
        AND s."codeProduct" = wd."codeProduct"

        -- 🟢 ยอดขายจาก Bill / BillItem (90 วันย้อนหลัง, yesterday เป็นวันสุดท้าย)
        -- ใช้สำหรับ Sales Qty / Sales Amount (WHERE ใช้ช่วง UTC → index date ทำงานเต็ม)
        LEFT JOIN (
            SELECT 
                br."branch_code"            AS "branchCode",
                (p."product_code")::int     AS "codeProduct",
                SUM(bi."quantity")::int     AS "quantity_total",
                SUM(bi."net_sales")::float8 AS "net_sales_total"
            FROM "BillItem" bi
            JOIN "Bill" b
                ON bi."billId" = b."id"
            JOIN "Branch" br
                ON b."branchId" = br."id"
            JOIN "Product" p
                ON bi."productId" = p."id"
            WHERE br."branch_code" = ${branchCode}
              AND b."date" >= ${startUtc}
              AND b."date" <= ${endUtc}
            GROUP BY 
                br."branch_code",
                (p."product_code")::int
        ) bs
        ON s."branchCode" = bs."branchCode" 
        AND s."codeProduct" = bs."codeProduct"

        -- 🟢 Sales 3 เดือนก่อนหน้า จาก Bill / BillItem (รวมทุก channel)
        -- ใช้ UNION ALL แยกช่วงเดือนเพื่อช่วยให้ index date ทำงานเต็ม
        LEFT JOIN (
            SELECT "branchCode", "codeProduct", SUM("sales3mQty")::int AS "sales3mQty"
            FROM (
                SELECT 
                    br."branch_code"            AS "branchCode",
                    (prod."product_code")::int  AS "codeProduct",
                    SUM(bi."quantity")::int     AS "sales3mQty"
                FROM "BillItem" bi
                JOIN "Bill" b
                    ON bi."billId" = b."id"
                JOIN "Branch" br
                    ON b."branchId" = br."id"
                JOIN "Product" prod
                    ON bi."productId" = prod."id"
                WHERE br."branch_code" = ${branchCode}
                  AND b."date" >= ${prevMonths[0].startUtc}
                  AND b."date" <= ${prevMonths[0].endUtc}
                GROUP BY 
                    br."branch_code",
                    (prod."product_code")::int

                UNION ALL

                SELECT 
                    br."branch_code"            AS "branchCode",
                    (prod."product_code")::int  AS "codeProduct",
                    SUM(bi."quantity")::int     AS "sales3mQty"
                FROM "BillItem" bi
                JOIN "Bill" b
                    ON bi."billId" = b."id"
                JOIN "Branch" br
                    ON b."branchId" = br."id"
                JOIN "Product" prod
                    ON bi."productId" = prod."id"
                WHERE br."branch_code" = ${branchCode}
                  AND b."date" >= ${prevMonths[1].startUtc}
                  AND b."date" <= ${prevMonths[1].endUtc}
                GROUP BY 
                    br."branch_code",
                    (prod."product_code")::int

                UNION ALL

                SELECT 
                    br."branch_code"            AS "branchCode",
                    (prod."product_code")::int  AS "codeProduct",
                    SUM(bi."quantity")::int     AS "sales3mQty"
                FROM "BillItem" bi
                JOIN "Bill" b
                    ON bi."billId" = b."id"
                JOIN "Branch" br
                    ON b."branchId" = br."id"
                JOIN "Product" prod
                    ON bi."productId" = prod."id"
                WHERE br."branch_code" = ${branchCode}
                  AND b."date" >= ${prevMonths[2].startUtc}
                  AND b."date" <= ${prevMonths[2].endUtc}
                GROUP BY 
                    br."branch_code",
                    (prod."product_code")::int
            ) u
            GROUP BY "branchCode", "codeProduct"
        ) p3
        ON s."branchCode" = p3."branchCode" 
        AND s."codeProduct" = p3."codeProduct"

        -- 🟢 Sales เดือนปัจจุบัน จาก Bill / BillItem
        -- ใช้ช่วงเวลา UTC ของเดือนปัจจุบัน (ตามเดือนเวลาไทย)
        LEFT JOIN (
            SELECT 
                br."branch_code"            AS "branchCode",
                (prod."product_code")::int  AS "codeProduct",
                SUM(bi."quantity")::int     AS "salesCurrentMonthQty"
            FROM "BillItem" bi
            JOIN "Bill" b
                ON bi."billId" = b."id"
            JOIN "Branch" br
                ON b."branchId" = br."id"
            JOIN "Product" prod
                ON bi."productId" = prod."id"
            WHERE br."branch_code" = ${branchCode}
              AND b."date" >= ${currentMonthStartUtc}
              AND b."date" <= ${currentMonthEndUtc}
            GROUP BY 
                br."branch_code",
                (prod."product_code")::int
        ) cm
        ON s."branchCode" = cm."branchCode" 
        AND s."codeProduct" = cm."codeProduct"

        LEFT JOIN "ListOfItemHold" p 
            ON s."codeProduct" = p."codeProduct"

        LEFT JOIN "ItemMinMax" im 
            ON s."branchCode" = im."branchCode" 
            AND s."codeProduct" = im."codeProduct"

        WHERE s."branchCode" = ${branchCode}
        ORDER BY s."shelfCode", s."index", s."rowNo"
        `;

    // 🧮 Convert และคำนวณ target
    const result = rawResult.map((r) => {
      const sales3mQty = Number(r.sales3mQty ?? 0);
      const sales3mAvgQty = sales3mQty / 3;           // เฉลี่ย 3 เดือน
      const salesTargetQty = sales3mAvgQty * 0.8;     // 80% ของ avg

      return {
        branchCode: r.branchCode,
        codeProduct:
          r.codeProduct !== null && r.codeProduct !== undefined
            ? Number(r.codeProduct)
            : null,
        shelfCode: r.shelfCode,
        rowNo: r.rowNo,
        index: r.index,

        nameProduct: r.nameProduct ?? null,
        nameBrand: r.nameBrand ?? null,
        shelfLife: r.shelfLife ?? null,

        purchasePriceExcVAT:
          r.purchasePriceExcVAT !== null && r.purchasePriceExcVAT !== undefined
            ? Number(r.purchasePriceExcVAT)
            : null,
        salesPriceIncVAT:
          r.salesPriceIncVAT !== null && r.salesPriceIncVAT !== undefined
            ? Number(r.salesPriceIncVAT)
            : null,

        barcode: r.barcode ?? null,

        minStore:
          r.minStore !== null && r.minStore !== undefined
            ? Number(r.minStore)
            : null,
        maxStore:
          r.maxStore !== null && r.maxStore !== undefined
            ? Number(r.maxStore)
            : null,

        stockQuantity: Number(r.stockQuantity ?? 0),

        withdrawQuantity: Number(r.withdrawQuantity ?? 0),
        withdrawValue: Number(r.withdrawValue ?? 0),

        // 90 วัน (Qty / Amount)
        salesQuantity: Number(r.salesQuantity ?? 0),
        salesTotalPrice: Number(r.salesTotalPrice ?? 0),

        // 🔹 ยอดขาย 3 เดือนก่อนหน้า (รวม 3 เดือน)
        sales3mQty,
        // 🔹 target = 80% ของ avg 3 เดือน
        salesTargetQty,

        // 🔹 ยอดขายเดือนปัจจุบันเท่านั้น
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
  const { startUtc, endUtc } = getBangkok90DaysRangeUtc();
  console.log(startUtc, ":::", endUtc);

  try {
    const rows = await prisma.$queryRaw`
        WITH sku_rows AS (
            SELECT "branchCode", "shelfCode", "codeProduct"
            FROM "Sku"
        ),
        stock_map AS (
            SELECT "branchCode", "codeProduct", SUM("quantity")::float8 AS stock_qty
            FROM "Stock"
            GROUP BY "branchCode", "codeProduct"
        ),
        withdraw_map AS (
            SELECT "branchCode", "codeProduct", SUM("value")::float8 AS withdraw_value
            FROM "withdraw"
            WHERE "docStatus" = 'อนุมัติแล้ว'
            GROUP BY "branchCode", "codeProduct"
        ),
        sales_map AS (
            SELECT
                br."branch_code" AS "branchCode",
                (pr."product_code")::int AS "codeProduct",
                SUM(bi."net_sales")::float8 AS sales_total
            FROM "BillItem" bi
            JOIN "Bill" b ON bi."billId" = b."id"
            JOIN "Branch" br ON b."branchId" = br."id"
            JOIN "Product" pr ON bi."productId" = pr."id"
            WHERE b."date" >= ${startUtc}
              AND b."date" <= ${endUtc}
            GROUP BY br."branch_code", (pr."product_code")::int
        ),
        branch_sums AS (
            SELECT
                sr."branchCode" AS branch_code,
                COUNT(DISTINCT sr."shelfCode")::int AS shelf_count,
                COUNT(*)::int AS product_count,
                SUM(
                    CASE
                        WHEN COALESCE(sm.stock_qty, 0) > 0
                            THEN COALESCE(sm.stock_qty, 0) * COALESCE(p."purchasePriceExcVAT", 0)
                        ELSE 0
                    END
                )::float8 AS stock_cost,
                SUM(COALESCE(wm.withdraw_value, 0))::float8 AS withdraw_value,
                SUM(COALESCE(sa.sales_total, 0))::float8 AS sales_total
            FROM sku_rows sr
            LEFT JOIN stock_map sm
                ON sm."branchCode" = sr."branchCode"
               AND sm."codeProduct" = sr."codeProduct"
            LEFT JOIN "ListOfItemHold" p
                ON p."codeProduct" = sr."codeProduct"
            LEFT JOIN withdraw_map wm
                ON wm."branchCode" = sr."branchCode"
               AND wm."codeProduct" = sr."codeProduct"
            LEFT JOIN sales_map sa
                ON sa."branchCode" = sr."branchCode"
               AND sa."codeProduct" = sr."codeProduct"
            GROUP BY sr."branchCode"
        )
        SELECT
            b."branch_code" AS "branchCode",
            b."branch_name" AS "branchName",
            COALESCE(bs.shelf_count, 0)::int AS "shelfCount",
            COALESCE(bs.product_count, 0)::int AS "productCount",
            COALESCE(bs.stock_cost, 0)::float8 AS "stockCost",
            COALESCE(bs.withdraw_value, 0)::float8 AS "withdrawValue",
            COALESCE(bs.sales_total, 0)::float8 AS "salesTotal"
        FROM "Branch" b
        LEFT JOIN branch_sums bs
            ON bs.branch_code = b."branch_code"
        ORDER BY b."branch_code" ASC
        `;

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

    // ✅ ไม่ใช้ cache สำหรับ Shelf Dashboard (ต้องเห็นผลลัพธ์ล่าสุดทันที)
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

  const { startUtc, endUtc } = getBangkok90DaysRangeUtc();

  try {
    const shelfSalesRows = await prisma.$queryRaw`
        WITH sku_rows AS (
            SELECT "branchCode", "shelfCode", "codeProduct"
            FROM "Sku"
            WHERE "branchCode" = ${branchCode}
        ),
        shelf_names AS (
            SELECT "branchCode", "shelfCode", "fullName"
            FROM "Tamplate"
            WHERE "branchCode" = ${branchCode}
        ),
        stock_map AS (
            SELECT "branchCode", "codeProduct", SUM("quantity")::float8 AS stock_qty
            FROM "Stock"
            WHERE "branchCode" = ${branchCode}
            GROUP BY "branchCode", "codeProduct"
        ),
        sales_map AS (
            SELECT
                br."branch_code" AS "branchCode",
                (pr."product_code")::int AS "codeProduct",
                SUM(bi."net_sales")::float8 AS sales_total
            FROM "BillItem" bi
            JOIN "Bill" b ON bi."billId" = b."id"
            JOIN "Branch" br ON b."branchId" = br."id"
            JOIN "Product" pr ON bi."productId" = pr."id"
            WHERE br."branch_code" = ${branchCode}
              AND b."date" >= ${startUtc}
              AND b."date" <= ${endUtc}
            GROUP BY br."branch_code", (pr."product_code")::int
        ),
        shelf_sums AS (
            SELECT
                sr."branchCode" AS branch_code,
                sr."shelfCode" AS shelf_code,
                COUNT(*)::int AS sku_count,
                SUM(
                    CASE
                        WHEN COALESCE(sm.stock_qty, 0) > 0
                            THEN COALESCE(sm.stock_qty, 0) * COALESCE(p."purchasePriceExcVAT", 0)
                        ELSE 0
                    END
                )::float8 AS stock_cost,
                SUM(COALESCE(sa.sales_total, 0))::float8 AS sales_total
            FROM sku_rows sr
            LEFT JOIN stock_map sm
                ON sm."branchCode" = sr."branchCode"
               AND sm."codeProduct" = sr."codeProduct"
            LEFT JOIN "ListOfItemHold" p
                ON p."codeProduct" = sr."codeProduct"
            LEFT JOIN sales_map sa
                ON sa."branchCode" = sr."branchCode"
               AND sa."codeProduct" = sr."codeProduct"
            GROUP BY sr."branchCode", sr."shelfCode"
        )
        SELECT
            ss.branch_code AS "branchCode",
            ss.shelf_code AS "shelfCode",
            sn."fullName" AS "shelfName",
            COALESCE(ss.sales_total, 0)::float8 AS "salesTotal",
            COALESCE(ss.sku_count, 0)::int AS "skuCount",
            COALESCE(ss.stock_cost, 0)::float8 AS "stockCost"
        FROM shelf_sums ss
        LEFT JOIN shelf_names sn
            ON sn."branchCode" = ss.branch_code
           AND sn."shelfCode" = ss.shelf_code
        ORDER BY ss.shelf_code
        `;

    const shelves = shelfSalesRows.map((row) => ({
      shelfCode: row.shelfCode,
      shelfName: row.shelfName || null,
      salesTotal: Number(row.salesTotal || 0),
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
