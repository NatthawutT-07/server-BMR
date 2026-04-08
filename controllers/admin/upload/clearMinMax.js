const prisma = require('../../../config/prisma');
const { touchDataSync } = require('./uploadJob');

exports.clearMinMax = async (req, res) => {
    try {
        await prisma.$executeRaw`TRUNCATE TABLE "ItemMinMax"`;
        await touchDataSync('minMax', 0);
        return res.status(200).json({ message: "ItemMinMax cleared successfully" });
    } catch (err) {
        console.error("Clear MinMax Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
