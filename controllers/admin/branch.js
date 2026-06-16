const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");

exports.listBranches = async (req, res) => {
  try {
    const branches = await prisma.branchMain.findMany({
      orderBy: { branch_code: "asc" },
    });
    return response.success(res, branches);
  } catch (error) {
    console.error("List Branches Error:", error);
    return response.error(res, "Server Error");
  }
};

exports.createBranch = async (req, res) => {
  try {
    const { branch_code, branch_name } = req.body;
    
    if (!branch_code || !branch_name) {
      return response.error(res, "BranchMain code and name are required", "BAD_REQUEST", 400);
    }

    const existing = await prisma.branchMain.findUnique({
      where: { branch_code },
    });

    if (existing) {
      return response.error(res, "BranchMain code already exists", "CONFLICT", 400);
    }

    const branchMain = await prisma.branchMain.create({
      data: { branch_code, branch_name },
    });

    return response.success(res, branchMain, null, "BranchMain created", 201);
  } catch (error) {
    console.error("Create BranchMain Error:", error);
    return response.error(res, "Server Error");
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_code, branch_name } = req.body;

    const branchId = Number(id);
    if (isNaN(branchId)) return response.error(res, "Invalid ID", "BAD_REQUEST", 400);

    // Check if branch_code exists in another record
    if (branch_code) {
      const existing = await prisma.branchMain.findUnique({
        where: { branch_code },
      });
      if (existing && existing.id !== branchId) {
        return response.error(res, "BranchMain code already exists", "CONFLICT", 400);
      }
    }

    const updatedBranch = await prisma.branchMain.update({
      where: { id: branchId },
      data: { branch_code, branch_name },
    });

    return response.success(res, updatedBranch);
  } catch (error) {
    console.error("Update BranchMain Error:", error);
    return response.error(res, "Server Error");
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const branchId = Number(id);
    
    if (isNaN(branchId)) return response.error(res, "Invalid ID", "BAD_REQUEST", 400);

    const branchMain = await prisma.branchMain.findUnique({
      where: { id: branchId },
      select: { id: true, branch_code: true, branch_name: true },
    });

    if (!branchMain) {
      return response.error(res, "BranchMain not found", "NOT_FOUND", 404);
    }

    const billCount = await prisma.billHeader.count({
      where: { branchId },
    });

    if (billCount > 0) {
      return response.error(
        res,
        `Cannot delete branch ${branchMain.branch_code} because it has ${billCount} bill record${billCount === 1 ? "" : "s"}.`,
        "BRANCH_HAS_BILLS",
        409,
        { branch: branchMain, billCount }
      );
    }

    await prisma.branchMain.delete({
      where: { id: branchId },
    });

    return response.success(res, null, null, "BranchMain deleted successfully");
  } catch (error) {
    console.error("Delete BranchMain Error:", error);
    if (error.code === "P2003" || error.code === "P2014") {
      return response.error(res, "Cannot delete branchMain because it is referenced by other records.", "BRANCH_HAS_REFERENCES", 409);
    }
    if (error.code === "P2025") {
      return response.error(res, "BranchMain not found", "NOT_FOUND", 404);
    }
    return response.error(res, "Server Error");
  }
};
