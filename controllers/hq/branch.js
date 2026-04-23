const prisma = require("../../config/prisma");

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

    res.json({ ok: true, data: branches });
  } catch (error) {
    console.error("Get branches error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const getBranchById = async (req, res) => {
  try {
    const { id } = req.params;
    const branch = await prisma.branch_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!branch) {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }

    res.json({ ok: true, data: branch });
  } catch (error) {
    console.error("Get branch error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const createBranch = async (req, res) => {
  try {
    const { branch_code, branch_name, month, day, target, status = "active" } = req.body;

    if (!branch_code || !branch_name || month === undefined || day === undefined || target === undefined) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }

    const dayNum = parseInt(day);
    const targetNum = parseFloat(target);
    const avg_target = dayNum > 0 ? parseFloat((targetNum / dayNum).toFixed(2)) : 0;

    const branch = await prisma.branch_hq.create({
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

    res.status(201).json({ ok: true, data: branch });
  } catch (error) {
    console.error("Create branch error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Branch with this code and month already exists" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

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

    const branch = await prisma.branch_hq.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    res.json({ ok: true, data: branch });
  } catch (error) {
    console.error("Update branch error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Branch with this code and month already exists" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

const deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.branch_hq.delete({
      where: { id: parseInt(id) },
    });

    res.json({ ok: true, message: "Branch deleted successfully" });
  } catch (error) {
    console.error("Delete branch error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Branch not found" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

module.exports = {
  getAllBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deleteBranch,
};
