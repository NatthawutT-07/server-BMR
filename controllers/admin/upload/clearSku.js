const prisma = require('../../../config/prisma');
const { touchDataSync } = require('./uploadJob');

exports.clearSku = async (req, res) => {
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`TRUNCATE TABLE "SkuPosition"`;
            await touchDataSync('skuPosition', 0, undefined, tx);
        });
        return res.status(200).json({ message: "SKU cleared successfully" });
    } catch (err) {
        console.error("Clear SKU Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
