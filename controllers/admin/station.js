const prisma = require("../../config/prisma");



exports.deleteStation = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ error: 'path id for delete' });
        }

        const deleted = await prisma.station.delete({
            where: {
                id: parseInt(id),
            },
        });

        return res.status(200).json({
            message: 'delete success',
            data: deleted,
        });
    } catch (error) {
        console.error('❌ Error deleting Station:', error);
        return res.status(500).json({ error: 'error server' });
    }
};


exports.updateStation = async (req, res) => {
    try {
        const { stationId, station } = req.body;
        const { id } = req.params;

        if (!stationId || !station) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const updated = await prisma.station.update({
            where: {
                id: Number(id),
            },
            data: {
                stationId,
                station,
            },
        });

        return res.status(200).json(updated);
    } catch (error) {
        console.error('❌ Error updating Station:', error);
        res.status(500).json({ message: "Station Update Error" });
    }
};


exports.addStation = async (req, res) => {
    try {
        const { station, stationId } = req.body;

        if (!station || !stationId) {
            return res.status(400).json({ message: "Missing station or stationId" });
        }

        const newStation = await prisma.station.create({
            data: {
                station,
                stationId,
            },
        });

        return res.status(201).json(newStation);
    } catch (error) {
        console.error("❌ Error creating Station:", error);
        res.status(500).json({ message: "Station Create Error" });
    }
};
