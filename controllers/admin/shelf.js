const prisma = require("../../config/prisma");

exports.itemCreate = async (req, res) => {
    try {
        const { items } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({
                error: '❌ No items provided.',
            });
        }

        const itemsToInsert = items.map(item => ({
            branchCode: item.branchCode,
            codeProduct: Number(item.codeProduct),
            shelfCode: item.shelfCode,
            rowNo: Number(item.rowNo),
            index: Number(item.index),
        }));

        await prisma.sku.createMany({
            data: itemsToInsert,
            skipDuplicates: true,  // ข้ามค่าที่ซ้ำ
        });

        return res.status(201).json({
            message: '✅ Information added successfully.',
        });
    } catch (error) {
        console.error('❌ Error in itemCreate:', error);
        return res.status(500).json({ error: '❌ Server error' });
    }
};


exports.itemDelete = async (req, res) => {
    try {
        const { branchCode, shelfCode, rowNo, codeProduct, index } = req.body;

        if (!branchCode || !shelfCode || rowNo == null || codeProduct == null || index == null) {
            return res.status(400).json({ success: false, message: "❌ Incomplete information" });
        }

        const rowNoNum = Number(rowNo);
        const codeProductNum = Number(codeProduct);
        const indexNum = Number(index);

        // ลบ record
        await prisma.sku.deleteMany({
            where: {
                branchCode,
                shelfCode,
                rowNo: rowNoNum,
                codeProduct: codeProductNum,
                index: indexNum,
            },
        });

        // ดึงรายการที่เหลือเพื่อจัดลำดับ index ใหม่
        const remainingItems = await prisma.sku.findMany({
            where: {
                branchCode,
                shelfCode,
                rowNo: rowNoNum,
            },
            orderBy: { index: 'asc' },
            select: { id: true, index: true },
        });

        if (remainingItems.length > 0) {
            const updates = remainingItems.map((item, i) =>
                prisma.sku.update({
                    where: { id: item.id },
                    data: { index: i + 1 },
                })
            );
            await prisma.$transaction(updates);
        }

        res.json({ success: true, message: "✅ Deleted and rearranged successfully" });
    } catch (error) {
        console.error("❌ itemDelete error:", error.message);
        res.status(500).json({ success: false, message: "❌ Failed to delete data", detail: error.message });
    }
};

exports.itemUpdate = async (req, res) => {
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "❌ No information sent" });
    }

    try {
        // ตรวจสอบ branchCode และ shelfCode ของทุก item ต้องเหมือนกัน
        const branchCode = items[0].branchCode;
        const shelfCode = items[0].shelfCode;

        const isValid = items.every(
            item => item.branchCode === branchCode && item.shelfCode === shelfCode
        );

        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: "❌ All items must have the same branchCode and shelfCode",
            });
        }

        // แปลงค่าเป็นตัวเลขชัดเจน
        const itemsToInsert = items.map(item => ({
            branchCode: item.branchCode,
            shelfCode: item.shelfCode,
            rowNo: Number(item.rowNo),
            index: Number(item.index),
            codeProduct: Number(item.codeProduct),
        }));

        // ทำ transaction: ลบทั้งหมด + insert ใหม่
        await prisma.$transaction([
            prisma.sku.deleteMany({ where: { branchCode, shelfCode } }),
            prisma.sku.createMany({ data: itemsToInsert }),
        ]);

        res.json({ success: true, message: "✅ Shelf update successful" });
    } catch (error) {
        console.error("❌ itemUpdate error:", error);
        res.status(500).json({ success: false, message: "❌ Shelf update failed", detail: error.message });
    }
};


exports.tamplate = async (req, res) => {
    try {
        const result = await prisma.tamplate.findMany({
            orderBy: { id: 'asc' },
        });
        res.json(result);
    } catch (error) {
        console.error("❌ tamplate error:", error);
        res.status(500).json({ msg: "❌ error" });
    }
};

exports.sku = async (req, res) => {
    const { branchCode } = req.body;

    try {
        const skuData = await prisma.sku.findMany({
            where: { branchCode },
            select: {
                branchCode: true,
                codeProduct: true,
                shelfCode: true,
                rowNo: true,
                index: true,
            },
        });

        // ดึง withdraw ทั้งหมด
        const withdrawList = await prisma.withdraw.findMany({
            where: { branchCode },
        });

        // Aggregate withdraw per product + branch manually
        const withdrawMap = new Map();
        withdrawList.forEach(w => {
            const key = `${w.branchCode}-${w.codeProduct}`;
            const qty = Number(w.quantity || 0);
            const val = Number(w.value || 0); // แปลง String เป็น Number

            if (!withdrawMap.has(key)) withdrawMap.set(key, { quantity: 0, value: 0 });
            const existing = withdrawMap.get(key);
            existing.quantity += qty;
            existing.value += val;
        });

        // Aggregate stock per product + branch
        const stockTotals = await prisma.stock.groupBy({
            by: ['branchCode', 'codeProduct'],
            _sum: { quantity: true },
            where: { branchCode },
        });
        const stockMap = new Map(stockTotals.map(s => [`${s.branchCode}-${s.codeProduct}`, s]));

        // Fetch product info
        const listOfItemHold = await prisma.listOfItemHold.findMany({
            where: { codeProduct: { in: skuData.map(s => s.codeProduct) } },
        });
        const productMap = new Map(listOfItemHold.map(p => [p.codeProduct, p]));

        // Build final result
        const result = skuData.map(sku => {
            const key = `${sku.branchCode}-${sku.codeProduct}`;
            const withdrawInfo = withdrawMap.get(key);
            const stockInfo = stockMap.get(key);
            const productInfo = productMap.get(sku.codeProduct);

            return {
                ...sku,
                nameProduct: productInfo?.nameProduct || null,
                nameBrand: productInfo?.nameBrand || null,
                purchasePriceExcVAT: productInfo?.purchasePriceExcVAT || null,
                salesPriceIncVAT: productInfo?.salesPriceIncVAT || null,
                shelfLife: productInfo?.shelfLife || null,
                stockQuantity: stockInfo?._sum.quantity || 0,
                withdrawQuantity: withdrawInfo?.quantity || 0,
                withdrawValue: withdrawInfo?.value || 0,
            };
        });

        res.json(result);

    } catch (e) {
        console.error("❌ sku error:", e);
        return res.status(500).json({ msg: "❌ Failed to retrieve data" });
    }
};

