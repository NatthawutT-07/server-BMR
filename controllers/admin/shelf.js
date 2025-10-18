const prisma = require("../../config/prisma");

exports.itemCreate = async (req, res) => {
    try {
        const { branchCode, codeProduct, shelfCode, rowNo, index } = req.body;

        if (!branchCode || !codeProduct || !shelfCode || !rowNo || !index) {
            return res.status(400).json({
                error: '❌ Incomplete information (branchCode, codeProduct, shelfCode, rowNo, index)',
            });
        }

        await prisma.itemSearch.create({
            data: {
                branchCode,
                codeProduct: Number(codeProduct),
                shelfCode,
                rowNo: Number(rowNo),
                index: Number(index),
            },
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
    const { branchCode, shelfCode, rowNo, codeProduct, index } = req.body;

    if (!branchCode || !shelfCode || !rowNo || !codeProduct || !index) {
        return res.status(400).json({ success: false, message: "❌ Incomplete information" });
    }

    try {
        await prisma.itemSearch.deleteMany({
            where: {
                branchCode,
                shelfCode,
                rowNo,
                codeProduct: Number(codeProduct),
                index: Number(index),
            },
        });

        const remainingItems = await prisma.itemSearch.findMany({
            where: {
                branchCode,
                shelfCode,
                rowNo,
            },
            orderBy: {
                index: 'asc',
            },
            select: {
                id: true,
                index: true,
            },
        });

        const updates = remainingItems.map((item, i) =>
            prisma.itemSearch.update({
                where: { id: item.id },
                data: { index: i + 1 },
            })
        );

        await prisma.$transaction(updates);

        res.json({ success: true, message: "✅ Deleted and rearranged successfully" });
    } catch (error) {
        console.error("❌ itemDelete error:", error);
        res.status(500).json({ success: false, message: "❌ Failed to delete data" });
    }
};

exports.itemUpdate = async (req, res) => {
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "❌ No information sent" });
    }

    try {
        const { branchCode, shelfCode } = items[0];

        await prisma.$transaction([
            prisma.itemSearch.deleteMany({
                where: { branchCode, shelfCode },
            }),
            prisma.itemSearch.createMany({
                data: items.map(item => ({
                    branchCode: item.branchCode,
                    shelfCode: item.shelfCode,
                    rowNo: Number(item.rowNo),
                    index: Number(item.index),
                    codeProduct: Number(item.codeProduct),
                })),
            }),
        ]);

        res.json({ success: true, message: "✅ Shelf update successful" });
    } catch (error) {
        console.error("❌ itemUpdate error:", error);
        res.status(500).json({ success: false, message: "❌ Shelf update failed" });
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

exports.itemSearch = async (req, res) => {
    const { branchCode } = req.body;

    try {
        const product = await prisma.itemSearch.findMany({
            where: { branchCode },
            select: {
                branchCode: true,
                codeProduct: true,
                shelfCode: true,
                rowNo: true,
                index: true,
            }
        });

        if (product.length === 0) return res.json([]);

        const conditions = product.map(({ branchCode, codeProduct }) => ({ branchCode, codeProduct }));
        const codeProductList = [...new Set(product.map(p => p.codeProduct))];

        const [listOfItemHold, withdraws, stocks, sales, itemMinMaxList] = await Promise.all([
            prisma.listOfItemHold.findMany({
                where: { codeProduct: { in: codeProductList } },
                select: {
                    codeProduct: true,
                    nameProduct: true,
                    shelfLife: true,
                    nameBrand: true,
                    purchasePriceExcVAT: true,
                    salesPriceIncVAT: true,
                },
            }),
            prisma.withdraw.findMany({
                where: { OR: conditions },
                select: {
                    branchCode: true,
                    codeProduct: true,
                    quantity: true,
                    value: true,
                },
            }),
            prisma.stock.findMany({
                where: { OR: conditions },
                select: {
                    branchCode: true,
                    codeProduct: true,
                    quantity: true,
                },
            }),
            prisma.salesDay.findMany({
                where: {
                    AND: [
                        { channelSales: "หน้าร้าน" },
                        { OR: conditions },
                    ],
                },
                select: {
                    branchCode: true,
                    codeProduct: true,
                    quantity: true,
                    totalPrice: true,
                },
            }),
            prisma.itemMinMax.findMany({
                where: { OR: conditions },
                select: {
                    branchCode: true,
                    codeProduct: true,
                    minStore: true,
                    maxStore: true,
                },
            }),
        ]);

        const itemHoldMap = new Map(listOfItemHold.map(p => [p.codeProduct, p]));
        const stockMap = new Map(stocks.map(s => [`${s.branchCode}-${s.codeProduct}`, s]));
        const salesMap = new Map(sales.map(s => [`${s.branchCode}-${s.codeProduct}`, s]));
        const itemMinMaxMap = new Map(itemMinMaxList.map(m => [`${m.branchCode}-${m.codeProduct}`, m]));

        const withdrawMap = new Map();
        withdraws.forEach(w => {
            const key = `${w.branchCode}-${w.codeProduct}`;
            if (!withdrawMap.has(key)) withdrawMap.set(key, []);
            withdrawMap.get(key).push(w);
        });

        const result = product.map(({ branchCode, codeProduct, shelfCode, rowNo, index }) => {
            const key = `${branchCode}-${codeProduct}`;
            const productHoldInfo = itemHoldMap.get(codeProduct);
            const stockInfo = stockMap.get(key);
            const saleInfo = salesMap.get(key);
            const itemMinMaxInfo = itemMinMaxMap.get(key);
            const withdrawItems = withdrawMap.get(key) || [];

            const totalWithdrawQuantity = withdrawItems.reduce((sum, w) => sum + Number(w.quantity || 0), 0);
            const totalWithdrawValue = withdrawItems.reduce((sum, w) => sum + Number(w.value || 0), 0);

            return {
                branchCode,
                codeProduct,
                shelfCode,
                rowNo,
                index,
                nameProduct: productHoldInfo?.nameProduct ?? null,
                shelfLife: productHoldInfo?.shelfLife ?? null,
                nameBrand: productHoldInfo?.nameBrand ?? null,
                purchasePriceExcVAT: productHoldInfo?.purchasePriceExcVAT ?? null,
                salesPriceIncVAT: productHoldInfo?.salesPriceIncVAT ?? null,
                stockQuantity: stockInfo?.quantity ?? null,
                withdrawQuantity: totalWithdrawQuantity,
                withdrawValue: totalWithdrawValue,
                minStore: itemMinMaxInfo?.minStore ?? null,
                maxStore: itemMinMaxInfo?.maxStore ?? null,
                salesQuantity: saleInfo?.quantity ?? null,
                salesTotalPrice: saleInfo?.totalPrice ?? null,
            };
        });

        return res.json(result);
    } catch (e) {
        console.error("❌ itemSearch error:", e);
        return res.status(500).json({ msg: "❌ Failed to retrieve data" });
    }
};

