const prisma = require('../../config/prisma');

exports.downloadTemplate = async (req, res) => {
    try {
        const templates = await prisma.tamplate.findMany({
            orderBy: { branchCode: 'asc' },
        });

        res.json(templates); // ส่ง JSON กลับไปให้ frontend
    } catch (err) {
        console.error('Error fetching templates:', err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
};
exports.downloadSKU = async (req, res) => {
    try {
        const templates = await prisma.sku.findMany({
            orderBy: { branchCode: 'asc' },
        });

        res.json(templates); // ส่ง JSON กลับไปให้ frontend
    } catch (err) {
        console.error('Error fetching templates:', err);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
};
