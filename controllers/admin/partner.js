const prisma = require("../../config/prisma");

exports.listPartner = async (req, res) => {
    try {
        const station = await prisma.partners.findMany();
        res.json(station).status(200);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'select station error' });
    }
};
