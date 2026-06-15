const prisma = require('../../../config/prisma');
const { touchDataSync } = require('./uploadJob');

exports.clearTemplate = async (req, res) => {
    try {
        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`TRUNCATE TABLE "ShelfTemplate"`;
            await touchDataSync('shelfTemplate', 0, undefined, tx);
        });
        return res.status(200).json({ message: "Shelf ShelfTemplate cleared successfully" });
    } catch (err) {
        console.error("Clear ShelfTemplate Error:", err);
        return res.status(500).json({ error: err.message });
    }
};
