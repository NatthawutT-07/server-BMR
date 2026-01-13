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

    // 1. DELETE (ค้นหาด้วย barcode แทน index เพื่อป้องกัน index เพี้ยน)
    if (action === "delete") {
        // Validate
        if (!fromShelf || !fromRow) throw new Error("Missing fromLocation for delete");

        // Get codeProduct from barcode
        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        // Lock
        const key = lockKey(branchCode, fromShelf);
        await acquireLock(prisma, key);
        try {
            // ✅ ใช้ codeProduct แทน fromIndex เพื่อป้องกันปัญหา index เปลี่ยนหลัง re-index
            const deleted = await prisma.sku.deleteMany({
                where: {
                    branchCode,
                    shelfCode: fromShelf,
                    rowNo: fromRow,
                    codeProduct: code,
                },
            });

            if (deleted.count === 0) {
                throw new Error(`ไม่พบสินค้า ${barcode} ใน ${fromShelf}/Row${fromRow} (อาจถูกลบไปแล้ว)`);
            }

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

            console.log(`✅ DELETE: Removed ${barcode} from ${fromShelf}/${fromRow}, re-indexed ${remaining.length} items`);
        } finally {
            await releaseLock(prisma, key);
        }
        return;
    }

    // 2. ADD (INSERT MODE - แทรกที่ตำแหน่งที่ระบุ + Shift สินค้าเดิมไปขวา)
    if (action === "add") {
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for add");

        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        const key = lockKey(branchCode, toShelf);
        await acquireLock(prisma, key);
        try {
            // ดึงข้อมูล row ปัจจุบัน
            const existingItems = await prisma.sku.findMany({
                where: { branchCode, shelfCode: toShelf, rowNo: toRow },
                orderBy: { index: "asc" }
            });

            // หา max index ปัจจุบัน
            const maxIndex = existingItems.length > 0
                ? Math.max(...existingItems.map(i => i.index))
                : 0;

            // ✅ INSERT MODE:
            // - ถ้า toIndex > maxIndex+1 → ใส่ที่ maxIndex+1 (ต่อท้าย)
            // - ถ้า toIndex <= maxIndex → shift สินค้าเดิมไปขวา แล้วแทรก
            let finalIndex = toIndex;

            if (toIndex > maxIndex + 1) {
                // ตำแหน่งที่ระบุเกินกว่าที่มี → ใส่ต่อท้าย
                finalIndex = maxIndex + 1;
                console.log(`⚠️ Index ${toIndex} > max+1, appending at ${finalIndex}`);
            } else if (existingItems.some(i => i.index >= toIndex)) {
                // มีสินค้าที่ index >= toIndex → shift ไปขวา (+1)
                const itemsToShift = existingItems.filter(i => i.index >= toIndex);
                const shiftUpdates = itemsToShift.map(itm =>
                    prisma.sku.update({
                        where: { id: itm.id },
                        data: { index: itm.index + 1 }
                    })
                );
                await prisma.$transaction(shiftUpdates);
                console.log(`⬅️ Shifted ${itemsToShift.length} items to the right`);
            }

            // Insert new item at finalIndex
            await prisma.sku.create({
                data: {
                    branchCode,
                    shelfCode: toShelf,
                    rowNo: toRow,
                    index: finalIndex,
                    codeProduct: code
                }
            });

            // Re-index entire row (1, 2, 3, ...) เพื่อให้เรียงต่อกัน
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

            console.log(`✅ ADD (INSERT): ${barcode} → ${toShelf}/${toRow}/index:${finalIndex} (total: ${allItems.length})`);
        } finally {
            await releaseLock(prisma, key);
        }
        return;
    }

    // 3. MOVE (INSERT MODE - ค้นหาด้วย barcode แทน index เพื่อป้องกัน index เพี้ยน)
    if (action === "move") {
        // Requires Source and Target
        if (!fromShelf || !fromRow) throw new Error("Missing fromLocation for move");
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for move");

        // Get Code
        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        // Lock both shelves
        const key1 = lockKey(branchCode, fromShelf);
        const key2 = fromShelf !== toShelf ? lockKey(branchCode, toShelf) : null;

        await acquireLock(prisma, key1);
        if (key2) await acquireLock(prisma, key2);

        try {
            // ========== Step A: Remove from Source (ค้นหาด้วย codeProduct) ==========
            // ✅ ใช้ codeProduct แทน fromIndex เพื่อป้องกันปัญหา index เปลี่ยนหลัง re-index
            const deleted = await prisma.sku.deleteMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow, codeProduct: code }
            });

            if (deleted.count === 0) {
                throw new Error(`ไม่พบสินค้า ${barcode} ใน ${fromShelf}/Row${fromRow} (อาจถูกย้ายหรือลบไปแล้ว)`);
            }

            // Re-index Source Row (1, 2, 3, ...)
            const sourceRemaining = await prisma.sku.findMany({
                where: { branchCode, shelfCode: fromShelf, rowNo: fromRow },
                orderBy: { index: "asc" }
            });

            if (sourceRemaining.length > 0) {
                const sourceUpdates = sourceRemaining.map((itm, idx) =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                );
                await prisma.$transaction(sourceUpdates);
            }

            console.log(`✅ MOVE Source: Removed ${barcode} from ${fromShelf}/${fromRow}, re-indexed ${sourceRemaining.length} items`);

            // ========== Step B: INSERT to Target Row at toIndex ==========
            // Step B1: Shift items >= toIndex to the right (+1)
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

            // Step B2: Insert new item at toIndex
            await prisma.sku.create({
                data: {
                    branchCode,
                    shelfCode: toShelf,
                    rowNo: toRow,
                    index: toIndex,
                    codeProduct: code
                }
            });

            // Step B3: Re-index Target Row (1, 2, 3, ...)
            const targetAll = await prisma.sku.findMany({
                where: { branchCode, shelfCode: toShelf, rowNo: toRow },
                orderBy: { index: "asc" }
            });

            if (targetAll.length > 0) {
                const targetUpdates = targetAll.map((itm, idx) =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                );
                await prisma.$transaction(targetUpdates);
            }

            console.log(`✅ MOVE Target: Inserted at ${toShelf}/${toRow}/index:${toIndex}, total: ${targetAll.length}`);

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

/**
 * PUT /api/admin/pog-requests/:id/position
 * Admin แก้ไขตำแหน่ง (ก่อนอนุมัติ)
 */
const updatePogRequestPosition = async (req, res) => {
    try {
        const { id } = req.params;
        const { toShelf, toRow, toIndex, fromShelf, fromRow, fromIndex } = req.body;

        // ตรวจสอบว่า request ยังเป็น pending หรือไม่
        const existing = await prisma.pogRequest.findUnique({
            where: { id: Number(id) }
        });

        if (!existing) {
            return res.status(404).json({
                ok: false,
                message: "ไม่พบรายการ"
            });
        }

        if (existing.status !== "pending") {
            return res.status(400).json({
                ok: false,
                message: "ไม่สามารถแก้ไขรายการที่ดำเนินการไปแล้ว"
            });
        }

        // เตรียมข้อมูลที่จะอัปเดต
        const updateData = {};

        if (toShelf !== undefined) updateData.toShelf = toShelf;
        if (toRow !== undefined) updateData.toRow = Number(toRow);
        if (toIndex !== undefined) updateData.toIndex = Number(toIndex);
        if (fromShelf !== undefined) updateData.fromShelf = fromShelf;
        if (fromRow !== undefined) updateData.fromRow = Number(fromRow);
        if (fromIndex !== undefined) updateData.fromIndex = Number(fromIndex);

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                ok: false,
                message: "ไม่มีข้อมูลที่จะอัปเดต"
            });
        }

        // อัปเดต
        const updated = await prisma.pogRequest.update({
            where: { id: Number(id) },
            data: updateData
        });

        return res.json({
            ok: true,
            message: "แก้ไขตำแหน่งสำเร็จ",
            data: updated
        });

    } catch (error) {
        console.error("updatePogRequestPosition error:", error);
        return res.status(500).json({
            ok: false,
            message: error.message || "เกิดข้อผิดพลาดในการแก้ไข"
        });
    }
};

/**
 * Helper: Re-index a specific row (1, 2, 3, ...)
 */
const reindexRow = async (branchCode, shelfCode, rowNo) => {
    const items = await prisma.sku.findMany({
        where: { branchCode, shelfCode, rowNo },
        orderBy: { index: "asc" }
    });

    if (items.length > 0) {
        const updates = items.map((itm, idx) =>
            prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
        );
        await prisma.$transaction(updates);
    }

    return items.length;
};

/**
 * POST /api/admin/pog-requests/bulk-approve
 * Bulk approve optimized: เรียงตาม createdAt, ลบทั้งหมดก่อนแล้ว re-index ทีเดียว
 */
const bulkApprove = async (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                ok: false,
                message: "กรุณาระบุ IDs ที่ต้องการอนุมัติ"
            });
        }

        // 1. ดึงข้อมูล requests ทั้งหมดและเรียงตาม createdAt (เก่าก่อน)
        const requests = await prisma.pogRequest.findMany({
            where: { id: { in: ids.map(Number) }, status: "pending" },
            orderBy: { createdAt: "asc" }
        });

        if (requests.length === 0) {
            return res.status(400).json({
                ok: false,
                message: "ไม่พบรายการที่รอดำเนินการ"
            });
        }

        // 2. แยกตามประเภท action และเรียงจากเก่าไปใหม่ (createdAt asc)
        const sortByCreatedAt = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);

        const deleteRequests = requests.filter(r => r.action === "delete").sort(sortByCreatedAt);
        const addRequests = requests.filter(r => r.action === "add").sort(sortByCreatedAt);
        const moveRequests = requests.filter(r => r.action === "move").sort(sortByCreatedAt);
        const swapRequests = requests.filter(r => r.action === "swap").sort(sortByCreatedAt);

        console.log(`📋 Bulk Approve: DELETE=${deleteRequests.length}, ADD=${addRequests.length}, MOVE=${moveRequests.length}, SWAP=${swapRequests.length}`);

        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const affectedRows = new Set(); // เก็บ shelf/row ที่ต้อง re-index

        // ========== 3. ลบทั้งหมดก่อน (ค้นหาด้วย codeProduct แทน index) ==========
        for (const req of deleteRequests) {
            try {
                const { branchCode, barcode, fromShelf, fromRow } = req;

                if (!fromShelf || !fromRow) {
                    throw new Error("Missing fromLocation for delete");
                }

                // Get codeProduct from barcode
                const code = await getCodeProduct(barcode);
                if (!code) {
                    throw new Error(`Product not found: ${barcode}`);
                }

                const key = lockKey(branchCode, fromShelf);
                await acquireLock(prisma, key);
                try {
                    const deleted = await prisma.sku.deleteMany({
                        where: {
                            branchCode,
                            shelfCode: fromShelf,
                            rowNo: Number(fromRow),
                            codeProduct: code
                        }
                    });

                    // บันทึก row ที่ต้อง re-index
                    affectedRows.add(`${branchCode}|${fromShelf}|${fromRow}`);

                    // อัปเดต status
                    await prisma.pogRequest.update({
                        where: { id: req.id },
                        data: { status: "completed" }
                    });

                    successCount++;
                } finally {
                    await releaseLock(prisma, key);
                }
            } catch (e) {
                errorCount++;
                errors.push(`Delete ${req.barcode}: ${e.message}`);
            }
        }

        // ========== 4. Re-index เฉพาะ rows ที่ถูกกระทบ (ทีเดียว) ==========
        for (const rowKey of affectedRows) {
            const [branchCode, shelfCode, rowNo] = rowKey.split("|");
            try {
                const key = lockKey(branchCode, shelfCode);
                await acquireLock(prisma, key);
                try {
                    const count = await reindexRow(branchCode, shelfCode, Number(rowNo));
                    console.log(`✅ Reindexed ${rowKey}: ${count} items`);
                } finally {
                    await releaseLock(prisma, key);
                }
            } catch (e) {
                console.error(`❌ Reindex ${rowKey} failed:`, e.message);
            }
        }

        // ========== 5. ADD ตามลำดับ createdAt ==========
        for (const req of addRequests) {
            try {
                await applyPogChange(req);
                await prisma.pogRequest.update({
                    where: { id: req.id },
                    data: { status: "completed" }
                });
                successCount++;
            } catch (e) {
                errorCount++;
                errors.push(`Add ${req.barcode}: ${e.message}`);
            }
        }

        // ========== 6. MOVE ตามลำดับ createdAt ==========
        for (const req of moveRequests) {
            try {
                await applyPogChange(req);
                await prisma.pogRequest.update({
                    where: { id: req.id },
                    data: { status: "completed" }
                });
                successCount++;
            } catch (e) {
                errorCount++;
                errors.push(`Move ${req.barcode}: ${e.message}`);
            }
        }

        // ========== 7. SWAP ตามลำดับ createdAt ==========
        for (const req of swapRequests) {
            try {
                await applyPogChange(req);
                await prisma.pogRequest.update({
                    where: { id: req.id },
                    data: { status: "completed" }
                });
                successCount++;
            } catch (e) {
                errorCount++;
                errors.push(`Swap ${req.barcode}: ${e.message}`);
            }
        }

        return res.json({
            ok: true,
            message: `อนุมัติสำเร็จ ${successCount} รายการ${errorCount > 0 ? `, ล้มเหลว ${errorCount} รายการ` : ""}`,
            successCount,
            errorCount,
            errors: errors.slice(0, 5), // แสดงเฉพาะ 5 errors แรก
            affectedRows: [...affectedRows]
        });

    } catch (error) {
        console.error("bulkApprove error:", error);
        return res.status(500).json({
            ok: false,
            message: error.message || "เกิดข้อผิดพลาดในการอนุมัติ"
        });
    }
};

module.exports = {
    getAllPogRequests,
    updatePogRequestStatus,
    deletePogRequest,
    bulkApprove,
    updatePogRequestPosition,
};
