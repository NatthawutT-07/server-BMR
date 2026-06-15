/**
 * Register Product Controller
 * ลงทะเบียนสินค้าโดยตรง (ไม่ผ่านระบบคำขอ)
 * 
 * Features:
 * - checkProductExists: เช็คว่าสินค้ามีใน planogram หรือยัง
 * - registerProduct: บันทึกสินค้าลง SKU table โดยตรง
 */

const prisma = require("../../config/prisma");

// ======================================================
// Check Product Exists
// เช็คว่าสินค้ามีใน planogram ของสาขานี้หรือยัง
// ======================================================
exports.checkProductExists = async (req, res) => {
    const { branch_code, barcode } = req.query;

    if (!branch_code || !barcode) {
        return res.status(400).json({
            ok: false,
            msg: "branch_code และ barcode จำเป็นต้องระบุ"
        });
    }

    try {
        // หา item_code จาก barcode
        const product = await prisma.masterItem.findFirst({
            where: { barcode: String(barcode) },
            select: {
                item_code: true,
                item_name: true,
                brand_name: true,
                barcode: true,
                selling_price_vat: true,
            }
        });

        if (!product) {
            return res.json({
                ok: true,
                found: false,
                msg: "ไม่พบสินค้าในระบบ Master"
            });
        }

        // เช็คว่ามีใน planogram ของสาขานี้หรือยัง
        const existingItem = await prisma.skuPosition.findFirst({
            where: {
                branch_code,
                item_code: product.item_code
            },
            select: {
                shelf_code: true,
                shelf_row_number: true,
                shelf_index_number: true,
            }
        });

        if (existingItem) {
            return res.json({
                ok: true,
                found: true,
                exists: true,
                product: {
                    item_code: product.item_code,
                    item_name: product.item_name,
                    brand_name: product.brand_name,
                    barcode: product.barcode,
                    price: product.selling_price_vat,
                },
                location: {
                    shelf_code: existingItem.shelf_code,
                    shelf_row_number: existingItem.shelf_row_number,
                    shelf_index_number: existingItem.shelf_index_number,
                },
                msg: `สินค้านี้มีอยู่แล้วที่ ${existingItem.shelf_code} / ชั้น ${existingItem.shelf_row_number}`
            });
        }

        // สินค้ายังไม่มีใน planogram
        return res.json({
            ok: true,
            found: true,
            exists: false,
            product: {
                item_code: product.item_code,
                item_name: product.item_name,
                brand_name: product.brand_name,
                barcode: product.barcode,
                price: product.selling_price_vat,
            },
            msg: "สินค้ายังไม่มีใน Planogram สามารถลงทะเบียนได้"
        });

    } catch (error) {
        console.error("checkProductExists error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการตรวจสอบสินค้า"
        });
    }
};

// ======================================================
// Get Shelves for BranchMain (ดึง shelf ของสาขา)
// ใช้สำหรับ dropdown เลือก shelf
// ======================================================
exports.getShelvesForRegister = async (req, res) => {
    const { branch_code } = req.query;

    if (!branch_code) {
        return res.status(400).json({
            ok: false,
            msg: "branch_code จำเป็นต้องระบุ"
        });
    }

    try {
        // ดึง shelf templates ของสาขา
        const templates = await prisma.shelfTemplate.findMany({
            where: { branch_code },
            orderBy: { shelf_code: "asc" },
            select: {
                shelf_code: true,
                shelf_name: true,
                shelf_total_row: true,
            }
        });

        const shelves = templates.map(t => ({
            shelf_code: t.shelf_code,
            shelf_name: t.shelf_name || t.shelf_code,
            shelf_total_row: t.shelf_total_row || 1,
        }));

        return res.json({
            ok: true,
            shelves
        });

    } catch (error) {
        console.error("getShelvesForRegister error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการดึงข้อมูล shelf"
        });
    }
};

// ======================================================
// Get Next Index (หา index ถัดไปของ row)
// ======================================================
exports.getNextIndex = async (req, res) => {
    const { branch_code, shelf_code, shelf_row_number } = req.query;

    if (!branch_code || !shelf_code || !shelf_row_number) {
        return res.status(400).json({
            ok: false,
            msg: "branch_code, shelf_code, shelf_row_number จำเป็นต้องระบุ"
        });
    }

    try {
        const maxIndex = await prisma.skuPosition.aggregate({
            where: {
                branch_code,
                shelf_code,
                shelf_row_number: Number(shelf_row_number)
            },
            _max: { shelf_index_number: true }
        });

        const nextIndex = (maxIndex._max.shelf_index_number || 0) + 1;

        return res.json({
            ok: true,
            nextIndex,
            currentCount: maxIndex._max.shelf_index_number || 0
        });

    } catch (error) {
        console.error("getNextIndex error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการหา index"
        });
    }
};

// ======================================================
// Register Product (บันทึกสินค้าลง DB โดยตรง)
// ======================================================
exports.registerProduct = async (req, res) => {
    const { branch_code, barcode, shelf_code, shelf_row_number } = req.body;

    if (!branch_code || !barcode || !shelf_code || !shelf_row_number) {
        return res.status(400).json({
            ok: false,
            msg: "กรุณาระบุข้อมูลให้ครบ (branch_code, barcode, shelf_code, shelf_row_number)"
        });
    }

    try {
        // 1. หา item_code จาก barcode
        const product = await prisma.masterItem.findFirst({
            where: { barcode: String(barcode) },
            select: {
                item_code: true,
                item_name: true,
            }
        });

        if (!product) {
            return res.status(404).json({
                ok: false,
                msg: "ไม่พบสินค้าในระบบ Master"
            });
        }

        // 2. เช็คว่ามีใน planogram ของสาขานี้หรือยัง
        const existingItem = await prisma.skuPosition.findFirst({
            where: {
                branch_code,
                item_code: product.item_code
            }
        });

        if (existingItem) {
            return res.status(400).json({
                ok: false,
                msg: `สินค้านี้มีอยู่แล้วที่ ${existingItem.shelf_code} / ชั้น ${existingItem.shelf_row_number}`,
                location: {
                    shelf_code: existingItem.shelf_code,
                    shelf_row_number: existingItem.shelf_row_number,
                    shelf_index_number: existingItem.shelf_index_number,
                }
            });
        }

        // 3. หา index ถัดไปของ row นี้
        const maxIndex = await prisma.skuPosition.aggregate({
            where: {
                branch_code,
                shelf_code,
                shelf_row_number: Number(shelf_row_number)
            },
            _max: { shelf_index_number: true }
        });

        const nextIndex = (maxIndex._max.shelf_index_number || 0) + 1;

        // 4. บันทึกลง SKU table
        const newSku = await prisma.skuPosition.create({
            data: {
                branch_code,
                shelf_code,
                shelf_row_number: Number(shelf_row_number),
                shelf_index_number: nextIndex,
                item_code: product.item_code,
            }
        });

        console.log(`Registered: ${product.item_name} → ${shelf_code}/${shelf_row_number}/shelf_index_number:${nextIndex}`);

        return res.json({
            ok: true,
            msg: "ลงทะเบียนสินค้าสำเร็จ",
            data: {
                id: newSku.id,
                item_code: product.item_code,
                item_name: product.item_name,
                shelf_code,
                shelf_row_number: Number(shelf_row_number),
                shelf_index_number: nextIndex,
            }
        });

    } catch (error) {
        console.error("registerProduct error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการลงทะเบียนสินค้า"
        });
    }
};
