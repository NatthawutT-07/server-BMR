// controllers/user/pogRequest.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * POST /api/pog-request
 * User สร้าง request ใหม่
 */
const createPogRequest = async (req, res) => {
    try {
        const {
            branch_code,
            action,
            barcode,
            item_name,
            fromShelf,
            fromRow,
            fromIndex,
            toShelf,
            toRow,
            toIndex,
            swap_barcode,
            swap_item_name,
            note,
        } = req.body;

        // Validate required fields
        if (!branch_code || !action || !barcode) {
            return res.status(400).json({
                ok: false,
                message: "กรุณาระบุ branch_code, action และ barcode",
            });
        }

        // Validate action type
        if (!["add", "swap", "delete", "move"].includes(action)) {
            return res.status(400).json({
                ok: false,
                message: "action ต้องเป็น add, swap, delete หรือ move",
            });
        }

        // ใช้ Transaction เพื่อป้องกัน Race Condition (2 tabs ส่งพร้อมกัน)
        const request = await prisma.$transaction(async (tx) => {
            // Check Pending Duplicate ใน transaction
            const existing = await tx.pogRequest.findFirst({
                where: {
                    branch_code,
                    barcode,
                    status: "pending"
                }
            });

            if (existing) {
                throw new Error("มีคำขอนี้อยู่ระหว่างดำเนินการ กรุณาลบคำขอเดิมก่อนหากต้องการส่งใหม่");
            }

            // ป้องกันปัญหาแย่งตำแหน่งกัน (Concurrency Isuues)
            // ถ้ามีคนจอง index นี้ไปแล้ว ให้เลื่อนลำดับไปต่อท้าย (เช่น จาก 5 เป็น 6)
            let finalToIndex = toIndex ? Number(toIndex) : null;

            if (finalToIndex !== null && (action === "add" || action === "move")) {
                const pendingSameRow = await tx.pogRequest.findMany({
                    where: {
                        branch_code,
                        toShelf: toShelf || "",
                        toRow: toRow ? Number(toRow) : 0,
                        status: "pending",
                        action: { in: ["add", "move"] }
                    },
                    orderBy: { toIndex: "asc" }
                });

                // ตรวจสอบและดัน index ขึ้นทีละ 1 หากมีคนขอตำแหน่งนี้หรือก่อนหน้านี้ไปแล้ว
                for (const pending of pendingSameRow) {
                    if (pending.toIndex <= finalToIndex) {
                        finalToIndex++;
                    }
                }
            }

            // Create ใน transaction เดียวกัน
            return await tx.pogRequest.create({
                data: {
                    branch_code,
                    action,
                    barcode,
                    item_name: item_name || null,
                    fromShelf: fromShelf || null,
                    fromRow: fromRow ? Number(fromRow) : null,
                    fromIndex: fromIndex ? Number(fromIndex) : null,
                    toShelf: toShelf || null,
                    toRow: toRow ? Number(toRow) : null,
                    toIndex: finalToIndex, // ใช้ index ที่อาจถูกปรับแก้แล้ว
                    swap_barcode: swap_barcode || null,
                    swap_item_name: swap_item_name || null,
                    note: note || null,
                    status: "pending",
                },
            });
        });

        return res.status(201).json({
            ok: true,
            message: "สร้างคำขอสำเร็จ",
            data: request,
        });
    } catch (error) {
        console.error("createPogRequest error:", error);
        return res.status(500).json({
            ok: false,
            message: "เกิดข้อผิดพลาดในการสร้างคำขอ",
        });
    }
};

/**
 * GET /api/pog-request?branch_code=xxx&page=1&limit=20
 * User ดู history ของสาขาตัวเอง (รองรับ Pagination)
 */
const getMyPogRequests = async (req, res) => {
    try {
        const { branch_code, page = 1, limit = 20 } = req.query;

        if (!branch_code) {
            return res.status(400).json({
                ok: false,
                message: "กรุณาระบุ branch_code",
            });
        }

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20)); // Max 100
        const skip = (pageNum - 1) * limitNum;

        // Get total count for pagination
        const total = await prisma.pogRequest.count({
            where: { branch_code },
        });

        const requests = await prisma.pogRequest.findMany({
            where: { branch_code },
            orderBy: { createdAt: "desc" },
            skip,
            take: limitNum,
        });

        return res.json({
            ok: true,
            data: requests,
            pagination: {
                page: pageNum,
                limit: limitNum,
                count: requests.length,
                total, // จำนวนรวมทั้งหมด
            }
        });
    } catch (error) {
        console.error("getMyPogRequests error:", error);
        return res.status(500).json({
            ok: false,
            message: "เกิดข้อผิดพลาดในการดึงข้อมูล",
        });
    }
};

/**
 * PATCH /api/pog-request/:id/cancel
 * User ยกเลิก request ตัวเอง (เฉพาะ pending) - ไม่ลบจริง เปลี่ยนสถานะเป็น cancelled
 */
const cancelMyPogRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const request = await prisma.pogRequest.findUnique({
            where: { id: Number(id) }
        });

        if (!request) {
            return res.status(404).json({ ok: false, message: "ไม่พบรายการ" });
        }

        if (request.status !== "pending") {
            return res.status(400).json({ ok: false, message: "ยกเลิกได้เฉพาะรายการที่รอดำเนินการเท่านั้น" });
        }

        // เปลี่ยนสถานะเป็น cancelled แทนการลบ
        await prisma.pogRequest.update({
            where: { id: Number(id) },
            data: { status: "cancelled" }
        });

        return res.json({ ok: true, message: "ยกเลิกคำขอสำเร็จ" });

    } catch (error) {
        console.error("cancelMyPogRequest error:", error);
        return res.status(500).json({ ok: false, message: "เกิดข้อผิดพลาดในการยกเลิก" });
    }
};

module.exports = {
    createPogRequest,
    getMyPogRequests,
    cancelMyPogRequest,
};
