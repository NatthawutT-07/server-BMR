const prisma = require("../../config/prisma");


exports.showItems = async (req, res) => {
    try {
        const itemall = await prisma.listOfItemHold.findMany();
        res.json(itemall).status(200);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'select station error' });
    }
};