const prisma = require("../../config/prisma");

exports.itemCreate = async (req, res) => {
    try {
        const { branchCode, codeProduct, shelfCode, rowNo, index } = req.body;

        if (!branchCode || !codeProduct || !shelfCode || !rowNo || !index) {
            return res.status(400).json({
                error: 'someone no have data stationID, codeShelf, row, codeProduct',
            });
        }
        const newDetail = await prisma.itemSearch.create({
            data: {
                branchCode,
                codeProduct: parseInt(codeProduct),
                shelfCode,
                rowNo: parseInt(rowNo),
                index: parseInt(index),
            },
        });
        return res.status(201).json({
            message: 'create detailStation success',
            // data: newDetail,
        });
    } catch (error) {
        console.error('❌ Error in detailStation.create:', error);
        return res.status(500).json({ error: 'error server' });
    }
};

exports.itemDelete = async (req, res) => {
    const { branchCode, shelfCode, rowNo, codeProduct, index } = req.body;

    if (!branchCode || !shelfCode || !rowNo || !codeProduct || !index) {
        return res.status(400).json({ success: false, message: "! data" });
    }

    try {
        await prisma.itemSearch.deleteMany({
            where: {
                branchCode,
                shelfCode,
                rowNo,
                codeProduct,
                index,
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
        });

        for (let i = 0; i < remainingItems.length; i++) {
            const item = remainingItems[i];
            const newIndex = i + 1;

            if (item.index !== newIndex) {
                await prisma.itemSearch.update({
                    where: { id: item.id },
                    data: { index: newIndex },
                });
            }
        }

        res.json({ success: true, message: "ลบและเรียงลำดับใหม่สำเร็จ" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "error delete item" });
    }
};

exports.itemUpdate = async (req, res) => {
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "❌ not fount data" });
    }

    try {
        const { branchCode, shelfCode } = items[0];

        await prisma.itemSearch.deleteMany({
            where: { branchCode, shelfCode },
        });

        await prisma.itemSearch.createMany({
            data: items.map(item => ({
                branchCode: item.branchCode,
                shelfCode: item.shelfCode,
                rowNo: item.rowNo,
                index: item.index,
                codeProduct: item.codeProduct,
            })),
        });

        res.json({ success: true, message: "✅ update shelf succes" });
    } catch (error) {
        console.error("❌ Update shelf error:", error);
        res.status(500).json({ success: false, message: "error update shelf" });
    }
};



exports.tamplate = async (req, res) => {
    try {
        const result = await prisma.tamplate.findMany();
        res.json(result);
    } catch (e) {
        console.log(e);
        res.status(500).json({ msg: "List Station(Detail) Error" });
    }
};

exports.itemSearch = async (req, res) => {
    const { branchCode } = req.body;

    const product = await prisma.itemSearch.findMany({
        where: {
            branchCode: branchCode,
        }
    })

    const conditions = product.map(({ branchCode, codeProduct }) => ({
        branchCode,
        codeProduct,
    }));

    try {
        const [listOfItemHold, withdraws, stocks, sales, itemMinMaxList] = await Promise.all([

            prisma.listOfItemHold.findMany({
                where: {
                    codeProduct: {
                        in: conditions.map((i) => i.codeProduct),
                    },
                },
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
                where: {
                    OR: conditions.map(({ branchCode, codeProduct }) => ({
                        branchCode: {
                            equals: branchCode,
                        },
                        codeProduct,
                    })),
                },
                select: {
                    branchCode: true,
                    codeProduct: true,
                    quantity: true,
                    value: true,
                },
            }),

            prisma.stock.findMany({
                where: {
                    OR: conditions,
                },
                select: {
                    branchCode: true,
                    codeProduct: true,
                    quantity: true,
                },
            }),

            prisma.sales.findMany({
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
                where: {
                    OR: conditions,
                },
                select: {
                    branchCode: true,
                    codeProduct: true,
                    minStore: true,
                    maxStore: true,
                },
            }),
        ]);
        const result = product.map(({ branchCode, codeProduct, shelfCode, rowNo, index }) => {

            const productHoldInfo = listOfItemHold.find(
                p => p.codeProduct === codeProduct
            );

            const stockInfo = stocks.find(
                s => s.branchCode === branchCode && s.codeProduct === codeProduct
            );

            const withdrawItems = withdraws.filter(
                w => String(w.branchCode) === String(branchCode) && Number(w.codeProduct) === Number(codeProduct)
            );

            const totalWithdrawQuantity = withdrawItems.reduce((sum, w) => sum + Number(w.quantity || 0), 0);
            const totalWithdrawValue = withdrawItems.reduce((sum, w) => sum + Number(w.value || 0), 0);


            const saleInfo = sales.find(
                s => s.branchCode === branchCode && s.codeProduct === codeProduct
            );

            const itemMinMaxInfo = itemMinMaxList.find(
                m => m.branchCode === branchCode && m.codeProduct === codeProduct
            );

            return {
                branchCode,
                codeProduct,
                shelfCode,
                rowNo,
                index,
                nameProduct: productHoldInfo?.nameProduct || null,
                shelfLife: productHoldInfo?.shelfLife || null,
                nameBrand: productHoldInfo?.nameBrand || null,
                purchasePriceExcVAT: productHoldInfo?.purchasePriceExcVAT || null,
                salesPriceIncVAT: productHoldInfo?.salesPriceIncVAT || null,
                stockQuantity: stockInfo?.quantity || null,
                withdrawQuantity: totalWithdrawQuantity || null,
                minStore: itemMinMaxInfo?.minStore || null,
                maxStore: itemMinMaxInfo?.maxStore || null,
                withdrawValue: totalWithdrawValue || null,
                salesQuantity: saleInfo?.quantity || null,
                salesTotalPrice: saleInfo?.totalPrice || null,
            };

        });

        return res.json(result);
    } catch (e) {
        console.error("❌ List Shelf Error:", e);
        return res.status(500).json({ msg: "List Shelf Error" });
    }
};

