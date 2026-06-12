const prisma = require('../../config/prisma');
const response = require("../../utils/responseHelper");

exports.downloadTemplate = async (req, res) => {
    try {
        const { branch_code } = req.query;
        const whereClause = branch_code ? { branch_code: String(branch_code) } : {};

        const templates = await prisma.Template.findMany({
            where: whereClause,
            select: {
                branch_code: true,
                shelfCode: true,
                fullName: true,
                rowQty: true,
                type: true
            },
            orderBy: [
                { branch_code: 'asc' },
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
        const { branch_code } = req.query;
        const whereClause = branch_code ? { branch_code: String(branch_code) } : {};

        const skus = await prisma.sku.findMany({
            where: whereClause,
            select: {
                branch_code: true,
                shelfCode: true,
                rowNo: true,
                item_code: true,
                index: true
            },
            orderBy: [
                { branch_code: 'asc' },
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
