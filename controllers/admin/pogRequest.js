const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const response = require("../../utils/responseHelper");
const { lockKey, acquireLock, releaseLock } = require("../../utils/lock");

// Helper: Get codeProduct from barcode
const getCodeProduct = async (barcode) => {
    if (!barcode) return null;
    const item = await prisma.listOfItemHold.findFirst({
        where: { barcode: String(barcode) },
        select: { codeProduct: true },
    });
    return item?.codeProduct || null;
};

// Helper: Apply Change to SKU Table
const applyPogChange = async (reqItem) => {
    const { branchCode, action, barcode } = reqItem;
    const fromShelf = reqItem.fromShelf;
    const fromRow = Number(reqItem.fromRow || 0);
    const toShelf = reqItem.toShelf;
    const toRow = Number(reqItem.toRow || 0);
    const toIndex = Number(reqItem.toIndex || 0);

    if (action === "delete") {
        if (!fromShelf || !fromRow) throw new Error("Missing fromLocation for delete");
        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        const key = lockKey(branchCode, fromShelf);
        await acquireLock(prisma, key);
        try {
            const deleted = await prisma.sku.deleteMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow, codeProduct: code },
            });
            if (deleted.count === 0) throw new Error(`ไม่พบสินค้า ${barcode} ใน ${fromShelf}/Row${fromRow}`);

            const remaining = await prisma.sku.findMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow },
                orderBy: { index: "asc" },
            });
            if (remaining.length > 0) {
                const updates = remaining.map((itm, idx) =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                );
                await prisma.$transaction(updates);
            }
        } finally {
            await releaseLock(prisma, key);
        }
        return;
    }

    if (action === "add") {
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for add");
        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        const key = lockKey(branchCode, toShelf);
        await acquireLock(prisma, key);
        try {
            const itemsToShift = await prisma.sku.findMany({
                where: { branchCode, shelfCode: toShelf, rowNo: toRow, index: { gte: toIndex } },
                orderBy: { index: "desc" }
            });
            if (itemsToShift.length > 0) {
                const shiftUpdates = itemsToShift.map(itm =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: itm.index + 1 } })
                );
                await prisma.$transaction(shiftUpdates);
            }
            await prisma.sku.create({
                data: { branchCode, shelfCode: toShelf, rowNo: toRow, index: toIndex, codeProduct: code }
            });
            const allItems = await prisma.sku.findMany({
                where: { branchCode, shelfCode: toShelf, rowNo: toRow },
                orderBy: { index: "asc" }
            });
            if (allItems.length > 0) {
                const reindexUpdates = allItems.map((itm, idx) =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                );
                await prisma.$transaction(reindexUpdates);
            }
        } finally {
            await releaseLock(prisma, key);
        }
        return;
    }

    if (action === "move") {
        if (!fromShelf || !fromRow) throw new Error("Missing fromLocation for move");
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for move");
        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        const isSameRow = (fromShelf === toShelf && Number(fromRow) === Number(toRow));
        const key1 = lockKey(branchCode, fromShelf);
        const key2 = fromShelf !== toShelf ? lockKey(branchCode, toShelf) : null;

        await acquireLock(prisma, key1);
        if (key2) await acquireLock(prisma, key2);

        try {
            if (isSameRow) {
                const allItems = await prisma.sku.findMany({
                    where: { branchCode, shelfCode: fromShelf, rowNo: Number(fromRow) },
                    orderBy: { index: "asc" }
                });
                const itemToMove = allItems.find(i => i.codeProduct === code);
                if (!itemToMove) throw new Error(`ไม่พบสินค้า ${barcode} ใน ${fromShelf}/Row${fromRow}`);

                const otherItems = allItems.filter(i => i.codeProduct !== code);
                const insertPosition = Math.min(Number(toIndex) - 1, otherItems.length);
                const newOrder = [
                    ...otherItems.slice(0, insertPosition),
                    itemToMove,
                    ...otherItems.slice(insertPosition)
                ];
                const updates = newOrder.map((itm, idx) =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                );
                await prisma.$transaction(updates);
            } else {
                const deleted = await prisma.sku.deleteMany({
                    where: { branchCode, shelfCode: fromShelf, rowNo: Number(fromRow), codeProduct: code }
                });
                if (deleted.count === 0) throw new Error(`ไม่พบสินค้า ${barcode} ใน ${fromShelf}/Row${fromRow}`);

                const sourceRemaining = await prisma.sku.findMany({
                    where: { branchCode, shelfCode: fromShelf, rowNo: Number(fromRow) },
                    orderBy: { index: "asc" }
                });
                if (sourceRemaining.length > 0) {
                    const sourceUpdates = sourceRemaining.map((itm, idx) =>
                        prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                    );
                    await prisma.$transaction(sourceUpdates);
                }

                const itemsToShift = await prisma.sku.findMany({
                    where: { branchCode, shelfCode: toShelf, rowNo: Number(toRow), index: { gte: Number(toIndex) } },
                    orderBy: { index: "desc" }
                });
                if (itemsToShift.length > 0) {
                    const shiftUpdates = itemsToShift.map(itm =>
                        prisma.sku.update({ where: { id: itm.id }, data: { index: itm.index + 1 } })
                    );
                    await prisma.$transaction(shiftUpdates);
                }
                await prisma.sku.create({
                    data: { branchCode, shelfCode: toShelf, rowNo: Number(toRow), index: Number(toIndex), codeProduct: code }
                });
                const targetAll = await prisma.sku.findMany({
                    where: { branchCode, shelfCode: toShelf, rowNo: Number(toRow) },
                    orderBy: { index: "asc" }
                });
                if (targetAll.length > 0) {
                    const targetUpdates = targetAll.map((itm, idx) =>
                        prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                    );
                    await prisma.$transaction(targetUpdates);
                }
            }
        } finally {
            await releaseLock(prisma, key1);
            if (key2) await releaseLock(prisma, key2);
        }
        return;
    }
};

/**
 * GET /api/admin/pog-requests
 */
const getAllPogRequests = async (req, res) => {
    try {
        const { branchCode, status, action, shelf, row, limit = 50, page = 1 } = req.query;
        const where = {};
        if (branchCode) where.branchCode = branchCode;
        if (status) where.status = status;
        if (action) where.action = action;

        if (shelf || row) {
            const orConditions = [];
            const r = row ? Number(row) : undefined;
            if (shelf && row) {
                orConditions.push({ fromShelf: shelf, fromRow: r });
                orConditions.push({ toShelf: shelf, toRow: r });
            } else if (shelf) {
                orConditions.push({ fromShelf: shelf }, { toShelf: shelf });
            } else if (row) {
                orConditions.push({ fromRow: r }, { toRow: r });
            }
            if (orConditions.length > 0) where.OR = orConditions;
        }

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(1000, Math.max(1, parseInt(limit) || 50));
        const skip = (pageNum - 1) * limitNum;

        const [requests, totalFiltered] = await Promise.all([
            prisma.pogRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limitNum }),
            prisma.pogRequest.count({ where })
        ]);

        const statsGroup = await prisma.pogRequest.groupBy({
            by: ['status'],
            where: { branchCode, action },
            _count: { id: true }
        });
        const stats = { pending: 0, rejected: 0, completed: 0 };
        statsGroup.forEach(g => { if (stats[g.status] !== undefined) stats[g.status] = g._count.id; });

        const branchStatsGroup = await prisma.pogRequest.groupBy({
            by: ['branchCode', 'action'],
            where: { status: 'pending' },
            _count: { id: true }
        });
        const branchStats = {};
        branchStatsGroup.forEach(g => {
            if (!branchStats[g.branchCode]) branchStats[g.branchCode] = { add: 0, move: 0, delete: 0, total: 0 };
            if (['add', 'move', 'delete'].includes(g.action)) {
                branchStats[g.branchCode][g.action] += g._count.id;
                branchStats[g.branchCode].total += g._count.id;
            }
        });

        return response.success(res, requests, {
            total: totalFiltered,
            page: pageNum,
            totalPages: Math.ceil(totalFiltered / limitNum),
            stats,
            branchStats,
        });
    } catch (error) {
        console.error("getAllPogRequests error:", error);
        return response.error(res, "เกิดข้อผิดพลาดในการดึงข้อมูล");
    }
};

/**
 * PATCH /api/admin/pog-requests/:id
 */
const updatePogRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, rejectReason } = req.body;
        if (!id) return response.error(res, "กรุณาระบุ id", "BAD_REQUEST", 400);

        const validStatuses = ["pending", "approved", "rejected", "completed"];
        if (status && !validStatuses.includes(status)) return response.error(res, "status ไม่ถูกต้อง", "BAD_REQUEST", 400);

        const updateData = {};
        if (status) updateData.status = status;
        if (note !== undefined) updateData.note = note;
        if (rejectReason !== undefined) updateData.note = rejectReason;

        if (status === "completed") {
            const request = await prisma.pogRequest.findUnique({ where: { id: Number(id) } });
            if (!request) throw new Error("Request not found");
            await applyPogChange(request);
        }

        const updated = await prisma.pogRequest.update({ where: { id: Number(id) }, data: updateData });
        return response.success(res, updated, null, "อัปเดตสถานะและปรับปรุงข้อมูล POG สำเร็จ");
    } catch (error) {
        console.error("updatePogRequestStatus error:", error);
        return response.error(res, error.message || "เกิดข้อผิดพลาดในการอัปเดต");
    }
};

/**
 * DELETE /api/admin/pog-requests/:id
 */
const deletePogRequest = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.pogRequest.delete({ where: { id: Number(id) } });
        return response.success(res, null, null, "ลบรายการสำเร็จ");
    } catch (error) {
        console.error("deletePogRequest error:", error);
        if (error.code === "P2025") return response.error(res, "ไม่พบรายการที่ต้องการลบ", "NOT_FOUND", 404);
        return response.error(res, "เกิดข้อผิดพลาดในการลบ");
    }
};

/**
 * PUT /api/admin/pog-requests/:id/position
 */
const updatePogRequestPosition = async (req, res) => {
    try {
        const { id } = req.params;
        const { toShelf, toRow, toIndex, fromShelf, fromRow, fromIndex } = req.body;
        const existing = await prisma.pogRequest.findUnique({ where: { id: Number(id) } });
        if (!existing) return response.error(res, "ไม่พบรายการ", "NOT_FOUND", 404);
        if (existing.status !== "pending") return response.error(res, "ไม่สามารถแก้ไขรายการที่ดำเนินการไปแล้ว", "BAD_REQUEST", 400);

        const updateData = {};
        if (toShelf !== undefined) updateData.toShelf = toShelf;
        if (toRow !== undefined) updateData.toRow = Number(toRow);
        if (toIndex !== undefined) updateData.toIndex = Number(toIndex);
        if (fromShelf !== undefined) updateData.fromShelf = fromShelf;
        if (fromRow !== undefined) updateData.fromRow = Number(fromRow);
        if (fromIndex !== undefined) updateData.fromIndex = Number(fromIndex);

        if (Object.keys(updateData).length === 0) return response.error(res, "ไม่มีข้อมูลที่จะอัปเดต", "BAD_REQUEST", 400);

        const updated = await prisma.pogRequest.update({ where: { id: Number(id) }, data: updateData });
        return response.success(res, updated, null, "แก้ไขตำแหน่งสำเร็จ");
    } catch (error) {
        console.error("updatePogRequestPosition error:", error);
        return response.error(res, error.message || "เกิดข้อผิดพลาดในการแก้ไข");
    }
};

/**
 * POST /api/admin/pog-requests/bulk-approve
 */
const bulkApprove = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return response.error(res, "กรุณาระบุ IDs ที่ต้องการอนุมัติ", "BAD_REQUEST", 400);

        const requests = await prisma.pogRequest.findMany({
            where: { id: { in: ids.map(Number) }, status: "pending" },
            orderBy: { createdAt: "asc" }
        });
        if (requests.length === 0) return response.error(res, "ไม่พบรายการที่รอดำเนินการ", "BAD_REQUEST", 400);

        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const affectedRows = new Set(); 
        const rowChanges = {};

        const calculateActualIndex = (branch, shelf, row, originalIndex) => {
            const key = `${branch}|${shelf}|${row}`;
            const changes = rowChanges[key] || [];
            let actualIndex = Number(originalIndex);
            for (const change of changes) {
                if (change.type === 'add' && change.originalIndex <= originalIndex) actualIndex++;
                else if (change.type === 'delete' && change.originalIndex < originalIndex) actualIndex--;
            }
            return actualIndex;
        };

        const recordChange = (branch, shelf, row, type, originalIndex) => {
            const key = `${branch}|${shelf}|${row}`;
            if (!rowChanges[key]) rowChanges[key] = [];
            rowChanges[key].push({ type, originalIndex: Number(originalIndex) });
        };

        for (const req of requests) {
            try {
                const originalFromIndex = req.fromIndex;
                const originalToIndex = req.toIndex;

                if (req.action === "delete") {
                    await applyPogChange(req);
                    affectedRows.add(`${req.branchCode}|${req.fromShelf}|${req.fromRow}`);
                    recordChange(req.branchCode, req.fromShelf, req.fromRow, 'delete', originalFromIndex);
                } else if (req.action === "add") {
                    req.toIndex = calculateActualIndex(req.branchCode, req.toShelf, req.toRow, originalToIndex);
                    await applyPogChange(req);
                    affectedRows.add(`${req.branchCode}|${req.toShelf}|${req.toRow}`);
                    recordChange(req.branchCode, req.toShelf, req.toRow, 'add', originalToIndex);
                } else if (req.action === "move") {
                    req.toIndex = calculateActualIndex(req.branchCode, req.toShelf, req.toRow, originalToIndex);
                    await applyPogChange(req);
                    affectedRows.add(`${req.branchCode}|${req.fromShelf}|${req.fromRow}`);
                    affectedRows.add(`${req.branchCode}|${req.toShelf}|${req.toRow}`);
                    recordChange(req.branchCode, req.fromShelf, req.fromRow, 'delete', originalFromIndex);
                    recordChange(req.branchCode, req.toShelf, req.toRow, 'add', originalToIndex);
                }
                await prisma.pogRequest.update({ where: { id: req.id }, data: { status: "completed" } });
                successCount++;
            } catch (e) {
                errorCount++;
                errors.push(`${req.action.toUpperCase()} ${req.barcode}: ${e.message}`);
            }
        }

        return response.success(res, { successCount, errorCount, errors: errors.slice(0, 5), affectedRows: [...affectedRows] }, null, `อนุมัติสำเร็จ ${successCount} รายการ${errorCount > 0 ? `, ล้มเหลว ${errorCount} รายการ` : ""}`);
    } catch (error) {
        console.error("bulkApprove error:", error);
        return response.error(res, error.message || "เกิดข้อผิดพลาดในการอนุมัติ");
    }
};

module.exports = { getAllPogRequests, updatePogRequestStatus, deletePogRequest, bulkApprove, updatePogRequestPosition };
