const prisma = require('../../config/prisma');

exports.downloadTemplate = async (req, res) => {
    try {
        const { branchCode } = req.query;
        const whereClause = branchCode ? { branchCode: String(branchCode) } : {};

        const templates = await prisma.tamplate.findMany({
            where: whereClause,
            select: {
                branchCode: true,
                shelfCode: true,
                fullName: true,
                rowQty: true,
                type: true
            },
            orderBy: [
                { branchCode: 'asc' },
                { shelfCode: 'asc' }
            ],
        });

        res.json(templates); // ส่ง JSON กลับไปให้ frontend
    } catch (err) {
        console.error('Error fetching templates:', err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
};
exports.downloadSKU = async (req, res) => {
    try {
        const { branchCode } = req.query;
        const whereClause = branchCode ? { branchCode: String(branchCode) } : {};

        const skus = await prisma.sku.findMany({
            where: whereClause,
            select: {
                branchCode: true,
                shelfCode: true,
                rowNo: true,
                codeProduct: true,
                index: true
            },
            orderBy: [
                { branchCode: 'asc' },
                { shelfCode: 'asc' },
                { rowNo: 'asc' },
                // { codeProduct: 'asc' },
                { index: 'asc' }
            ],
        });

        res.json(skus); // ส่ง JSON กลับไปให้ frontend
    } catch (err) {
        console.error('Error fetching SKU:', err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
};
