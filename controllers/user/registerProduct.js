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
// ✅ Check Product Exists
// เช็คว่าสินค้ามีใน planogram ของสาขานี้หรือยัง
// ======================================================
exports.checkProductExists = async (req, res) => {
    const { branchCode, barcode } = req.query;

    if (!branchCode || !barcode) {
        return res.status(400).json({
            ok: false,
            msg: "❌ branchCode และ barcode จำเป็นต้องระบุ"
        });
    }

    try {
        // หา codeProduct จาก barcode
        const product = await prisma.listOfItemHold.findFirst({
            where: { barcode: String(barcode) },
            select: {
                codeProduct: true,
                nameProduct: true,
                nameBrand: true,
                barcode: true,
                salesPriceIncVAT: true,
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
        const existingItem = await prisma.sku.findFirst({
            where: {
                branchCode,
                codeProduct: product.codeProduct
            },
            select: {
                shelfCode: true,
                rowNo: true,
                index: true,
            }
        });

        if (existingItem) {
            return res.json({
                ok: true,
                found: true,
                exists: true,
                product: {
                    codeProduct: product.codeProduct,
                    nameProduct: product.nameProduct,
                    nameBrand: product.nameBrand,
                    barcode: product.barcode,
                    price: product.salesPriceIncVAT,
                },
                location: {
                    shelfCode: existingItem.shelfCode,
                    rowNo: existingItem.rowNo,
                    index: existingItem.index,
                },
                msg: `สินค้านี้มีอยู่แล้วที่ ${existingItem.shelfCode} / ชั้น ${existingItem.rowNo}`
            });
        }

        // สินค้ายังไม่มีใน planogram
        return res.json({
            ok: true,
            found: true,
            exists: false,
            product: {
                codeProduct: product.codeProduct,
                nameProduct: product.nameProduct,
                nameBrand: product.nameBrand,
                barcode: product.barcode,
                price: product.salesPriceIncVAT,
            },
            msg: "สินค้ายังไม่มีใน Planogram สามารถลงทะเบียนได้"
        });

    } catch (error) {
        console.error("❌ checkProductExists error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการตรวจสอบสินค้า"
        });
    }
};

// ======================================================
// ✅ Get Shelves for Branch (ดึง shelf ของสาขา)
// ใช้สำหรับ dropdown เลือก shelf
// ======================================================
exports.getShelvesForRegister = async (req, res) => {
    const { branchCode } = req.query;

    if (!branchCode) {
        return res.status(400).json({
            ok: false,
            msg: "❌ branchCode จำเป็นต้องระบุ"
        });
    }

    try {
        // ดึง shelf templates ของสาขา
        const templates = await prisma.tamplate.findMany({
            where: { branchCode },
            orderBy: { shelfCode: "asc" },
            select: {
                shelfCode: true,
                fullName: true,
                rowQty: true,
            }
        });

        const shelves = templates.map(t => ({
            shelfCode: t.shelfCode,
            fullName: t.fullName || t.shelfCode,
            rowQty: t.rowQty || 1,
        }));

        return res.json({
            ok: true,
            shelves
        });

    } catch (error) {
        console.error("❌ getShelvesForRegister error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการดึงข้อมูล shelf"
        });
    }
};

// ======================================================
// ✅ Get Next Index (หา index ถัดไปของ row)
// ======================================================
exports.getNextIndex = async (req, res) => {
    const { branchCode, shelfCode, rowNo } = req.query;

    if (!branchCode || !shelfCode || !rowNo) {
        return res.status(400).json({
            ok: false,
            msg: "❌ branchCode, shelfCode, rowNo จำเป็นต้องระบุ"
        });
    }

    try {
        const maxIndex = await prisma.sku.aggregate({
            where: {
                branchCode,
                shelfCode,
                rowNo: Number(rowNo)
            },
            _max: { index: true }
        });

        const nextIndex = (maxIndex._max.index || 0) + 1;

        return res.json({
            ok: true,
            nextIndex,
            currentCount: maxIndex._max.index || 0
        });

    } catch (error) {
        console.error("❌ getNextIndex error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการหา index"
        });
    }
};

// ======================================================
// ✅ Register Product (บันทึกสินค้าลง DB โดยตรง)
// ======================================================
exports.registerProduct = async (req, res) => {
    const { branchCode, barcode, shelfCode, rowNo } = req.body;

    if (!branchCode || !barcode || !shelfCode || !rowNo) {
        return res.status(400).json({
            ok: false,
            msg: "❌ กรุณาระบุข้อมูลให้ครบ (branchCode, barcode, shelfCode, rowNo)"
        });
    }

    try {
        // 1. หา codeProduct จาก barcode
        const product = await prisma.listOfItemHold.findFirst({
            where: { barcode: String(barcode) },
            select: {
                codeProduct: true,
                nameProduct: true,
            }
        });

        if (!product) {
            return res.status(404).json({
                ok: false,
                msg: "❌ ไม่พบสินค้าในระบบ Master"
            });
        }

        // 2. เช็คว่ามีใน planogram ของสาขานี้หรือยัง
        const existingItem = await prisma.sku.findFirst({
            where: {
                branchCode,
                codeProduct: product.codeProduct
            }
        });

        if (existingItem) {
            return res.status(400).json({
                ok: false,
                msg: `❌ สินค้านี้มีอยู่แล้วที่ ${existingItem.shelfCode} / ชั้น ${existingItem.rowNo}`,
                location: {
                    shelfCode: existingItem.shelfCode,
                    rowNo: existingItem.rowNo,
                    index: existingItem.index,
                }
            });
        }

        // 3. หา index ถัดไปของ row นี้
        const maxIndex = await prisma.sku.aggregate({
            where: {
                branchCode,
                shelfCode,
                rowNo: Number(rowNo)
            },
            _max: { index: true }
        });

        const nextIndex = (maxIndex._max.index || 0) + 1;

        // 4. บันทึกลง SKU table
        const newSku = await prisma.sku.create({
            data: {
                branchCode,
                shelfCode,
                rowNo: Number(rowNo),
                index: nextIndex,
                codeProduct: product.codeProduct,
            }
        });

        console.log(`✅ Registered: ${product.nameProduct} → ${shelfCode}/${rowNo}/index:${nextIndex}`);

        return res.json({
            ok: true,
            msg: "✅ ลงทะเบียนสินค้าสำเร็จ",
            data: {
                id: newSku.id,
                codeProduct: product.codeProduct,
                nameProduct: product.nameProduct,
                shelfCode,
                rowNo: Number(rowNo),
                index: nextIndex,
            }
        });

    } catch (error) {
        console.error("❌ registerProduct error:", error);
        return res.status(500).json({
            ok: false,
            msg: "เกิดข้อผิดพลาดในการลงทะเบียนสินค้า"
        });
    }
};
