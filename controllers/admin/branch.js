const prisma = require("../../config/prisma");

exports.listBranches = async (req, res) => {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { branch_code: "asc" },
    });
    res.json(branches);
  } catch (error) {
    console.error("List Branches Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const { branch_code, branch_name } = req.body;
    
    if (!branch_code || !branch_name) {
      return res.status(400).json({ message: "Branch code and name are required" });
    }

    const existing = await prisma.branch.findUnique({
      where: { branch_code },
    });

    if (existing) {
      return res.status(400).json({ message: "Branch code already exists" });
    }

    const branch = await prisma.branch.create({
      data: { branch_code, branch_name },
    });

    res.status(201).json(branch);
  } catch (error) {
    console.error("Create Branch Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_code, branch_name } = req.body;

    const branchId = Number(id);
    if (isNaN(branchId)) return res.status(400).json({ message: "Invalid ID" });

    // Check if branch_code exists in another record
    if (branch_code) {
      const existing = await prisma.branch.findUnique({
        where: { branch_code },
      });
      if (existing && existing.id !== branchId) {
        return res.status(400).json({ message: "Branch code already exists" });
      }
    }

    const updatedBranch = await prisma.branch.update({
      where: { id: branchId },
      data: { branch_code, branch_name },
    });

    res.json(updatedBranch);
  } catch (error) {
    console.error("Update Branch Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const branchId = Number(id);
    
    if (isNaN(branchId)) return res.status(400).json({ message: "Invalid ID" });

    await prisma.branch.delete({
      where: { id: branchId },
    });

    res.json({ message: "Branch deleted successfully" });
  } catch (error) {
    console.error("Delete Branch Error:", error);
    if (error.code === "P2003" || error.code === "P2014" || error.code === "P2025") {
      return res.status(400).json({ message: "Cannot delete branch because it is referenced by other records." });
    }
    res.status(500).json({ message: "Server Error" });
  }
};
