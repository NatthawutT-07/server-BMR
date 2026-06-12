const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");
const dateHelper = require("../../utils/dateHelper");

// ตรวจสอบว่าสาขามี shelf update หรือไม่
exports.checkShelfUpdate = async (req, res) => {
    try {
        const { branchCode } = req.params;

        if (!branchCode) {
            return response.error(res, "Missing branchCode", "BAD_REQUEST", 400);
        }

        const record = await prisma.shelfUpdate.findUnique({
            where: { branchCode }
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

// สาขากด "รับทราบ" update แล้ว
exports.acknowledgeShelfUpdate = async (req, res) => {
    try {
        const { branchCode } = req.params;

        if (!branchCode) {
            return response.error(res, "Missing branchCode", "BAD_REQUEST", 400);
        }

        await prisma.shelfUpdate.upsert({
            where: { branchCode },
            create: { branchCode, hasUpdate: false },
            update: { hasUpdate: false },
        });

        return response.success(res, null, null, "Acknowledged successfully");
    } catch (error) {
        console.error("acknowledgeShelfUpdate error:", error);
        return response.error(res, "Server error");
    }
};

// Helper function สำหรับ call จาก shelf controller
exports.markShelfUpdated = async (branchCode, updatedBy = null) => {
    try {
        await prisma.shelfUpdate.upsert({
            where: { branchCode },
            create: { branchCode, hasUpdate: true, updatedBy },
            update: { hasUpdate: true, updatedBy },
        });
    } catch (error) {
        console.error("markShelfUpdated error:", error);
        // ไม่ throw error เพื่อไม่ให้กระทบ flow หลัก
    }
};

// ดึง change logs ที่ยังไม่รับทราบสำหรับสาขา (history mode + pagination)
exports.getShelfChangeLogs = async (req, res) => {
    try {
        const { branchCode } = req.params;
        const showAll = req.query.all === "true"; // ?all=true = แสดงทั้งหมด
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        if (!branchCode) {
            return response.error(res, "Missing branchCode", "BAD_REQUEST", 400);
        }

        const whereClause = {
            branchCode,
            ...(showAll ? {} : { acknowledged: false }),
        };

        // Get total count for pagination
        const total = await prisma.shelfChangeLog.count({ where: whereClause });

        // ดึง logs ที่ยังไม่รับทราบ (หรือทั้งหมดถ้า showAll)
        const logs = await prisma.shelfChangeLog.findMany({
            where: whereClause,
            orderBy: [{ createdAt: "desc" }, { shelfCode: "asc" }],
            select: {
                id: true,
                shelfCode: true,
                updateId: true,
                action: true,
                item_code: true,
                productName: true,
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

        // นับ unacknowledged
        const unacknowledgedCount = await prisma.shelfChangeLog.count({
            where: { branchCode, acknowledged: false },
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

// รับทราบ change log ทีละตัว (by id)
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

// รับทราบทั้งหมดของสาขา
exports.acknowledgeAllChangeLogs = async (req, res) => {
    try {
        const { branchCode } = req.params;

        if (!branchCode) {
            return response.error(res, "Missing branchCode", "BAD_REQUEST", 400);
        }

        const result = await prisma.shelfChangeLog.updateMany({
            where: { branchCode, acknowledged: false },
            data: { acknowledged: true, acknowledgedAt: dateHelper.getBangkokDate() },
        });

        return response.success(res, null, null, `Acknowledged ${result.count} logs`);
    } catch (error) {
        console.error("acknowledgeAllChangeLogs error:", error);
        return response.error(res, "Server error");
    }
};

// Admin: ดูสถานะการรับทราบของทุกสาขา
exports.getAllBranchAckStatus = async (req, res) => {
    try {
        // ดึงรายการสาขาทั้งหมดที่มี ShelfChangeLog
        const branchStats = await prisma.$queryRaw`
            SELECT 
                "branchCode",
                COUNT(*) FILTER (WHERE "acknowledged" = false) as "pending",
                COUNT(*) FILTER (WHERE "acknowledged" = true) as "acknowledged",
                COUNT(*) as "total",
                MAX("createdAt") as "lastChange",
                MAX(CASE WHEN "acknowledged" = false THEN "createdAt" ELSE NULL END) as "oldestPending"
            FROM "ShelfChangeLog"
            GROUP BY "branchCode"
            ORDER BY "pending" DESC, "branchCode" ASC
        `;

        // Format output
        const result = branchStats.map(row => ({
            branchCode: row.branchCode,
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

// Helper: สร้าง single change log สำหรับ itemCreate/itemDelete
exports.createSingleChangeLog = async (branchCode, shelfCode, action, items, createdBy = null) => {
    try {
        const { v4: uuidv4 } = require("uuid");
        const updateId = uuidv4();

        // ดึงชื่อสินค้าจาก ListOfItemHold
        const codesToLookup = items.map((i) => i.item_code).filter(Boolean);
        const products = await prisma.listOfItemHold.findMany({
            where: { item_code: { in: codesToLookup } },
            select: { item_code: true, nameProduct: true, nameBrand: true },
        });
        const productNameMap = new Map();
        products.forEach((p) => {
            productNameMap.set(p.item_code, p.nameProduct || p.nameBrand || `รหัส ${p.item_code}`);
        });

        const logs = items.map((item) => ({
            branchCode,
            shelfCode: item.shelfCode || shelfCode,
            updateId,
            action,
            item_code: item.item_code,
            productName: productNameMap.get(item.item_code) || null,
            fromRow: action === "delete" ? Number(item.rowNo) : null,
            fromIndex: action === "delete" ? Number(item.index) : null,
            toRow: action === "add" ? Number(item.rowNo) : null,
            toIndex: action === "add" ? Number(item.index) : null,
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

// Helper: สร้าง change logs จากการเปรียบเทียบ old vs new items
exports.createShelfChangeLogs = async (branchCode, shelfCode, oldItems, newItems, createdBy = null) => {
    try {
        const { v4: uuidv4 } = require("uuid");
        const updateId = uuidv4();
        const logs = [];

        // สร้าง map สำหรับ lookup
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

        // ดึงชื่อสินค้าจาก ListOfItemHold
        const allCodes = [...new Set([...oldMap.keys(), ...newMap.keys()])].map(Number);
        const products = await prisma.listOfItemHold.findMany({
            where: { item_code: { in: allCodes } },
            select: { item_code: true, nameProduct: true, nameBrand: true },
        });
        const productNameMap = new Map();
        products.forEach((p) => {
            productNameMap.set(p.item_code, p.nameProduct || p.nameBrand || `รหัส ${p.item_code}`);
        });

        // หา DELETE: อยู่ใน old แต่ไม่อยู่ใน new
        for (const [key, oldItem] of oldMap) {
            if (!newMap.has(key)) {
                logs.push({
                    branchCode,
                    shelfCode,
                    updateId,
                    action: "delete",
                    item_code: oldItem.item_code,
                    productName: productNameMap.get(oldItem.item_code) || null,
                    fromRow: oldItem.rowNo,
                    fromIndex: oldItem.index,
                    toRow: null,
                    toIndex: null,
                    createdBy,
                });
            }
        }

        // หา ADD: อยู่ใน new แต่ไม่อยู่ใน old
        for (const [key, newItem] of newMap) {
            if (!oldMap.has(key)) {
                logs.push({
                    branchCode,
                    shelfCode,
                    updateId,
                    action: "add",
                    item_code: newItem.item_code,
                    productName: productNameMap.get(newItem.item_code) || null,
                    fromRow: null,
                    fromIndex: null,
                    toRow: newItem.rowNo,
                    toIndex: newItem.index,
                    createdBy,
                });
            }
        }

        // หา MOVE: อยู่ทั้งสอง แต่ row/index เปลี่ยน
        for (const [key, oldItem] of oldMap) {
            const newItem = newMap.get(key);
            if (newItem) {
                if (oldItem.rowNo !== newItem.rowNo || oldItem.index !== newItem.index) {
                    logs.push({
                        branchCode,
                        shelfCode,
                        updateId,
                        action: "move",
                        item_code: oldItem.item_code,
                        productName: productNameMap.get(oldItem.item_code) || null,
                        fromRow: oldItem.rowNo,
                        fromIndex: oldItem.index,
                        toRow: newItem.rowNo,
                        toIndex: newItem.index,
                        createdBy,
                    });
                }
            }
        }

        // บันทึก logs ถ้ามี
        if (logs.length > 0) {
            await prisma.shelfChangeLog.createMany({ data: logs });
        }

        return logs.length;
    } catch (error) {
        console.error("createShelfChangeLogs error:", error);
        return 0;
    }
};
