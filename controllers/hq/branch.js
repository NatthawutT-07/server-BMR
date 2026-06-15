const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");

/**
 * GET /api/hq/branches
 */
const getAllBranches = async (req, res) => {
  try {
    const { month, branch_code } = req.query;
    
    const where = {};
    if (month) where.month = parseInt(month);
    if (branch_code) where.branch_code = branch_code;

    const branches = await prisma.branch_hq.findMany({
      where,
      orderBy: [{ branch_code: "asc" }, { month: "asc" }],
    });

    return response.success(res, branches);
  } catch (error) {
    console.error("Get branches error:", error);
    return response.error(res, "ไม่สามารถดึงข้อมูลสาขาได้", "FETCH_ERROR", 500, error.message);
  }
};

/**
 * GET /api/hq/branches/:id
 */
const getBranchById = async (req, res) => {
  try {
    const { id } = req.params;
    const branchMain = await prisma.branch_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!branchMain) {
      return response.error(res, "ไม่พบข้อมูลสาขา", "NOT_FOUND", 404);
    }

    return response.success(res, branchMain);
  } catch (error) {
    console.error("Get branchMain error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการดึงข้อมูล", "FETCH_ERROR", 500, error.message);
  }
};

/**
 * POST /api/hq/branches
 */
const createBranch = async (req, res) => {
  try {
    const { branch_code, branch_name, month, day, target, status = "active" } = req.body;

    if (!branch_code || !branch_name || month === undefined || day === undefined || target === undefined) {
      return response.error(res, "กรุณากรอกข้อมูลให้ครบถ้วน", "BAD_REQUEST", 400);
    }

    const dayNum = parseInt(day);
    const targetNum = parseFloat(target);
    const avg_target = dayNum > 0 ? parseFloat((targetNum / dayNum).toFixed(2)) : 0;

    const branchMain = await prisma.branch_hq.create({
      data: {
        branch_code,
        branch_name,
        month: parseInt(month),
        day: dayNum,
        target: targetNum,
        avg_target: avg_target,
        status,
      },
    });

    return response.success(res, branchMain, null, "เพิ่มสาขาสำเร็จ", 201);
  } catch (error) {
    console.error("Create branchMain error:", error);
    if (error.code === "P2002") {
      return response.error(res, "สาขานี้ในเดือนที่ระบุมีอยู่ในระบบแล้ว", "CONFLICT", 409);
    }
    return response.error(res, "ไม่สามารถสร้างข้อมูลสาขาได้", "CREATE_ERROR", 500, error.message);
  }
};

/**
 * PUT /api/hq/branches/:id
 */
const updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_code, branch_name, month, day, target, status } = req.body;

    const updateData = {};
    if (branch_code !== undefined) updateData.branch_code = branch_code;
    if (branch_name !== undefined) updateData.branch_name = branch_name;
    if (month !== undefined) updateData.month = parseInt(month);
    if (day !== undefined) updateData.day = parseInt(day);
    if (target !== undefined) updateData.target = parseFloat(target);
    if (status !== undefined) updateData.status = status;

    if (day !== undefined && target !== undefined) {
      const dayNum = parseInt(day);
      const targetNum = parseFloat(target);
      updateData.avg_target = dayNum > 0 ? parseFloat((targetNum / dayNum).toFixed(2)) : 0;
    } else if (day !== undefined || target !== undefined) {
      const currentBranch = await prisma.branch_hq.findUnique({
        where: { id: parseInt(id) }
      });
      const dayNum = day !== undefined ? parseInt(day) : currentBranch.day;
      const targetNum = target !== undefined ? parseFloat(target) : currentBranch.target;
      updateData.avg_target = dayNum > 0 ? parseFloat((targetNum / dayNum).toFixed(2)) : 0;
    }

    const branchMain = await prisma.branch_hq.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    return response.success(res, branchMain, null, "อัปเดตข้อมูลสาขาสำเร็จ");
  } catch (error) {
    console.error("Update branchMain error:", error);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลสาขา", "NOT_FOUND", 404);
    }
    if (error.code === "P2002") {
      return response.error(res, "สาขานี้ในเดือนที่ระบุมีอยู่ในระบบแล้ว", "CONFLICT", 409);
    }
    return response.error(res, "ไม่สามารถอัปเดตข้อมูลได้", "UPDATE_ERROR", 500, error.message);
  }
};

/**
 * DELETE /api/hq/branches/:id
 */
const deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.branch_hq.delete({
      where: { id: parseInt(id) },
    });

    return response.success(res, null, null, "ลบสาขาสำเร็จ");
  } catch (error) {
    console.error("Delete branchMain error:", error);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลสาขาที่ต้องการลบ", "NOT_FOUND", 404);
    }
    return response.error(res, "ไม่สามารถลบข้อมูลได้", "DELETE_ERROR", 500, error.message);
  }
};

module.exports = {
  getAllBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deleteBranch,
};
