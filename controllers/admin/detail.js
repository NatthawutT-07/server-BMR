const prisma = require("../../config/prisma");

exports.listDetail = async (req, res) => {
    try {
        const result = await prisma.detailStation.findMany({
            include: {
                itemminmax: true,
                sales: true
            }
        });
        res.json(result);
    } catch (e) {
        console.log(e);
        res.status(500).json({ msg: "List Station(Detail) Error" });
    }
};


// };
// exports.create = async (req, res) => {
//     try {
//         const { stationID, codeShelf, row, codeProduct, channelSales } = req.body;
        
//         if (!stationID || !codeShelf || !row || !codeProduct ) {
//             return res.status(400).json({
//                 error: 'กรุณาระบุ stationID, codeShelf, row, codeProduct และ channelSales',
//             });
//         }

//         const item = await prisma.itemminmax.findFirst({
//             where: {
//                 codeProduct: parseInt(codeProduct),
//             },
//         });

//         if (!item) {
//             return res.status(404).json({ error: 'not found itemminmax = codeProduct ' });
//         }

//         // serach sales = codeProduct + channelSales
//         const sale = await prisma.sales.findFirst({
//             where: {
//                 codeProduct: codeProduct,
//                 channelSales: channelSales,
//             },
//         });

//         if (!sale) {
//             return res.status(404).json({
//                 error: `not found sales for codeProduct: ${codeProduct} and channelSales: ${channelSales}`,
//             });
//         }
//         const existing = await prisma.detailStation.findFirst({
//             where: {
//                 stationID,
//                 codeShelf,
//                 codeProduct,
//                 sales: {
//                     channelSales: channelSales,
//                 },
//             },
//             include: {
//                 sales: true,
//             },
//         });

//         if (existing) {
//             return res.status(409).json({ error: 'data already' });
//         }


//         // create detailStation
//         const newDetail = await prisma.detailStation.create({
//             data: {
//                 stationID,
//                 codeShelf,
//                 row: parseInt(row),
//                 codeProduct,
//                 itemminmax: {
//                     connect: { id: item.id },
//                 },
//                 sales: {
//                     connect: { id: sale.id },
//                 },
//             },
//             include: {
//                 itemminmax: true,
//                 sales: true,
//             },
//         });

//         return res.status(201).json({
//             message: 'create detailStation success',
//             data: newDetail,
//         });
//     } catch (error) {
//         console.error('❌ Error in detailStation.create:', error);
//         return res.status(500).json({ error: 'error server' });
//     }
// };
// exports.deleteDetail = async (req, res) => {
//     try {
//         const { id } = req.params;

//         if (!id) {
//             return res.status(400).json({ error: 'path id for delete' });
//         }

//         const deleted = await prisma.detailStation.delete({
//             where: {
//                 id: parseInt(id),
//             },
//         });

//         return res.status(200).json({
//             message: 'delete success',
//             data: deleted,
//         });
//     } catch (error) {
//         console.error('❌ Error deleting detailStation:', error);
//         return res.status(500).json({ error: 'error server' });
//     }
// };
