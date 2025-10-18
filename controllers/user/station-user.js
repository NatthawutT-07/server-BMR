
const prisma = require("../../config/prisma");


exports.liststation = async (req, res) => {
    try {
        const stations = await prisma.station.findMany({
            orderBy: { id: 'asc' },
        });
        res.json(stations).status(200);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'select station error' });
    }
};

exports.callStation = async (req, res) => {
    try {
        const callStation = await prisma.itemminmax.findMany()
        res.json(callStation).status(200)
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'callstation error' })
    }
}

