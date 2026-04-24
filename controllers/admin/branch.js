const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");

exports.listBranches = async (req, res) => {
  try {
    const branches = await prisma.branch.findMany({
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
      return response.error(res, "Branch code and name are required", "BAD_REQUEST", 400);
    }

    const existing = await prisma.branch.findUnique({
      where: { branch_code },
    });

    if (existing) {
      return response.error(res, "Branch code already exists", "CONFLICT", 400);
    }

    const branch = await prisma.branch.create({
      data: { branch_code, branch_name },
    });

    return response.success(res, branch, null, "Branch created", 201);
  } catch (error) {
    console.error("Create Branch Error:", error);
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
      const existing = await prisma.branch.findUnique({
        where: { branch_code },
      });
      if (existing && existing.id !== branchId) {
        return response.error(res, "Branch code already exists", "CONFLICT", 400);
      }
    }

    const updatedBranch = await prisma.branch.update({
      where: { id: branchId },
      data: { branch_code, branch_name },
    });

    return response.success(res, updatedBranch);
  } catch (error) {
    console.error("Update Branch Error:", error);
    return response.error(res, "Server Error");
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const branchId = Number(id);
    
    if (isNaN(branchId)) return response.error(res, "Invalid ID", "BAD_REQUEST", 400);

    await prisma.branch.delete({
      where: { id: branchId },
    });

    return response.success(res, null, null, "Branch deleted successfully");
  } catch (error) {
    console.error("Delete Branch Error:", error);
    if (error.code === "P2003" || error.code === "P2014" || error.code === "P2025") {
      return response.error(res, "Cannot delete branch because it is referenced by other records.", "BAD_REQUEST", 400);
    }
    return response.error(res, "Server Error");
  }
};
