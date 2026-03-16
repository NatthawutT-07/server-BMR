const prisma = require("../../config/prisma");
const { Prisma } = require("@prisma/client");
// ============================================================
// GET /analysis-filters
// ดึงค่า filter ที่มีอยู่จริงใน DB
// ============================================================
exports.getAnalysisFilters = async (req, res) => {
    try {
        const [branchCodes, brands] = await Promise.all([
            prisma.$queryRaw`SELECT DISTINCT "branchCode" FROM "withdraw" WHERE "branchCode" IS NOT NULL AND "branchCode" != '' ORDER BY "branchCode"`,
            prisma.$queryRaw`SELECT DISTINCT "nameBrand" FROM "ListOfItemHold" WHERE "nameBrand" IS NOT NULL AND "nameBrand" != '' ORDER BY "nameBrand"`,
        ]);

        res.json({
            branchCodes: branchCodes.map(r => r.branchCode),
            brands: brands.map(r => r.nameBrand),
        });
    } catch (err) {
        console.error("getAnalysisFilters error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /analysis-sku
// body: { startDate, endDate, branchCodes[], docStatuses[], reasons[], brands[] }
// ============================================================
exports.getSkuAnalysis = async (req, res) => {
    try {
        const { startDate, endDate, branchCodes, brands, shelfLifeFilter } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "startDate and endDate are required" });
        }

        const getBangkokUtcRange = (startStr, endStr) => {
            const start = new Date(startStr + "T00:00:00+07:00");
            const end = new Date(endStr + "T23:59:59.999+07:00");
            return { startUtc: start, endUtc: end };
        };

        const { startUtc, endUtc } = getBangkokUtcRange(startDate, endDate);

        // Helpers
        const pad5 = (code) => String(code).padStart(5, "0");
        const toInt = (code) => parseInt(String(code).replace(/^0+/, ""), 10) || 0;

        // ====================================================
        // 0) ListOfItemHold — ข้อมูล master สินค้า
        // ====================================================
        const masterItems = await prisma.listOfItemHold.findMany({
            select: {
                codeProduct: true,
                nameProduct: true,
                nameBrand: true,
                salesPriceIncVAT: true,
                shelfLife: true,
                status: true,
            },
        });

        // สร้าง map: codeProduct (int) → master info
        const masterMap = new Map();
        for (const item of masterItems) {
            masterMap.set(item.codeProduct, item);
        }

        // ====================================================
        // 1) SALES: BillItem → Bill → Product
        // ====================================================
        const salesRows = await prisma.$queryRawUnsafe(`
            SELECT
                p."product_code",
                p."product_name",
                p."product_brand",
                COALESCE(SUM(
                    CASE WHEN b."doc_type" = 'เอกสารขาย' THEN bi."quantity" ELSE 0 END
                ), 0) + COALESCE(SUM(
                    CASE WHEN b."doc_type" IN ('เอกสารคืน','Return') THEN bi."quantity" ELSE 0 END
                ), 0) AS sale_quantity,
                COALESCE(SUM(
                    CASE WHEN b."doc_type" IN ('เอกสารคืน','Return') THEN bi."quantity" ELSE 0 END
                ), 0) AS return_quantity,
                COALESCE(SUM(bi."net_sales"), 0) AS net_sales
            FROM "BillItem" bi
            JOIN "Bill" b ON b."id" = bi."billId"
            JOIN "Product" p ON p."id" = bi."productId"
            JOIN "Branch" br ON br."id" = b."branchId"
            WHERE b."date" >= $1
              AND b."date" <= $2
              ${branchCodes?.length ? `AND br."branch_code" IN (${branchCodes.map(bc => `'${bc.replace(/'/g, "''")}'`).join(",")})` : ""}
            GROUP BY p."product_code", p."product_name", p."product_brand"
            ORDER BY p."product_code"
        `, startUtc, endUtc);

        // ====================================================
        // 2) WITHDRAW
        // ====================================================
        const withdrawRows = await prisma.$queryRawUnsafe(`
            SELECT
                "codeProduct",
                COALESCE(SUM("quantity"), 0) AS withdraw_quantity,
                COALESCE(SUM("value"), 0) AS withdraw_value
            FROM "withdraw"
            WHERE "docStatus" = 'อนุมัติแล้ว'
              AND "reason" != 'เบิกเพื่อขาย'
              AND to_date("date", 'DD/MM/YYYY') >= to_date('${startDate}', 'YYYY-MM-DD')
              AND to_date("date", 'DD/MM/YYYY') <= to_date('${endDate}', 'YYYY-MM-DD')
              ${branchCodes?.length ? `AND "branchCode" IN (${branchCodes.map(b => `'${b.replace(/'/g, "''")}'`).join(",")})` : ""}
            GROUP BY "codeProduct"
            ORDER BY "codeProduct"
        `);

        // ====================================================
        // 3) ORDER SI — ใช้ Prisma findMany
        // ====================================================
        const expandBranchCode = (bc) => {
            if (bc && String(bc).length === 5) {
                return bc.slice(0, 2) + "0" + bc.slice(2);
            }
            return bc;
        };

        // Debug: นับจำนวน record ทั้งหมดใน OrderSI ก่อน
        const siTotal = await prisma.orderSI.count();
        console.log(`=== OrderSI total records in DB: ${siTotal} ===`);
        console.log(`=== OrderSI filter: deliveryDate ${startUtc.toISOString()} — ${endUtc.toISOString()} ===`);

        // ดึง sample 3 records เพื่อดูค่าจริง
        if (siTotal > 0) {
            const sample = await prisma.orderSI.findMany({ take: 3 });
            console.log("=== OrderSI sample records:", JSON.stringify(sample, null, 2));
        }

        const siWhere = {
            deliveryDate: { gte: startUtc, lte: endUtc },
        };
        if (branchCodes?.length) {
            siWhere.branchCode = { in: branchCodes.map(expandBranchCode) };
        }

        const siRaw = await prisma.orderSI.findMany({
            where: siWhere,
            select: {
                productCode: true,
                siNo: true,
                quantity: true,
            },
        });

        console.log(`=== OrderSI filtered: ${siRaw.length} records in date range ===`);
        if (siRaw.length > 0) {
            console.log("=== SI sample (first 3):", JSON.stringify(siRaw.slice(0, 3)));
        }

        // Aggregate SI vs SIA by productCode (int)
        const siAggMap = new Map();
        for (const row of siRaw) {
            const intCode = toInt(row.productCode);
            if (!siAggMap.has(intCode)) {
                siAggMap.set(intCode, { si_quantity: 0, sia_quantity: 0 });
            }
            const agg = siAggMap.get(intCode);
            const siNo = String(row.siNo || "").toUpperCase();
            if (siNo.startsWith("SIA")) {
                agg.sia_quantity += row.quantity || 0;
            } else if (siNo.startsWith("SI")) {
                agg.si_quantity += row.quantity || 0;
            }
        }

        console.log(`=== Analysis: ${salesRows.length} sales, ${withdrawRows.length} withdraw, ${siRaw.length} SI records (${siAggMap.size} unique products) ===`);

        // ====================================================
        // 3.5) GOURMET SALES
        // ====================================================
        const gourmetWhere = {
            date: { gte: startUtc, lte: endUtc },
        };
        if (branchCodes?.length) {
            gourmetWhere.branch_code = { in: branchCodes.map(expandBranchCode) };
        }
        const gourmetRows = await prisma.gourmet.groupBy({
            by: ['product_code'],
            where: gourmetWhere,
            _sum: {
                quantity: true,
                sales: true,
            },
        });

        // ====================================================
        // 4) MERGE all data by product_code (int key)
        // ====================================================
        const mergedMap = new Map();

        // ensureEntry: คืนค่า null ถ้า intCode ไม่อยู่ใน ListOfItemHold
        const ensureEntry = (intCode) => {
            if (!masterMap.has(intCode)) return null; // ไม่อยู่ใน master → skip
            if (!mergedMap.has(intCode)) {
                const master = masterMap.get(intCode);
                mergedMap.set(intCode, {
                    product_code: pad5(intCode),
                    product_name: master?.nameProduct || "",
                    product_brand: master?.nameBrand || "",
                    salesPriceIncVAT: master?.salesPriceIncVAT || 0,
                    shelfLife: master?.shelfLife || "",
                    status: master?.status || "",
                    sale_quantity: 0,
                    return_quantity: 0,
                    net_sales: 0,
                    withdraw_quantity: 0,
                    withdraw_value: 0,
                    si_quantity: 0,
                    sia_quantity: 0,
                    stock_quantity: 0,
                });
            }
            return mergedMap.get(intCode);
        };

        // Sales data
        for (const row of salesRows) {
            const intCode = toInt(row.product_code);
            const entry = ensureEntry(intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            // ถ้ามีชื่อจาก Product table ใช้แทน (fallback)
            if (row.product_name && !entry.product_name) entry.product_name = row.product_name;
            if (row.product_brand && !entry.product_brand) entry.product_brand = row.product_brand;
            entry.sale_quantity = Number(row.sale_quantity || 0);
            entry.return_quantity = Number(row.return_quantity || 0);
            entry.net_sales = Number(row.net_sales || 0);
        }

        // Gourmet data
        for (const row of gourmetRows) {
            const intCode = toInt(row.product_code);
            const entry = ensureEntry(intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            entry.sale_quantity += Number(row._sum.quantity || 0);
            entry.net_sales += Number(row._sum.sales || 0);
        }

        // Withdraw data
        for (const row of withdrawRows) {
            const intCode = Number(row.codeProduct);
            const entry = ensureEntry(intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            entry.withdraw_quantity = Number(row.withdraw_quantity || 0);
            entry.withdraw_value = Number(row.withdraw_value || 0);
        }

        // OrderSI data
        for (const [intCode, agg] of siAggMap) {
            const entry = ensureEntry(intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            entry.si_quantity = agg.si_quantity;
            entry.sia_quantity = agg.sia_quantity;
        }

        // ====================================================
        // 5) STOCK — ใช้ Prisma findMany
        // ====================================================
        const stockWhere = {};
        if (branchCodes?.length) {
            stockWhere.branchCode = { in: branchCodes };
        }
        const stockRaw = await prisma.stock.findMany({
            where: stockWhere,
            select: {
                codeProduct: true,
                quantity: true,
            },
        });

        const stockAggMap = new Map();
        for (const row of stockRaw) {
            const intCode = toInt(row.codeProduct);
            if (!masterMap.has(intCode)) continue; // ไม่อยู่ใน ListOfItemHold → skip
            if (!stockAggMap.has(intCode)) {
                stockAggMap.set(intCode, 0);
            }
            stockAggMap.set(intCode, stockAggMap.get(intCode) + (row.quantity || 0));
        }

        // Merge Stock
        for (const [intCode, totalQty] of stockAggMap) {
            const entry = ensureEntry(intCode);
            if (!entry) continue;
            entry.stock_quantity = totalQty;
        }

        // Convert to array
        let result = Array.from(mergedMap.values());

        // Brand filter (server-side)
        if (brands?.length) {
            const brandSet = new Set(brands.map(b => b.toLowerCase()));
            result = result.filter(r =>
                r.product_brand && brandSet.has(r.product_brand.toLowerCase())
            );
        }

        // Shelf Life filter (server-side)
        if (shelfLifeFilter && shelfLifeFilter !== "all") {
            result = result.filter(r => {
                if (shelfLifeFilter === "none") {
                    return !r.shelfLife || r.shelfLife === "" || isNaN(parseFloat(r.shelfLife));
                }
                const sl = parseFloat(r.shelfLife);
                if (isNaN(sl)) return false;
                return shelfLifeFilter === "gt15" ? sl > 15 : sl <= 15;
            });
        }

        result.sort((a, b) => a.product_code.localeCompare(b.product_code));

        res.json({
            range: { start: startDate, end: endDate },
            total: result.length,
            rows: result,
        });

    } catch (err) {
        console.error("getSkuAnalysis error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /analysis-store
// body: { startDate, endDate, branchCodes[], docStatuses[], reasons[] }
// แสดงข้อมูลระดับ สาขา×SKU — ใช้ ItemMinMax เป็นฐานหลักแบบรายเดือน
// ============================================================
exports.getStoreAnalysis = async (req, res) => {
    try {
        const { startDate, endDate, branchCodes, brands, shelfLifeFilter } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "startDate and endDate are required" });
        }

        // Validate max 3 months
        const sDate = new Date(startDate);
        const eDate = new Date(endDate);
        const diffMonths = (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth());
        if (diffMonths > 2) {
            return res.status(400).json({ error: "ช่วงเวลาสูงสุด 3 เดือน" });
        }

        // Build month buckets
        const months = [];
        let cursor = new Date(sDate.getFullYear(), sDate.getMonth(), 1);
        const lastMonth = new Date(eDate.getFullYear(), eDate.getMonth(), 1);
        while (cursor <= lastMonth) {
            const y = cursor.getFullYear();
            const m = String(cursor.getMonth() + 1).padStart(2, "0");
            months.push(`${y}-${m}`);
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const getBangkokUtcRange = (startStr, endStr) => {
            const start = new Date(startStr + "T00:00:00+07:00");
            const end = new Date(endStr + "T23:59:59.999+07:00");
            return { startUtc: start, endUtc: end };
        };

        const { startUtc, endUtc } = getBangkokUtcRange(startDate, endDate);
        const pad5 = (code) => String(code).padStart(5, "0");
        const toInt = (code) => parseInt(String(code).replace(/^0+/, ""), 10) || 0;

        // ====================================================
        // 0) ListOfItemHold — master สินค้า
        // ====================================================
        const masterItems = await prisma.listOfItemHold.findMany({
            select: {
                codeProduct: true,
                nameProduct: true,
                nameBrand: true,
                salesPriceIncVAT: true,
                shelfLife: true,
                status: true,
            },
        });
        const masterMap = new Map();
        for (const item of masterItems) {
            masterMap.set(item.codeProduct, item);
        }

        // ====================================================
        // 1) ItemMinMax — ฐานหลัก
        // ====================================================
        const minMaxWhere = {};
        if (branchCodes?.length) {
            minMaxWhere.branchCode = { in: branchCodes };
        }
        const minMaxRows = await prisma.itemMinMax.findMany({ where: minMaxWhere });

        // Build a lookup map for quick min/max access
        const minMaxMap = new Map();
        for (const row of minMaxRows) {
            minMaxMap.set(`${row.branchCode}|${row.codeProduct}`, row);
        }

        // ====================================================
        // 2) SALES per branch+product+month
        // ====================================================
        const salesRows = await prisma.$queryRawUnsafe(`
            SELECT
                br."branch_code",
                p."product_code",
                TO_CHAR(b."date", 'YYYY-MM') AS month,
                COALESCE(SUM(
                    CASE WHEN b."doc_type" = 'เอกสารขาย' THEN bi."quantity" ELSE 0 END
                ), 0) + COALESCE(SUM(
                    CASE WHEN b."doc_type" IN ('เอกสารคืน','Return') THEN bi."quantity" ELSE 0 END
                ), 0) AS sale_quantity,
                COALESCE(SUM(bi."net_sales"), 0) AS net_sales
            FROM "BillItem" bi
            JOIN "Bill" b ON b."id" = bi."billId"
            JOIN "Product" p ON p."id" = bi."productId"
            JOIN "Branch" br ON br."id" = b."branchId"
            WHERE b."date" >= $1
              AND b."date" <= $2
              ${branchCodes?.length ? `AND br."branch_code" IN (${branchCodes.map(bc => `'${bc.replace(/'/g, "''")}'`).join(",")})` : ""}
            GROUP BY br."branch_code", p."product_code", TO_CHAR(b."date", 'YYYY-MM')
        `, startUtc, endUtc);

        // ====================================================
        // 3) WITHDRAW per branch+product+month
        // ====================================================
        const withdrawRows = await prisma.$queryRawUnsafe(`
            SELECT
                "branchCode",
                "codeProduct",
                TO_CHAR(to_date("date", 'DD/MM/YYYY'), 'YYYY-MM') AS month,
                COALESCE(SUM("quantity"), 0) AS withdraw_quantity,
                COALESCE(SUM("value"), 0) AS withdraw_value
            FROM "withdraw"
            WHERE "docStatus" = 'อนุมัติแล้ว'
              AND "reason" != 'เบิกเพื่อขาย'
              AND to_date("date", 'DD/MM/YYYY') >= to_date('${startDate}', 'YYYY-MM-DD')
              AND to_date("date", 'DD/MM/YYYY') <= to_date('${endDate}', 'YYYY-MM-DD')
              ${branchCodes?.length ? `AND "branchCode" IN (${branchCodes.map(b => `'${b.replace(/'/g, "''")}'`).join(",")})` : ""}
            GROUP BY "branchCode", "codeProduct", TO_CHAR(to_date("date", 'DD/MM/YYYY'), 'YYYY-MM')
        `);

        // ====================================================
        // 4) OrderSI per branch+product
        // ====================================================
        const normalizeBranchCode = (bc) => {
            // "ST0001" -> "ST001", "BT0001" -> "BT001"
            if (bc && String(bc).length === 6) {
                return bc.slice(0, 2) + bc.slice(3);
            }
            return bc;
        };
        const expandBranchCode = (bc) => {
            // "ST001" -> "ST0001", "BT001" -> "BT0001"
            if (bc && String(bc).length === 5) {
                return bc.slice(0, 2) + "0" + bc.slice(2);
            }
            return bc;
        };

        const siWhere = {
            deliveryDate: { gte: startUtc, lte: endUtc },
        };
        if (branchCodes?.length) {
            siWhere.branchCode = { in: branchCodes.map(expandBranchCode) };
        }
        const siRaw = await prisma.orderSI.findMany({
            where: siWhere,
            select: {
                branchCode: true,
                productCode: true,
                siNo: true,
                quantity: true,
                deliveryDate: true,
            },
        });

        // Aggregate SI/SIA by branch+product+month
        const siAggMap = new Map();
        for (const row of siRaw) {
            const normBranch = normalizeBranchCode(row.branchCode);
            const m = row.deliveryDate ? row.deliveryDate.toISOString().substring(0, 7) : "";
            if (!m) continue;
            const key = `${normBranch}|${toInt(row.productCode)}|${m}`;
            if (!siAggMap.has(key)) {
                siAggMap.set(key, { si_quantity: 0, sia_quantity: 0 });
            }
            const agg = siAggMap.get(key);
            const siNo = String(row.siNo || "").toUpperCase();
            if (siNo.startsWith("SIA")) {
                agg.sia_quantity += row.quantity || 0;
            } else if (siNo.startsWith("SI")) {
                agg.si_quantity += row.quantity || 0;
            }
        }

        // ====================================================
        // 4.5) GOURMET SALES per branch+product+month
        // ====================================================
        const gourmetRows = await prisma.$queryRawUnsafe(`
            SELECT
                "branch_code",
                "product_code",
                TO_CHAR("date", 'YYYY-MM') AS month,
                COALESCE(SUM("quantity"), 0) AS sale_quantity,
                COALESCE(SUM("sales"), 0) AS net_sales
            FROM "Gourmet"
            WHERE "date" >= $1 AND "date" <= $2
              ${branchCodes?.length ? `AND "branch_code" IN (${branchCodes.map(b => `'${expandBranchCode(b).replace(/'/g, "''")}'`).join(",")})` : ""}
            GROUP BY "branch_code", "product_code", TO_CHAR("date", 'YYYY-MM')
        `, startUtc, endUtc);

        // ====================================================
        // 5) STOCK per branch+product
        // ====================================================
        const stockWhere = {};
        if (branchCodes?.length) {
            stockWhere.branchCode = { in: branchCodes };
        }
        const stockRaw = await prisma.stock.findMany({
            where: stockWhere,
            select: {
                branchCode: true,
                codeProduct: true,
                quantity: true,
            },
        });

        const stockAggMap = new Map();
        for (const row of stockRaw) {
            const key = `${row.branchCode}|${row.codeProduct}`;
            if (!stockAggMap.has(key)) {
                stockAggMap.set(key, 0);
            }
            stockAggMap.set(key, stockAggMap.get(key) + (row.quantity || 0));
        }

        // ====================================================
        // 6) MERGE — key = "branchCode|codeProduct"
        // ====================================================
        const mergedMap = new Map();

        // ensureEntry: คืนค่า null ถ้า intCode ไม่อยู่ใน ListOfItemHold
        const ensureEntry = (branchCode, intCode) => {
            if (!masterMap.has(intCode)) return null; // ไม่อยู่ใน master → skip
            const key = `${branchCode}|${intCode}`;
            if (!mergedMap.has(key)) {
                const master = masterMap.get(intCode);
                const mm = minMaxMap.get(key);
                const monthData = {};
                for (const m of months) {
                    monthData[m] = {
                        sale_quantity: 0, net_sales: 0,
                        withdraw_quantity: 0, withdraw_value: 0,
                        si_quantity: 0, sia_quantity: 0,
                    };
                }
                mergedMap.set(key, {
                    branch_code: branchCode,
                    product_code: pad5(intCode),
                    product_name: master?.nameProduct || "",
                    brand: master?.nameBrand || "",
                    rsp: master?.salesPriceIncVAT || 0,
                    shelfLife: master?.shelfLife || "",
                    status: master?.status || "",
                    minStore: mm?.minStore ?? null,
                    maxStore: mm?.maxStore ?? null,
                    months: monthData,
                    stock_quantity: 0,
                    si_quantity: 0,
                    sia_quantity: 0,
                    // keep overall sums for any features expecting them directly
                    sale_quantity: 0,
                    net_sales: 0,
                    withdraw_quantity: 0,
                    withdraw_value: 0,
                });
            }
            return mergedMap.get(key);
        };

        // ItemMinMax (primary) — ดึงเฉพาะที่อยู่ใน masterMap
        for (const row of minMaxRows) {
            const entry = ensureEntry(row.branchCode, row.codeProduct);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            entry.minStore = row.minStore;
            entry.maxStore = row.maxStore;
        }

        // Sales
        for (const row of salesRows) {
            const intCode = toInt(row.product_code);
            const entry = ensureEntry(row.branch_code, intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            const m = row.month;
            if (entry.months[m]) {
                entry.months[m].sale_quantity += Number(row.sale_quantity || 0);
                entry.months[m].net_sales += Number(row.net_sales || 0);
            }
            entry.sale_quantity += Number(row.sale_quantity || 0);
            entry.net_sales += Number(row.net_sales || 0);
        }

        // Gourmet
        for (const row of gourmetRows) {
            const normBranch = normalizeBranchCode(row.branch_code);
            const intCode = toInt(row.product_code);
            const entry = ensureEntry(normBranch, intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            const m = row.month;
            if (entry.months[m]) {
                entry.months[m].sale_quantity += Number(row.sale_quantity || 0);
                entry.months[m].net_sales += Number(row.net_sales || 0);
            }
            entry.sale_quantity += Number(row.sale_quantity || 0);
            entry.net_sales += Number(row.net_sales || 0);
        }

        // Withdraw
        for (const row of withdrawRows) {
            const intCode = Number(row.codeProduct);
            const entry = ensureEntry(row.branchCode, intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            const m = row.month;
            if (entry.months[m]) {
                entry.months[m].withdraw_quantity += Number(row.withdraw_quantity || 0);
                entry.months[m].withdraw_value += Number(row.withdraw_value || 0);
            }
            entry.withdraw_quantity += Number(row.withdraw_quantity || 0);
            entry.withdraw_value += Number(row.withdraw_value || 0);
        }

        // SI/SIA
        for (const [keyStr, agg] of siAggMap) {
            const parts = keyStr.split("|");
            const branchCode = parts[0];
            const intCode = toInt(parts[1]);
            const m = parts[2];
            const entry = ensureEntry(branchCode, intCode);
            if (!entry) continue; // ไม่อยู่ใน ListOfItemHold → skip
            if (entry.months[m]) {
                entry.months[m].si_quantity += agg.si_quantity;
                entry.months[m].sia_quantity += agg.sia_quantity;
            }
            entry.si_quantity += agg.si_quantity;
            entry.sia_quantity += agg.sia_quantity;
        }

        // Stock
        for (const [key, qty] of stockAggMap) {
            const [branchCode, intCodeStr] = key.split("|");
            const intCode = Number(intCodeStr);
            if (!masterMap.has(intCode)) continue; // ไม่อยู่ใน ListOfItemHold → skip
            const entry = ensureEntry(branchCode, intCode);
            if (!entry) continue;
            entry.stock_quantity = qty;
        }

        // ====================================================
        // 7) Second-pass: re-check ItemMinMax for entries still missing min/max
        // ====================================================
        const missingMinMax = [];
        for (const entry of mergedMap.values()) {
            if (entry.minStore === null && entry.maxStore === null) {
                missingMinMax.push({
                    branchCode: entry.branch_code,
                    codeProduct: parseInt(entry.product_code, 10),
                });
            }
        }

        if (missingMinMax.length > 0) {
            // Query ItemMinMax for all missing pairs
            const recheck = await prisma.itemMinMax.findMany({
                where: {
                    OR: missingMinMax.map(m => ({
                        branchCode: m.branchCode,
                        codeProduct: m.codeProduct,
                    })),
                },
            });
            for (const row of recheck) {
                const key = `${row.branchCode}|${row.codeProduct}`;
                const entry = mergedMap.get(key);
                if (entry) {
                    entry.minStore = row.minStore;
                    entry.maxStore = row.maxStore;
                }
            }
        }



        let result = Array.from(mergedMap.values()).map(entry => {
            // คำนวณ % condition ระดับเดือน เหมือน Brand / Store Summary
            for (const m of months) {
                const md = entry.months[m];
                md.condition = md.net_sales > 0 ? parseFloat(((md.withdraw_value / md.net_sales) * 100).toFixed(2)) : 0;
            }
            return entry;
        });

        // Brand filter (server-side)
        if (brands?.length) {
            const brandSet = new Set(brands.map(b => b.toLowerCase()));
            result = result.filter(r =>
                r.brand && brandSet.has(r.brand.toLowerCase())
            );
        }

        // Shelf Life filter (server-side)
        if (shelfLifeFilter && shelfLifeFilter !== "all") {
            result = result.filter(r => {
                if (shelfLifeFilter === "none") {
                    return !r.shelfLife || r.shelfLife === "" || isNaN(parseFloat(r.shelfLife));
                }
                const sl = parseFloat(r.shelfLife);
                if (isNaN(sl)) return false;
                return shelfLifeFilter === "gt15" ? sl > 15 : sl <= 15;
            });
        }

        // Remove rows with no activity at all
        result = result.filter(r =>
            (r.sale_quantity || 0) !== 0 ||
            (r.net_sales || 0) !== 0 ||
            (r.withdraw_quantity || 0) !== 0 ||
            (r.withdraw_value || 0) !== 0 ||
            (r.si_quantity || 0) !== 0 ||
            (r.sia_quantity || 0) !== 0
        );

        result.sort((a, b) => {
            const bc = a.branch_code.localeCompare(b.branch_code);
            return bc !== 0 ? bc : a.product_code.localeCompare(b.product_code);
        });

        res.json({
            months,
            range: { start: startDate, end: endDate },
            total: result.length,
            rows: result,
        });

    } catch (err) {
        console.error("getStoreAnalysis error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /analysis-brand
// แสดงผลรวมยอดขาย/ตัดจ่ายตาม Brand
// ============================================================
exports.getBrandAnalysis = async (req, res) => {
    try {
        const { startDate, endDate, shelfLifeFilter } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "startDate and endDate are required" });
        }

        // Validate max 3 months
        const sDate = new Date(startDate);
        const eDate = new Date(endDate);
        const diffMonths = (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth());
        if (diffMonths > 2) {
            return res.status(400).json({ error: "ช่วงเวลาสูงสุด 3 เดือน" });
        }

        // Build month buckets
        const months = [];
        let cursor = new Date(sDate.getFullYear(), sDate.getMonth(), 1);
        const lastMonth = new Date(eDate.getFullYear(), eDate.getMonth(), 1);
        while (cursor <= lastMonth) {
            const y = cursor.getFullYear();
            const m = String(cursor.getMonth() + 1).padStart(2, "0");
            months.push(`${y}-${m}`);
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const getBangkokUtcRange = (startStr, endStr) => {
            const start = new Date(startStr + "T00:00:00+07:00");
            const end = new Date(endStr + "T23:59:59.999+07:00");
            return { startUtc: start, endUtc: end };
        };
        const { startUtc, endUtc } = getBangkokUtcRange(startDate, endDate);

        const toInt = (code) => parseInt(String(code).replace(/^0+/, ""), 10) || 0;

        // 0) ListOfItemHold — map codeProduct → nameBrand + consingItem
        const masterItems = await prisma.listOfItemHold.findMany({
            select: { codeProduct: true, nameBrand: true, consingItem: true, shelfLife: true },
        });

        // Build shelf life allowed set
        let allowedProducts = null;
        if (shelfLifeFilter && shelfLifeFilter !== "all") {
            allowedProducts = new Set();
            for (const item of masterItems) {
                if (shelfLifeFilter === "none") {
                    if (!item.shelfLife || item.shelfLife === "" || isNaN(parseFloat(item.shelfLife))) {
                        allowedProducts.add(item.codeProduct);
                    }
                } else {
                    const sl = parseFloat(item.shelfLife);
                    if (isNaN(sl)) continue;
                    if (shelfLifeFilter === "gt15" ? sl > 15 : sl <= 15) {
                        allowedProducts.add(item.codeProduct);
                    }
                }
            }
        }

        const brandByProduct = new Map();
        const consingByProduct = new Map();
        for (const item of masterItems) {
            if (item.nameBrand) brandByProduct.set(item.codeProduct, item.nameBrand);
            if (item.consingItem) consingByProduct.set(item.codeProduct, item.consingItem);
        }

        // 1) SALES — group by product_code + month
        const salesRows = await prisma.$queryRawUnsafe(`
            SELECT
                p."product_code",
                TO_CHAR(b."date", 'YYYY-MM') AS month,
                COALESCE(SUM(bi."net_sales"), 0) AS net_sales
            FROM "BillItem" bi
            JOIN "Bill" b ON b."id" = bi."billId"
            JOIN "Product" p ON p."id" = bi."productId"
            WHERE b."date" >= $1 AND b."date" <= $2
            GROUP BY p."product_code", TO_CHAR(b."date", 'YYYY-MM')
        `, startUtc, endUtc);

        // 1.5) GOURMET SALES
        const gourmetRows = await prisma.$queryRawUnsafe(`
            SELECT
                "product_code",
                TO_CHAR("date", 'YYYY-MM') AS month,
                COALESCE(SUM("quantity"), 0) AS sale_quantity,
                COALESCE(SUM("sales"), 0) AS net_sales
            FROM "Gourmet"
            WHERE "date" >= $1 AND "date" <= $2
            GROUP BY "product_code", TO_CHAR("date", 'YYYY-MM')
        `, startUtc, endUtc);

        // 2) WITHDRAW — group by codeProduct + month
        const withdrawRows = await prisma.$queryRawUnsafe(`
            SELECT
                "codeProduct",
                TO_CHAR(to_date("date", 'DD/MM/YYYY'), 'YYYY-MM') AS month,
                COALESCE(SUM("value"), 0) AS withdraw_value
            FROM "withdraw"
            WHERE "docStatus" = 'อนุมัติแล้ว'
              AND "reason" != 'เบิกเพื่อขาย'
              AND to_date("date", 'DD/MM/YYYY') >= to_date('${startDate}', 'YYYY-MM-DD')
              AND to_date("date", 'DD/MM/YYYY') <= to_date('${endDate}', 'YYYY-MM-DD')
            GROUP BY "codeProduct", TO_CHAR(to_date("date", 'DD/MM/YYYY'), 'YYYY-MM')
        `);

        // 3) AGGREGATE by brand + month
        const brandMap = new Map();
        const ensureBrand = (brandName) => {
            if (!brandMap.has(brandName)) {
                const monthData = {};
                for (const m of months) monthData[m] = { sales: 0, withdraw: 0 };
                brandMap.set(brandName, { brand: brandName, consing_item: new Set(), months: monthData });
            }
            return brandMap.get(brandName);
        };

        for (const row of salesRows) {
            const intCode = toInt(row.product_code);
            if (allowedProducts && !allowedProducts.has(intCode)) continue;
            const brandName = brandByProduct.get(intCode);
            if (!brandName) continue;
            const entry = ensureBrand(brandName);
            if (entry.months[row.month]) entry.months[row.month].sales += Number(row.net_sales || 0);
            const consing = consingByProduct.get(intCode);
            if (consing) entry.consing_item.add(consing);
        }

        for (const row of gourmetRows) {
            const intCode = toInt(row.product_code);
            if (allowedProducts && !allowedProducts.has(intCode)) continue;
            const brandName = brandByProduct.get(intCode);
            if (!brandName) continue;
            const entry = ensureBrand(brandName);
            if (entry.months[row.month]) entry.months[row.month].sales += Number(row.net_sales || 0);
            const consing = consingByProduct.get(intCode);
            if (consing) entry.consing_item.add(consing);
        }

        for (const row of withdrawRows) {
            const intCode = Number(row.codeProduct);
            if (allowedProducts && !allowedProducts.has(intCode)) continue;
            const brandName = brandByProduct.get(intCode);
            if (!brandName) continue;
            const entry = ensureBrand(brandName);
            if (entry.months[row.month]) entry.months[row.month].withdraw += Number(row.withdraw_value || 0);
            const consing = consingByProduct.get(intCode);
            if (consing) entry.consing_item.add(consing);
        }

        let result = Array.from(brandMap.values()).map(entry => {
            const monthsResult = {};
            for (const m of months) {
                const md = entry.months[m];
                monthsResult[m] = {
                    sales: md.sales,
                    withdraw: md.withdraw,
                    condition: md.sales > 0 ? parseFloat(((md.withdraw / md.sales) * 100).toFixed(2)) : 0,
                };
            }
            return {
                brand: entry.brand,
                consing_item: Array.from(entry.consing_item).join(", "),
                months: monthsResult,
            };
        });

        result.sort((a, b) => a.brand.localeCompare(b.brand));

        res.json({
            months,
            range: { start: startDate, end: endDate },
            total: result.length,
            rows: result,
        });

    } catch (err) {
        console.error("getBrandAnalysis error:", err);
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /analysis-store-summary
// body: { startDate, endDate }
// ยอดขาย + ตัดจ่ายรวมรายสาขา แยกรายเดือน (สูงสุด 3 เดือน)
// ============================================================
exports.getStoreSummary = async (req, res) => {
    try {
        const { startDate, endDate, shelfLifeFilter } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: "startDate and endDate are required" });
        }

        // Validate max 3 months
        const sDate = new Date(startDate);
        const eDate = new Date(endDate);
        const diffMonths = (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth());
        if (diffMonths > 2) {
            return res.status(400).json({ error: "ช่วงเวลาสูงสุด 3 เดือน" });
        }

        // Build month buckets
        const months = [];
        let cursor = new Date(sDate.getFullYear(), sDate.getMonth(), 1);
        const lastMonth = new Date(eDate.getFullYear(), eDate.getMonth(), 1);
        while (cursor <= lastMonth) {
            const y = cursor.getFullYear();
            const m = String(cursor.getMonth() + 1).padStart(2, "0");
            months.push(`${y}-${m}`);
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const getBangkokUtcRange = (startStr, endStr) => {
            const start = new Date(startStr + "T00:00:00+07:00");
            const end = new Date(endStr + "T23:59:59.999+07:00");
            return { startUtc: start, endUtc: end };
        };
        const { startUtc, endUtc } = getBangkokUtcRange(startDate, endDate);

        // ====================================================
        // 1) Branch list
        // ====================================================
        const branches = await prisma.branch.findMany({
            select: { branch_code: true, branch_name: true },
            orderBy: { branch_code: "asc" },
        });
        const branchNameMap = new Map();
        for (const b of branches) {
            branchNameMap.set(b.branch_code, b.branch_name);
        }

        // ====================================================
        // 1.5) Shelf Life filter — build allowed product codes
        // ====================================================
        let allowedProducts = null;
        if (shelfLifeFilter && shelfLifeFilter !== "all") {
            const masterItems = await prisma.listOfItemHold.findMany({
                select: { codeProduct: true, shelfLife: true },
            });
            allowedProducts = new Set();
            for (const item of masterItems) {
                if (shelfLifeFilter === "none") {
                    if (!item.shelfLife || item.shelfLife === "" || isNaN(parseFloat(item.shelfLife))) {
                        allowedProducts.add(item.codeProduct);
                    }
                } else {
                    const sl = parseFloat(item.shelfLife);
                    if (isNaN(sl)) continue;
                    if (shelfLifeFilter === "gt15" ? sl > 15 : sl <= 15) {
                        allowedProducts.add(item.codeProduct);
                    }
                }
            }
        }

        // ====================================================
        // 2) Sales — BillItem → Bill → Branch, group by branch + product + month
        // ====================================================
        const salesRows = await prisma.$queryRawUnsafe(`
            SELECT
                br."branch_code",
                p."product_code",
                TO_CHAR(b."date", 'YYYY-MM') AS month,
                COALESCE(SUM(bi."net_sales"), 0) AS net_sales
            FROM "BillItem" bi
            JOIN "Bill" b ON b."id" = bi."billId"
            JOIN "Product" p ON p."id" = bi."productId"
            JOIN "Branch" br ON br."id" = b."branchId"
            WHERE b."date" >= $1
              AND b."date" <= $2
            GROUP BY br."branch_code", p."product_code", TO_CHAR(b."date", 'YYYY-MM')
        `, startUtc, endUtc);

        // ====================================================
        // 2.5) Gourmet Sales — group by branch + product + month
        // ====================================================
        const gourmetRows = await prisma.$queryRawUnsafe(`
            SELECT
                "branch_code",
                "product_code",
                TO_CHAR("date", 'YYYY-MM') AS month,
                COALESCE(SUM("sales"), 0) AS net_sales
            FROM "Gourmet"
            WHERE "date" >= $1 AND "date" <= $2
            GROUP BY "branch_code", "product_code", TO_CHAR("date", 'YYYY-MM')
        `, startUtc, endUtc);

        // ====================================================
        // 3) Withdraw — group by branchCode + product + month
        // ====================================================
        const withdrawRows = await prisma.$queryRawUnsafe(`
            SELECT
                "branchCode",
                "codeProduct",
                TO_CHAR(to_date("date", 'DD/MM/YYYY'), 'YYYY-MM') AS month,
                COALESCE(SUM("value"), 0) AS withdraw_value
            FROM "withdraw"
            WHERE "docStatus" = 'อนุมัติแล้ว'
              AND "reason" != 'เบิกเพื่อขาย'
              AND to_date("date", 'DD/MM/YYYY') >= to_date('${startDate}', 'YYYY-MM-DD')
              AND to_date("date", 'DD/MM/YYYY') <= to_date('${endDate}', 'YYYY-MM-DD')
            GROUP BY "branchCode", "codeProduct", TO_CHAR(to_date("date", 'DD/MM/YYYY'), 'YYYY-MM')
        `);

        // ====================================================
        // 4) Merge
        // ====================================================
        const resultMap = new Map();

        const ensureBranch = (branchCode) => {
            if (!resultMap.has(branchCode)) {
                const monthData = {};
                for (const m of months) {
                    monthData[m] = { sales: 0, withdraw: 0 };
                }
                resultMap.set(branchCode, {
                    branch_code: branchCode,
                    branch_name: branchNameMap.get(branchCode) || branchCode,
                    months: monthData,
                });
            }
            return resultMap.get(branchCode);
        };

        const toInt = (code) => parseInt(String(code).replace(/^0+/, ""), 10) || 0;

        // Sales
        for (const row of salesRows) {
            if (allowedProducts) {
                const intCode = toInt(row.product_code);
                if (!allowedProducts.has(intCode)) continue;
            }
            const entry = ensureBranch(row.branch_code);
            const m = row.month;
            if (entry.months[m]) {
                entry.months[m].sales += Number(row.net_sales || 0);
            }
        }

        // Gourmet Sales
        const normalizeBranchCode = (bc) => {
            if (bc && String(bc).length === 6) {
                return bc.slice(0, 2) + bc.slice(3);
            }
            return bc;
        };
        for (const row of gourmetRows) {
            if (allowedProducts) {
                const intCode = toInt(row.product_code);
                if (!allowedProducts.has(intCode)) continue;
            }
            const normBranch = normalizeBranchCode(row.branch_code);
            const entry = ensureBranch(normBranch);
            const m = row.month;
            if (entry.months[m]) {
                entry.months[m].sales += Number(row.net_sales || 0);
            }
        }

        // Withdraw
        for (const row of withdrawRows) {
            if (allowedProducts) {
                const intCode = Number(row.codeProduct);
                if (!allowedProducts.has(intCode)) continue;
            }
            const entry = ensureBranch(row.branchCode);
            const m = row.month;
            if (entry.months[m]) {
                entry.months[m].withdraw += Number(row.withdraw_value || 0);
            }
        }

        const result = Array.from(resultMap.values()).map(entry => {
            for (const m of months) {
                const md = entry.months[m];
                md.condition = md.sales > 0 ? parseFloat(((md.withdraw / md.sales) * 100).toFixed(2)) : 0;
            }
            return entry;
        }).sort((a, b) =>
            a.branch_code.localeCompare(b.branch_code)
        );

        res.json({
            months,
            range: { start: startDate, end: endDate },
            total: result.length,
            rows: result,
        });

    } catch (err) {
        console.error("getStoreSummary error:", err);
        res.status(500).json({ error: err.message });
    }
};
