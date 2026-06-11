const prisma = require('../../../config/prisma');
const { touchDataSync } = require('./uploadJob');

exports.clearStock = async (req, res) => {
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`TRUNCATE TABLE "Stock"`;
            await touchDataSync('stock', 0, undefined, tx);
        });
        return res.status(200).json({ message: "Stock cleared successfully" });
    } catch (err) {
        console.error("Clear Stock Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
