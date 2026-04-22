const prisma = require("../../config/prisma");

const getAllLogs = async (req, res) => {
  try {
    const { 
      employee_code, 
      branch_code, 
      action, 
      start_date, 
      end_date,
      limit = 100,
      offset = 0 
    } = req.query;
    
    const where = {};
    if (employee_code) where.employee_code = employee_code;
    if (branch_code) where.branch_code = branch_code;
    if (action) where.action = action;
    if (start_date || end_date) {
      where.date = {};
      if (start_date) where.date.gte = new Date(start_date);
      if (end_date) where.date.lte = new Date(end_date);
    }

    const [logs, total] = await Promise.all([
      prisma.log_hq.findMany({
        where,
        include: {
          employee: {
            select: {
              nickname: true,
              position: true,
              organizational_unit: true,
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.log_hq.count({ where }),
    ]);

    res.json({ 
      ok: true, 
      data: logs,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
      }
    });
  } catch (error) {
    console.error("Get logs error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const getLogById = async (req, res) => {
  try {
    const { id } = req.params;
    const log = await prisma.log_hq.findUnique({
      where: { id: parseInt(id) },
      include: {
        employee: {
          select: {
            nickname: true,
            position: true,
            organizational_unit: true,
          },
        },
      },
    });

    if (!log) {
      return res.status(404).json({ ok: false, message: "Log not found" });
    }

    res.json({ ok: true, data: log });
  } catch (error) {
    console.error("Get log error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const createLog = async (req, res) => {
  try {
    const { 
      employee_code,
      branch_code,
      branch_name,
      date,
      action,
      target,
      sales,
      point,
      reward
    } = req.body;

    if (!employee_code || !date || !action) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }

    if (action !== "แลกรางวัล" && (!branch_code || !branch_name)) {
      return res.status(400).json({ ok: false, message: "Branch information required for sales logs" });
    }

    const employeeExists = await prisma.employee_hq.findUnique({
      where: { employee_code },
    });

    if (!employeeExists) {
      return res.status(404).json({ ok: false, message: "Employee not found" });
    }

    // Check for existing sales log for the same employee and day (limit once per day)
    if (action === "ขาย") {
      const dateStr = date.substring(0, 10); // YYYY-MM-DD
      const todayStart = new Date(dateStr + "T00:00:00.000Z");
      const todayEnd = new Date(dateStr + "T23:59:59.999Z");

      const existingSalesLog = await prisma.log_hq.findFirst({
        where: {
          employee_code,
          action: "ขาย",
          date: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
      });

      if (existingSalesLog) {
        return res.status(400).json({ 
          ok: false, 
          message: "วันนี้คุณได้บันทึกยอดขายไปแล้ว กรุณาทำรายการใหม่ในวันพรุ่งนี้" 
        });
      }
    }

    const logData = {
      employee: {
        connect: { employee_code }
      },
      branch_code: branch_code || null,
      branch_name: branch_name || null,
      date: new Date(date.length === 10 ? date + "T00:00:00Z" : (date.length === 16 ? date + ":00Z" : date)),
      action,
      created_at: new Date(Date.now() + 7 * 60 * 60 * 1000),
    };

    if (target !== undefined && target !== null) logData.target = parseFloat(target);
    if (sales !== undefined && sales !== null) logData.sales = parseFloat(sales);
    if (point !== undefined && point !== null) logData.point = parseInt(point);
    if (reward !== undefined && reward !== null) logData.reward = reward;

    const log = await prisma.log_hq.create({
      data: logData,
      include: {
        employee: {
          select: {
            nickname: true,
            position: true,
            organizational_unit: true,
          },
        },
      },
    });

    if (action === "ยอดขาย" && point !== undefined && point !== null) {
      await prisma.employee_hq.update({
        where: { employee_code },
        data: {
          point_earned: {
            increment: parseInt(point),
          },
        },
      });
    } else if (action === "ขาย" && point !== undefined && point !== null && parseInt(point) > 0) {
      await prisma.employee_hq.update({
        where: { employee_code },
        data: {
          point_earned: {
            increment: parseInt(point),
          },
          point_redeemed: {
            increment: parseInt(point),
          },
        },
      });
    } else if (action === "แลกรางวัล" && point !== undefined && point !== null) {
      await prisma.employee_hq.update({
        where: { employee_code },
        data: {
          point_redeemed: {
            increment: parseInt(point), // Negative point will deduct from usable balance
          },
        },
      });
    }

    res.status(201).json({ ok: true, data: log });
  } catch (error) {
    console.error("Create log error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const updateLog = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      branch_code,
      branch_name,
      date,
      action,
      target,
      sales,
      point,
      reward
    } = req.body;

    const updateData = {};
    if (branch_code !== undefined) updateData.branch_code = branch_code;
    if (branch_name !== undefined) updateData.branch_name = branch_name;
    if (date !== undefined) {
      updateData.date = new Date(date.length === 10 ? date + "T00:00:00Z" : (date.length === 16 ? date + ":00Z" : date));
    }
    if (action !== undefined) updateData.action = action;
    if (target !== undefined) updateData.target = parseFloat(target);
    if (sales !== undefined) updateData.sales = parseFloat(sales);
    if (point !== undefined) updateData.point = parseInt(point);
    if (reward !== undefined) updateData.reward = reward;

    const log = await prisma.log_hq.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        employee: {
          select: {
            nickname: true,
            position: true,
            organizational_unit: true,
          },
        },
      },
    });

    res.json({ ok: true, data: log });
  } catch (error) {
    console.error("Update log error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Log not found" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

const deleteLog = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.log_hq.delete({
      where: { id: parseInt(id) },
    });

    res.json({ ok: true, message: "Log deleted successfully" });
  } catch (error) {
    console.error("Delete log error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Log not found" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

module.exports = {
  getAllLogs,
  getLogById,
  createLog,
  updateLog,
  deleteLog,
};
