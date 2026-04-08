const prisma = require('../../../config/prisma');
const { touchDataSync } = require('./uploadJob');

exports.clearSku = async (req, res) => {
    try {
        await prisma.$executeRaw`TRUNCATE TABLE "Sku"`;
        await touchDataSync('sku', 0);
        return res.status(200).json({ message: "SKU cleared successfully" });
    } catch (err) {
        console.error("Clear SKU Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
