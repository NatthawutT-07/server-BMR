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

        } finally {
            await releaseLock(prisma, key);
        }
        return;
    }

    // 2. ADD (INSERT MODE - แทรกที่ตำแหน่งที่ระบุ + Shift สินค้าเดิมไปขวา)
    // หมายเหตุ: bulk approve จะใช้ offset tracking เพื่อรักษาลำดับตาม createdAt
    if (action === "add") {
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for add");

        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        const key = lockKey(branchCode, toShelf);
        await acquireLock(prisma, key);
        try {
            // Shift items >= toIndex to the right (+1)
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

            // Insert new item at toIndex
            await prisma.sku.create({
                data: {
                    branchCode,
                    shelfCode: toShelf,
                    rowNo: toRow,
                    index: toIndex,
                    codeProduct: code
                }
            });

            // Re-index entire row (1, 2, 3, ...)
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

    // 3. MOVE (INSERT MODE - รองรับการย้ายทั้งภายใน row เดียวกันและข้าม row)
    if (action === "move") {
        // Requires Source and Target
        if (!fromShelf || !fromRow) throw new Error("Missing fromLocation for move");
        if (!toShelf || !toRow || !toIndex) throw new Error("Missing toLocation for move");

        // Get Code
        const code = await getCodeProduct(barcode);
        if (!code) throw new Error(`Product not found for barcode: ${barcode}`);

        // ตรวจสอบว่าย้ายภายใน row เดียวกันหรือไม่
        const isSameRow = (fromShelf === toShelf && Number(fromRow) === Number(toRow));

        // Lock both shelves
        const key1 = lockKey(branchCode, fromShelf);
        const key2 = fromShelf !== toShelf ? lockKey(branchCode, toShelf) : null;

        await acquireLock(prisma, key1);
        if (key2) await acquireLock(prisma, key2);

        try {
            if (isSameRow) {
                // ========== SAME ROW MOVE ==========
                // ดึงข้อมูล row ทั้งหมด
                const allItems = await prisma.sku.findMany({
                    where: { branchCode, shelfCode: fromShelf, rowNo: Number(fromRow) },
                    orderBy: { index: "asc" }
                });

                // หา item ที่จะย้าย
                const itemToMove = allItems.find(i => i.codeProduct === code);
                if (!itemToMove) {
                    throw new Error(`ไม่พบสินค้า ${barcode} ใน ${fromShelf}/Row${fromRow}`);
                }

                const currentIndex = itemToMove.index;
                const targetIndex = Number(toIndex);

                // ถ้าตำแหน่งเดิมกับใหม่เหมือนกัน ไม่ต้องทำอะไร
                if (currentIndex === targetIndex) {
                    return;
                }

                // สร้าง array ใหม่โดยย้าย item ไปตำแหน่งใหม่
                const otherItems = allItems.filter(i => i.codeProduct !== code);

                // แทรกที่ตำแหน่ง targetIndex (0-based จะเป็น targetIndex - 1)
                const insertPosition = Math.min(targetIndex - 1, otherItems.length);
                const newOrder = [
                    ...otherItems.slice(0, insertPosition),
                    itemToMove,
                    ...otherItems.slice(insertPosition)
                ];

                // Update index ทั้งหมดตามลำดับใหม่
                const updates = newOrder.map((itm, idx) =>
                    prisma.sku.update({ where: { id: itm.id }, data: { index: idx + 1 } })
                );
                await prisma.$transaction(updates);


            } else {
                // ========== CROSS ROW/SHELF MOVE ==========
                // Step A: Remove from Source (ค้นหาด้วย codeProduct)
                const deleted = await prisma.sku.deleteMany({
                    where: { branchCode, shelfCode: fromShelf, rowNo: Number(fromRow), codeProduct: code }
                });

                if (deleted.count === 0) {
                    throw new Error(`ไม่พบสินค้า ${barcode} ใน ${fromShelf}/Row${fromRow} (อาจถูกย้ายหรือลบไปแล้ว)`);
                }

                // Re-index Source Row (1, 2, 3, ...)
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


                // Step B: INSERT to Target Row at toIndex
                // Shift items >= toIndex to the right (+1)
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

                // Insert new item at toIndex
                await prisma.sku.create({
                    data: {
                        branchCode,
                        shelfCode: toShelf,
                        rowNo: Number(toRow),
                        index: Number(toIndex),
                        codeProduct: code
                    }
                });

                // Re-index Target Row (1, 2, 3, ...)
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
 * Admin ดูรายการทั้งหมด (filter ได้, รองรับ pagination)
 */
const getAllPogRequests = async (req, res) => {
    try {
        // เพิ่ม page, shelf, row สำหรับ server-side pagination
        const { branchCode, status, action, shelf, row, limit = 50, page = 1 } = req.query;

        const where = {};
        if (branchCode) where.branchCode = branchCode;
        if (status) where.status = status;
        if (action) where.action = action;

        if (shelf || row) {
            const orConditions = [];
            const r = row ? Number(row) : undefined;

            if (shelf && row) {
                // ต้องตรงทั้ง shelf และ row ในตำแหน่ง from หรือ to
                orConditions.push({ fromShelf: shelf, fromRow: r });
                orConditions.push({ toShelf: shelf, toRow: r });
            } else if (shelf) {
                orConditions.push({ fromShelf: shelf });
                orConditions.push({ toShelf: shelf });
            } else if (row) {
                orConditions.push({ fromRow: r });
                orConditions.push({ toRow: r });
            }
            if (orConditions.length > 0) {
                where.OR = orConditions;
            }
        }

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(1000, Math.max(1, parseInt(limit) || 50));
        const skip = (pageNum - 1) * limitNum;

        // 1. Get filtered data with pagination
        const requests = await prisma.pogRequest.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limitNum,
        });

        // 2. Get total count for pagination based on current filters
        const totalFiltered = await prisma.pogRequest.count({ where });

        // 3. Get stats (counts by status) - use base filter (branch/action) but ignore status filter
        const statsWhere = {};
        if (branchCode) statsWhere.branchCode = branchCode;
        if (action) statsWhere.action = action;

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

        // 4. Get branch-level pending stats
        const branchStatsGroup = await prisma.pogRequest.groupBy({
            by: ['branchCode', 'action'],
            where: { status: 'pending' },
            _count: {
                id: true
            }
        });

        // Format branch stats: { "ST002": { add: 5, move: 2, delete: 1, total: 8 } }
        const branchStats = {};
        branchStatsGroup.forEach(g => {
            if (!branchStats[g.branchCode]) {
                branchStats[g.branchCode] = { add: 0, move: 0, delete: 0, total: 0 };
            }
            if (['add', 'move', 'delete'].includes(g.action)) {
                branchStats[g.branchCode][g.action] += g._count.id;
                branchStats[g.branchCode].total += g._count.id;
            }
        });

        return res.json({
            ok: true,
            data: requests,
            count: requests.length,
            total: totalFiltered,
            page: pageNum,
            totalPages: Math.ceil(totalFiltered / limitNum),
            stats,
            branchStats,
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

        let successCount = 0;
        let errorCount = 0;
        const errors = [];
        const affectedRows = new Set(); // เก็บ shelf/row ที่ต้อง re-index

        // ตัวแปรสำหรับคำนวณการเลื่อนของ Index (Offset Tracking)
        // key: "branchCode|shelfCode|rowNo" -> array of changes { type: 'add'|'delete', originalIndex: number }
        const rowChanges = {};

        // Helper function สำหรับคำนวณ Index ปัจจุบันที่ถูกชดเชยแล้ว
        const calculateActualIndex = (branch, shelf, row, originalIndex) => {
            const key = `${branch}|${shelf}|${row}`;
            const changes = rowChanges[key] || [];
            let actualIndex = Number(originalIndex);

            for (const change of changes) {
                if (change.type === 'add' && change.originalIndex <= originalIndex) {
                    actualIndex++;
                } else if (change.type === 'delete' && change.originalIndex < originalIndex) {
                    actualIndex--;
                }
            }
            return actualIndex;
        };

        // Helper function สำหรับบันทึกประวัติการเปลี่ยนแปลง
        const recordChange = (branch, shelf, row, type, originalIndex) => {
            const key = `${branch}|${shelf}|${row}`;
            if (!rowChanges[key]) rowChanges[key] = [];
            rowChanges[key].push({ type, originalIndex: Number(originalIndex) });
        };

        // 2. ประมวลผลทีละรายการตามลำดับเวลาเป๊ะๆ
        for (const req of requests) {
            try {
                // บันทึก original values ก่อนจะถูกแก้ไข
                const originalFromIndex = req.fromIndex;
                const originalToIndex = req.toIndex;

                if (req.action === "delete") {
                    await applyPogChange(req);
                    affectedRows.add(`${req.branchCode}|${req.fromShelf}|${req.fromRow}`);
                    recordChange(req.branchCode, req.fromShelf, req.fromRow, 'delete', originalFromIndex);
                    
                } else if (req.action === "add") {
                    // คำนวณ index ใหม่ที่ชดเชยการไหลของตำแหน่งแล้ว
                    req.toIndex = calculateActualIndex(req.branchCode, req.toShelf, req.toRow, originalToIndex);
                    await applyPogChange(req);
                    affectedRows.add(`${req.branchCode}|${req.toShelf}|${req.toRow}`);
                    recordChange(req.branchCode, req.toShelf, req.toRow, 'add', originalToIndex);
                    
                } else if (req.action === "move") {
                    // คำนวณเฉพาะ toIndex เพราะ fromIndex ระบบหลังบ้านใช้ codeProduct ในการค้นหา (แม่นยำอยู่แล้ว)
                    req.toIndex = calculateActualIndex(req.branchCode, req.toShelf, req.toRow, originalToIndex);
                    await applyPogChange(req);
                    
                    affectedRows.add(`${req.branchCode}|${req.fromShelf}|${req.fromRow}`);
                    affectedRows.add(`${req.branchCode}|${req.toShelf}|${req.toRow}`);
                    
                    recordChange(req.branchCode, req.fromShelf, req.fromRow, 'delete', originalFromIndex);
                    recordChange(req.branchCode, req.toShelf, req.toRow, 'add', originalToIndex);
                }

                // อัปเดตสถานะเมื่อสำเร็จ
                await prisma.pogRequest.update({
                    where: { id: req.id },
                    data: { status: "completed" }
                });

                successCount++;
            } catch (e) {
                errorCount++;
                errors.push(`${req.action.toUpperCase()} ${req.barcode}: ${e.message}`);
            }
        }

        // 3. (Optional) ถ้าระบบ applyPogChange ทำ Re-index อยู่แล้ว affectedRows อาจไม่จำเป็นต้องทำซ้ำ
        // แต่ถ้าต้องการชัวร์ สามารถเก็บไว้เรียกฟังก์ชัน reindexRow ได้ (ในที่นี้ applyPogChange มีการ reindex ในตัวแล้ว)

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
