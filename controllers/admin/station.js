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
        const { id, codeSAP, codeADA, codeBMX, adaStore } = req.body;

        const updated = await prisma.station.update({
            where: { id: Number(id) },
            data: {
                codeSAP,
                codeADA,
                codeBMX,
                adaStore,
            },
        });

        return res.status(200).json(updated);
    } catch (error) {
        console.error("❌ Error updating Station:", error);
        res.status(500).json({ message: "Station Update Error" });
    }
};

exports.addStation = async (req, res) => {
    try {
        const { id, codeSAP, codeADA, codeBMX, adaStore } = req.body;



        return res.status(201).json(newStation);
    } catch (error) {
        console.error("❌ Error creating Station:", error);
        res.status(500).json({ message: "Station Create Error" });
    }
};
exports.addStation = async (req, res) => {
    try {
        const { codeSAP, codeADA, codeBMX, adaStore } = req.body;

        const newStation = await prisma.station.create({
            data: {
                codeSAP,
                codeADA,
                codeBMX,
                adaStore,
            },
        });

        return res.status(201).json(newStation);
    } catch (error) {
        console.error("❌ Error creating Station:", error);
        res.status(500).json({ message: "Station Create Error" });
    }
};
