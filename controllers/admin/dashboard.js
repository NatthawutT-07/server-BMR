const prisma = require("../../config/prisma");

exports.data = async (req, res) => {
    try {
        const sales = await prisma.salesMonth.findMany();
        res.status(200).json({
            sales
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'select station error' });
    }
};

// exports.data = async (req, res) => {
//     const { month, year } = req.query;

//     try {
//         const sales = await prisma.salesMonth.findMany({
//             where: {
//                 ...(month && { month: parseInt(month) }),
//                 ...(year && { year: parseInt(year) }) 
//             }
//         });

//         res.status(200).json({ sales });
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: 'Failed to fetch data' });
//     }
// };
