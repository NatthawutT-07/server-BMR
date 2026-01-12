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
            branchCode,
            action,
            barcode,
            productName,
            fromShelf,
            fromRow,
            fromIndex,
            toShelf,
            toRow,
            toIndex,
            swapBarcode,
            swapProductName,
            note,
        } = req.body;

        // Validate required fields
        if (!branchCode || !action || !barcode) {
            return res.status(400).json({
                ok: false,
                message: "กรุณาระบุ branchCode, action และ barcode",
            });
        }

        // Validate action type
        if (!["add", "swap", "delete", "move"].includes(action)) {
            return res.status(400).json({
                ok: false,
                message: "action ต้องเป็น add, swap, delete หรือ move",
            });
        }

        // Check Pending Duplicate
        const existing = await prisma.pogRequest.findFirst({
            where: {
                branchCode,
                barcode,
                status: "pending"
            }
        });

        if (existing) {
            return res.status(400).json({
                ok: false,
                message: "มีคำขอนี้อยู่ระหว่างดำเนินการ กรุณาลบคำขอเดิมก่อนหากต้องการส่งใหม่"
            });
        }

        const request = await prisma.pogRequest.create({
            data: {
                branchCode,
                action,
                barcode,
                productName: productName || null,
                fromShelf: fromShelf || null,
                fromRow: fromRow ? Number(fromRow) : null,
                fromIndex: fromIndex ? Number(fromIndex) : null,
                toShelf: toShelf || null,
                toRow: toRow ? Number(toRow) : null,
                toIndex: toIndex ? Number(toIndex) : null,
                swapBarcode: swapBarcode || null,
                swapProductName: swapProductName || null,
                note: note || null,
                status: "pending",
            },
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
 * GET /api/pog-request?branchCode=xxx
 * User ดู history ของสาขาตัวเอง
 */
const getMyPogRequests = async (req, res) => {
    try {
        const { branchCode } = req.query;

        if (!branchCode) {
            return res.status(400).json({
                ok: false,
                message: "กรุณาระบุ branchCode",
            });
        }

        const requests = await prisma.pogRequest.findMany({
            where: { branchCode },
            orderBy: { createdAt: "desc" },
            take: 100, // limit
        });

        return res.json({
            ok: true,
            data: requests,
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

        // ✅ เปลี่ยนสถานะเป็น cancelled แทนการลบ
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
