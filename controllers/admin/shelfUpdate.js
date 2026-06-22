const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");
const dateHelper = require("../../utils/dateHelper");

// ตรวจสอบว่าสาขามี shelf update หรือไม่
exports.checkShelfUpdate = async (req, res) => {
    try {
        const { branch_code } = req.params;

        if (!branch_code) {
            return response.error(res, "Missing branch_code", "BAD_REQUEST", 400);
        }

        const record = await prisma.shelfUpdate.findUnique({
            where: { branch_code }
        });

        return response.success(res, {
            hasUpdate: record?.hasUpdate || false,
            updatedAt: record?.updatedAt || null,
            updatedBy: record?.updatedBy || null,
        });
    } catch (error) {
        console.error("checkShelfUpdate error:", error);
        return response.error(res, "Server error");
    }
};

exports.acknowledgeShelfUpdate = async (req, res) => {
    try {
        const { branch_code } = req.params;

        if (!branch_code) {
            return response.error(res, "Missing branch_code", "BAD_REQUEST", 400);
        }

        await prisma.shelfUpdate.upsert({
            where: { branch_code },
            create: { branch_code, hasUpdate: false },
            update: { hasUpdate: false },
        });

        return response.success(res, null, null, "Acknowledged successfully");
    } catch (error) {
        console.error("acknowledgeShelfUpdate error:", error);
        return response.error(res, "Server error");
    }
};

exports.markShelfUpdated = async (branch_code, updatedBy = null) => {
    try {
        await prisma.shelfUpdate.upsert({
            where: { branch_code },
            create: { branch_code, hasUpdate: true, updatedBy },
            update: { hasUpdate: true, updatedBy },
        });
    } catch (error) {
        console.error("markShelfUpdated error:", error);
    }
};

exports.getShelfChangeLogs = async (req, res) => {
    try {
        const { branch_code } = req.params;
        const showAll = req.query.all === "true"; //all=true = แสดงทั้งหมด
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        if (!branch_code) {
            return response.error(res, "Missing branch_code", "BAD_REQUEST", 400);
        }

        const whereClause = {
            branch_code,
            ...(showAll ? {} : { acknowledged: false }),
        };
        const total = await prisma.shelfChangeLog.count({ where: whereClause });
        const logs = await prisma.shelfChangeLog.findMany({
            where: whereClause,
            orderBy: [{ createdAt: "desc" }, { shelf_code: "asc" }],
            select: {
                id: true,
                shelf_code: true,
                updateId: true,
                action: true,
                item_code: true,
                item_name: true,
                fromRow: true,
                fromIndex: true,
                toRow: true,
                toIndex: true,
                createdAt: true,
                createdBy: true,
                acknowledged: true,
            },
            skip,
            take: limit,
        });

        const unacknowledgedCount = await prisma.shelfChangeLog.count({
            where: { branch_code, acknowledged: false },
        });

        return response.success(res, logs, {
            unacknowledgedCount,
            pagination: {
                page,
                limit,
                count: logs.length,
                total,
            }
        });
    } catch (error) {
        console.error("getShelfChangeLogs error:", error);
        return response.error(res, "Server error");
    }
};

exports.acknowledgeChangeLog = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return response.error(res, "Missing log id", "BAD_REQUEST", 400);
        }

        await prisma.shelfChangeLog.update({
            where: { id: Number(id) },
            data: { acknowledged: true, acknowledgedAt: dateHelper.getBangkokDate() },
        });

        return response.success(res, null, null, "Acknowledged successfully");
    } catch (error) {
        console.error("acknowledgeChangeLog error:", error);
        return response.error(res, "Server error");
    }
};

exports.acknowledgeAllChangeLogs = async (req, res) => {
    try {
        const { branch_code } = req.params;

        if (!branch_code) {
            return response.error(res, "Missing branch_code", "BAD_REQUEST", 400);
        }

        const result = await prisma.shelfChangeLog.updateMany({
            where: { branch_code, acknowledged: false },
            data: { acknowledged: true, acknowledgedAt: dateHelper.getBangkokDate() },
        });

        return response.success(res, null, null, `Acknowledged ${result.count} logs`);
    } catch (error) {
        console.error("acknowledgeAllChangeLogs error:", error);
        return response.error(res, "Server error");
    }
};

exports.getAllBranchAckStatus = async (req, res) => {
    try {
        const { startUtc, endUtc } = dateHelper.getBangkokCurrentAndPreviousMonthRange();
        const branchStats = await prisma.$queryRaw`
            SELECT 
                "branch_code",
                COUNT(*) FILTER (WHERE "acknowledged" = false) as "pending",
                COUNT(*) FILTER (WHERE "acknowledged" = true) as "acknowledged",
                COUNT(*) as "total",
                MAX("createdAt") as "lastChange",
                MAX(CASE WHEN "acknowledged" = false THEN "createdAt" ELSE NULL END) as "oldestPending"
            FROM "ShelfChangeLog"
            WHERE "createdAt" >= ${startUtc}
              AND "createdAt" <= ${endUtc}
            GROUP BY "branch_code"
            ORDER BY "pending" DESC, "branch_code" ASC
        `;

        const result = branchStats.map(row => ({
            branch_code: row.branch_code,
            pending: Number(row.pending) || 0,
            acknowledged: Number(row.acknowledged) || 0,
            total: Number(row.total) || 0,
            lastChange: row.lastChange,
            oldestPending: row.oldestPending,
            status: Number(row.pending) > 0 ? 'pending' : 'completed',
        }));

        return response.success(res, {
            branches: result,
            summary: {
                totalBranches: result.length,
                branchesWithPending: result.filter(b => b.pending > 0).length,
                totalPending: result.reduce((sum, b) => sum + b.pending, 0),
            }
        });
    } catch (error) {
        console.error("getAllBranchAckStatus error:", error);
        return response.error(res, "Server error");
    }
};

exports.createSingleChangeLog = async (branch_code, shelf_code, action, items, createdBy = null) => {
    try {
        const { v4: uuidv4 } = require("uuid");
        const updateId = uuidv4();

        const codesToLookup = items.map((i) => i.item_code).filter(Boolean);
        const products = await prisma.masterItem.findMany({
            where: { item_code: { in: codesToLookup } },
            select: { item_code: true, item_name: true, brand_name: true },
        });
        const item_nameMap = new Map();
        products.forEach((p) => {
            item_nameMap.set(p.item_code, p.item_name || p.brand_name || `รหัส ${p.item_code}`);
        });

        const logs = items.map((item) => ({
            branch_code,
            shelf_code: item.shelf_code || shelf_code,
            updateId,
            action,
            item_code: item.item_code,
            item_name: item_nameMap.get(item.item_code) || null,
            fromRow: action === "delete" ? Number(item.shelf_row_number) : null,
            fromIndex: action === "delete" ? Number(item.shelf_index_number) : null,
            toRow: action === "add" ? Number(item.shelf_row_number) : null,
            toIndex: action === "add" ? Number(item.shelf_index_number) : null,
            createdBy,
        }));

        if (logs.length > 0) {
            await prisma.shelfChangeLog.createMany({ data: logs });
        }

        return logs.length;
    } catch (error) {
        console.error("createSingleChangeLog error:", error);
        return 0;
    }
};

exports.createShelfChangeLogs = async (branch_code, shelf_code, oldItems, newItems, createdBy = null) => {
    try {
        const { v4: uuidv4 } = require("uuid");
        const updateId = uuidv4();
        const logs = [];
        const oldMap = new Map();
        oldItems.forEach((item) => {
            const key = `${item.item_code}`;
            oldMap.set(key, item);
        });

        const newMap = new Map();
        newItems.forEach((item) => {
            const key = `${item.item_code}`;
            newMap.set(key, item);
        });
        const allCodes = [...new Set([...oldMap.keys(), ...newMap.keys()])].map(Number);
        const products = await prisma.masterItem.findMany({
            where: { item_code: { in: allCodes } },
            select: { item_code: true, item_name: true, brand_name: true },
        });
        const item_nameMap = new Map();
        products.forEach((p) => {
            item_nameMap.set(p.item_code, p.item_name || p.brand_name || `รหัส ${p.item_code}`);
        });

        for (const [key, oldItem] of oldMap) {
            if (!newMap.has(key)) {
                logs.push({
                    branch_code,
                    shelf_code,
                    updateId,
                    action: "delete",
                    item_code: oldItem.item_code,
                    item_name: item_nameMap.get(oldItem.item_code) || null,
                    fromRow: oldItem.shelf_row_number,
                    fromIndex: oldItem.shelf_index_number,
                    toRow: null,
                    toIndex: null,
                    createdBy,
                });
            }
        }

        for (const [key, newItem] of newMap) {
            if (!oldMap.has(key)) {
                logs.push({
                    branch_code,
                    shelf_code,
                    updateId,
                    action: "add",
                    item_code: newItem.item_code,
                    item_name: item_nameMap.get(newItem.item_code) || null,
                    fromRow: null,
                    fromIndex: null,
                    toRow: newItem.shelf_row_number,
                    toIndex: newItem.shelf_index_number,
                    createdBy,
                });
            }
        }

        for (const [key, oldItem] of oldMap) {
            const newItem = newMap.get(key);
            if (newItem) {
                if (oldItem.shelf_row_number !== newItem.shelf_row_number || oldItem.shelf_index_number !== newItem.shelf_index_number) {
                    logs.push({
                        branch_code,
                        shelf_code,
                        updateId,
                        action: "move",
                        item_code: oldItem.item_code,
                        item_name: item_nameMap.get(oldItem.item_code) || null,
                        fromRow: oldItem.shelf_row_number,
                        fromIndex: oldItem.shelf_index_number,
                        toRow: newItem.shelf_row_number,
                        toIndex: newItem.shelf_index_number,
                        createdBy,
                    });
                }
            }
        }

        if (logs.length > 0) {
            await prisma.shelfChangeLog.createMany({ data: logs });
        }

        return logs.length;
    } catch (error) {
        console.error("createShelfChangeLogs error:", error);
        return 0;
    }
};
