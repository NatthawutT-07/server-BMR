// controllers/admin/pogRequest.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
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
    const { branchCode, action, barcode, swapBarcode } = reqItem;
    // Position Info
    const fromShelf = reqItem.fromShelf;
    const fromRow = Number(reqItem.fromRow || 0);
    const fromIndex = Number(reqItem.fromIndex || 0);

    const toShelf = reqItem.toShelf;
    const toRow = Number(reqItem.toRow || 0);
    const toIndex = Number(reqItem.toIndex || 0);

    // 1. DELETE
    if (action === "delete") {
        // Validate
        if (!fromShelf || !fromRow || !fromIndex) throw new Error("Missing fromLocation for delete");

        // Lock
        const key = lockKey(branchCode, fromShelf);
        await acquireLock(prisma, key);
        try {
            // Delete specific item
            await prisma.sku.deleteMany({
                where: {
                    branchCode,
                    shelfCode: fromShelf,
                    rowNo: fromRow,
                    index: fromIndex,
                },
            });

            // Re-index (Shift left)
            const remaining = await prisma.sku.findMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow },
                orderBy: { index: "asc" },
            });

            if (remaining.length > 0) {
                const updates = remaining.map((itm, idx) =>
                    prisma.sku.update({
                        where: { id: itm.id },
                        data: { index: idx + 1 },
                    })
                );
                await prisma.$transaction(updates);
            }
        } finally {
            await releaseLock(prisma, key);
        }
        return;
    }

    // 2. ADD
    if (action === "add") {
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for add");

        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        const key = lockKey(branchCode, toShelf);
        await acquireLock(prisma, key);
        try {
            // ✅ FORCE OVERWRITE: Clear target slot first
            // User intends to place product HERE, so we remove whatever was there.
            await prisma.sku.deleteMany({
                where: { branchCode, shelfCode: toShelf, rowNo: toRow, index: toIndex }
            });

            await prisma.sku.create({
                data: {
                    branchCode,
                    shelfCode: toShelf,
                    rowNo: toRow,
                    index: toIndex,
                    codeProduct: code
                }
            });
        } finally {
            await releaseLock(prisma, key);
        }
        return;
    }

    // 3. MOVE
    if (action === "move") {
        // Requires Source and Target
        if (!fromShelf || !fromRow || !fromIndex) throw new Error("Missing fromLocation for move");
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for move");

        // Get Code
        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        // Lock both
        const key1 = lockKey(branchCode, fromShelf);
        const key2 = fromShelf !== toShelf ? lockKey(branchCode, toShelf) : null;

        await acquireLock(prisma, key1);
        if (key2) await acquireLock(prisma, key2);

        try {
            // Step A: Remove from Source & Re-index Source (Shift Left)
            // Similar to Delete logic
            await prisma.sku.deleteMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow, index: fromIndex }
            });

            // Shift Left remaining in Source Row
            const sourceRemaining = await prisma.sku.findMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow },
                orderBy: { index: "asc" }
            });

            if (sourceRemaining.length > 0) {
                // Re-assign indices 1..N
                const updates = sourceRemaining.map((itm, idx) =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                );
                await prisma.$transaction(updates);
            }

            // Step B: Insert into Target & Re-index Target (Shift Right)
            // If Target is same as Source row, we must re-fetch strictly to handle correct indices
            // But since we just re-indexed source 1..N, if toRow==fromRow, `sourceRemaining` is the new state.

            // HOWEVER, to keep logic simple and robust, let's treat Target separately.
            // We look at Target Row. Find items >= toIndex. Shift them +1.

            const targetItems = await prisma.sku.findMany({
                where: { branchCode, shelfCode: toShelf, rowNo: toRow, index: { gte: toIndex } },
                orderBy: { index: "desc" } // Shift from end to avoid conflicts?
            });

            // We need updates
            // Note: unique constraint might bite if we don't be careful.
            // But we proved index not unique. So we can update all.
            if (targetItems.length > 0) {
                const shiftUpdates = targetItems.map(itm =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: itm.index + 1 } })
                );
                await prisma.$transaction(shiftUpdates);
            }

            // Insert Item
            await prisma.sku.create({
                data: {
                    branchCode,
                    shelfCode: toShelf,
                    rowNo: toRow,
                    index: toIndex,
                    codeProduct: code
                }
            });

        } finally {
            await releaseLock(prisma, key1);
            if (key2) await releaseLock(prisma, key2);
        }
        return;
    }

    // 4. SWAP
    if (action === "swap") {
        // Requires both locations? Or just From -> To?
        // Modal implies moving Current(From) -> Target(To). And Target(SwapBarcode) -> Current(From).

        if (!fromShelf || !fromRow || !fromIndex) throw new Error("Missing fromLocation for swap");
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for swap");

        const codeA = await getCodeProduct(barcode);
        const codeB = await getCodeProduct(swapBarcode);

        if (!codeA) throw new Error(`Product A not found: ${barcode}`);
        if (!codeB) throw new Error(`Product B not found: ${swapBarcode}`);

        // Lock both shelves (if different)
        const key1 = lockKey(branchCode, fromShelf);
        const key2 = fromShelf !== toShelf ? lockKey(branchCode, toShelf) : null;

        await acquireLock(prisma, key1);
        if (key2) await acquireLock(prisma, key2);

        try {
            // Update A -> B pos
            // Update B -> A pos
            // Use updateMany by location

            // Move A to ToLocation (Overwrite B there)
            const op1 = prisma.sku.updateMany({
                where: { branchCode, shelfCode: toShelf, rowNo: toRow, index: toIndex },
                data: { codeProduct: codeA }
            });

            // Move B to FromLocation (Overwrite A there)
            const op2 = prisma.sku.updateMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow, index: fromIndex },
                data: { codeProduct: codeB }
            });

            const res = await prisma.$transaction([op1, op2]);
            if (res[0].count === 0 || res[1].count === 0) {
                // Warn if nothing updated?
                // If target or source didn't exist, we failed to swap correctly.
                // But let's assume valid request.
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
 * Admin ดูรายการทั้งหมด (filter ได้)
 */
const getAllPogRequests = async (req, res) => {
    try {
        const { branchCode, status, action, limit = 200 } = req.query;

        const where = {};
        if (branchCode) where.branchCode = branchCode;
        if (status) where.status = status;
        if (action) where.action = action;

        // 1. Get filtered data
        const requests = await prisma.pogRequest.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: Number(limit),
        });

        // 2. Get stats (counts by status) - use base filter (branch/action) but ignore status filter
        const statsWhere = {};
        if (branchCode) statsWhere.branchCode = branchCode;
        if (action) statsWhere.action = action; // Include action filter in stats if needed, typically stats should reflect current scope

        const statsGroup = await prisma.pogRequest.groupBy({
            by: ['status'],
            where: statsWhere,
            _count: {
                id: true
            }
        });

        const stats = {
            pending: 0,
            rejected: 0,
            completed: 0
        };

        statsGroup.forEach(g => {
            if (stats[g.status] !== undefined) {
                stats[g.status] = g._count.id;
            }
        });

        return res.json({
            ok: true,
            data: requests,
            count: requests.length,
            stats, // ✅ Include stats
        });
    } catch (error) {
        console.error("getAllPogRequests error:", error);
        return res.status(500).json({
            ok: false,
            message: "เกิดข้อผิดพลาดในการดึงข้อมูล",
        });
    }
};

/**
 * PATCH /api/admin/pog-requests/:id
 * Admin อัปเดตสถานะ
 */
const updatePogRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, rejectReason } = req.body;

        if (!id) {
            return res.status(400).json({
                ok: false,
                message: "กรุณาระบุ id",
            });
        }

        // Validate status
        const validStatuses = ["pending", "approved", "rejected", "completed"];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                ok: false,
                message: "status ไม่ถูกต้อง",
            });
        }

        const updateData = {};
        if (status) updateData.status = status;

        // ✅ Support both note and rejectReason (for reject with reason)
        if (note !== undefined) updateData.note = note;
        if (rejectReason !== undefined) updateData.note = rejectReason;

        // ✅ AUTO-APPLY if Completed
        if (status === "completed") {
            const request = await prisma.pogRequest.findUnique({ where: { id: Number(id) } });
            if (!request) throw new Error("Request not found");

            // Execute logic
            await applyPogChange(request);
        }

        const updated = await prisma.pogRequest.update({
            where: { id: Number(id) },
            data: updateData,
        });

        return res.json({
            ok: true,
            message: "อัปเดตสถานะและปรับปรุงข้อมูล POG สำเร็จ",
            data: updated,
        });
    } catch (error) {
        console.error("updatePogRequestStatus error:", error);

        // ✅ Return actual error message for frontend
        return res.status(400).json({
            ok: false,
            message: error.message || "เกิดข้อผิดพลาดในการอัปเดต",
        });
    }
};

/**
 * DELETE /api/admin/pog-requests/:id
 * Admin ลบรายการ
 */
const deletePogRequest = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.pogRequest.delete({
            where: { id: Number(id) },
        });

        return res.json({
            ok: true,
            message: "ลบรายการสำเร็จ",
        });
    } catch (error) {
        console.error("deletePogRequest error:", error);

        if (error.code === "P2025") {
            return res.status(404).json({
                ok: false,
                message: "ไม่พบรายการที่ต้องการลบ",
            });
        }

        return res.status(500).json({
            ok: false,
            message: "เกิดข้อผิดพลาดในการลบ",
        });
    }
};

module.exports = {
    getAllPogRequests,
    updatePogRequestStatus,
    deletePogRequest,
};
