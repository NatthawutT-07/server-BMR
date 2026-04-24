const prisma = require('../../config/prisma');
const response = require("../../utils/responseHelper");

exports.downloadTemplate = async (req, res) => {
    try {
        const { branchCode } = req.query;
        const whereClause = branchCode ? { branchCode: String(branchCode) } : {};

        const templates = await prisma.tamplate.findMany({
            where: whereClause,
            select: {
                branchCode: true,
                shelfCode: true,
                fullName: true,
                rowQty: true,
                type: true
            },
            orderBy: [
                { branchCode: 'asc' },
                { shelfCode: 'asc' }
            ],
        });

        return response.success(res, templates);
    } catch (err) {
        console.error('Error fetching templates:', err);
        return response.error(res, 'Failed to fetch data');
    }
};

exports.downloadSKU = async (req, res) => {
    try {
        const { branchCode } = req.query;
        const whereClause = branchCode ? { branchCode: String(branchCode) } : {};

        const skus = await prisma.sku.findMany({
            where: whereClause,
            select: {
                branchCode: true,
                shelfCode: true,
                rowNo: true,
                codeProduct: true,
                index: true
            },
            orderBy: [
                { branchCode: 'asc' },
                { shelfCode: 'asc' },
                { rowNo: 'asc' },
                { index: 'asc' }
            ],
        });

        return response.success(res, skus);
    } catch (err) {
        console.error('Error fetching SKU:', err);
        return response.error(res, 'Failed to fetch data');
    }
};
