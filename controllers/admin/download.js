const prisma = require('../../config/prisma');
const response = require("../../utils/responseHelper");

exports.downloadTemplate = async (req, res) => {
    try {
        const { branch_code } = req.query;
        const whereClause = branch_code ? { branch_code: String(branch_code) } : {};

        const templates = await prisma.shelfTemplate.findMany({
            where: whereClause,
            select: {
                branch_code: true,
                shelf_code: true,
                shelf_name: true,
                shelf_total_row: true,
                type: true
            },
            orderBy: [
                { branch_code: 'asc' },
                { shelf_code: 'asc' }
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

        const skus = await prisma.skuPosition.findMany({
            where: whereClause,
            select: {
                branch_code: true,
                shelf_code: true,
                shelf_row_number: true,
                item_code: true,
                shelf_index_number: true
            },
            orderBy: [
                { branch_code: 'asc' },
                { shelf_code: 'asc' },
                { shelf_row_number: 'asc' },
                { shelf_index_number: 'asc' }
            ],
        });

        return response.success(res, skus);
    } catch (err) {
        console.error('Error fetching SKU:', err);
        return response.error(res, 'Failed to fetch data');
    }
};
