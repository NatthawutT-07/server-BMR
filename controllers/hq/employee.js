const prisma = require("../../config/prisma");
const bcrypt = require("bcrypt");

const getAllEmployees = async (req, res) => {
  try {
    const { 
      role, 
      organizational_unit, 
      employee_code,
      search,
      limit = 10,
      offset = 0
    } = req.query;
    
    const where = {};
    if (role) where.role = role;
    if (organizational_unit) where.organizational_unit = organizational_unit;
    
    if (search) {
      where.OR = [
        { employee_code: { contains: search, mode: 'insensitive' } },
        { nickname: { contains: search, mode: 'insensitive' } }
      ];
    } else if (employee_code) {
      where.employee_code = { contains: employee_code, mode: 'insensitive' };
    }

    const [employees, total] = await Promise.all([
      prisma.employee_hq.findMany({
        where,
        select: {
          id: true,
          employee_code: true,
          nickname: true,
          position: true,
          organizational_unit: true,
          point_earned: true,
          point_redeemed: true,
          role: true,
          password: false,
        },
        orderBy: { employee_code: "asc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.employee_hq.count({ where }),
    ]);

    res.json({ 
      ok: true, 
      data: employees,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
      }
    });
  } catch (error) {
    console.error("Get employees error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await prisma.employee_hq.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true,
        employee_code: true,
        nickname: true,
        position: true,
        organizational_unit: true,
        point_earned: true,
        point_redeemed: true,
        role: true,
        password: false,
      },
    });

    if (!employee) {
      return res.status(404).json({ ok: false, message: "Employee not found" });
    }

    res.json({ ok: true, data: employee });
  } catch (error) {
    console.error("Get employee error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const getEmployeeByCode = async (req, res) => {
  try {
    const { employee_code } = req.params;
    const employee = await prisma.employee_hq.findUnique({
      where: { employee_code },
      select: {
        id: true,
        employee_code: true,
        nickname: true,
        position: true,
        organizational_unit: true,
        point_earned: true,
        point_redeemed: true,
        role: true,
        password: false,
      },
    });

    if (!employee) {
      return res.status(404).json({ ok: false, message: "Employee not found" });
    }

    res.json({ ok: true, data: employee });
  } catch (error) {
    console.error("Get employee by code error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const createEmployee = async (req, res) => {
  try {
    const { 
      employee_code, 
      nickname, 
      position, 
      organizational_unit, 
      role = "user",
      password 
    } = req.body;

    if (!employee_code || !nickname || !position || !organizational_unit) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }

    const data = {
      employee_code,
      nickname,
      position,
      organizational_unit,
      role,
      point_earned: 0,
      point_redeemed: 0,
    };

    if (role === "admin" && password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      data.password = hashedPassword;
    }

    const employee = await prisma.employee_hq.create({
      data,
      select: {
        id: true,
        employee_code: true,
        nickname: true,
        position: true,
        organizational_unit: true,
        point_earned: true,
        point_redeemed: true,
        role: true,
        password: false,
      },
    });

    res.status(201).json({ ok: true, data: employee });
  } catch (error) {
    console.error("Create employee error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Employee code already exists" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      employee_code,
      nickname, 
      position, 
      organizational_unit, 
      role,
      password,
      point_earned,
      point_redeemed
    } = req.body;

    const updateData = {};
    if (employee_code !== undefined) updateData.employee_code = employee_code;
    if (nickname !== undefined) updateData.nickname = nickname;
    if (position !== undefined) updateData.position = position;
    if (organizational_unit !== undefined) updateData.organizational_unit = organizational_unit;
    if (role !== undefined) updateData.role = role;
    if (point_earned !== undefined) updateData.point_earned = parseInt(point_earned);
    if (point_redeemed !== undefined) updateData.point_redeemed = parseInt(point_redeemed);

    if (password && role === "admin") {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    const employee = await prisma.employee_hq.update({
      where: { id: parseInt(id) },
      data: updateData,
      select: {
        id: true,
        employee_code: true,
        nickname: true,
        position: true,
        organizational_unit: true,
        point_earned: true,
        point_redeemed: true,
        role: true,
        password: false,
      },
    });

    res.json({ ok: true, data: employee });
  } catch (error) {
    console.error("Update employee error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Employee not found" });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Employee code already exists" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.employee_hq.delete({
      where: { id: parseInt(id) },
    });

    res.json({ ok: true, message: "Employee deleted successfully" });
  } catch (error) {
    console.error("Delete employee error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Employee not found" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

const getEmployeeStats = async (req, res) => {
  try {
    const { id } = req.params;
    
    const employee = await prisma.employee_hq.findUnique({
      where: { id: parseInt(id) },
      include: {
        logs: {
          orderBy: { created_at: "desc" },
          take: 10,
        },
      },
    });

    if (!employee) {
      return res.status(404).json({ ok: false, message: "Employee not found" });
    }

    const availablePoints = employee.point_earned - employee.point_redeemed;

    const salesLogs = await prisma.log_hq.count({
      where: {
        employee_code: employee.employee_code,
        action: "ยอดขาย",
      },
    });

    const rewardLogs = await prisma.log_hq.count({
      where: {
        employee_code: employee.employee_code,
        action: "แลกรางวัล",
      },
    });

    const totalSales = await prisma.log_hq.aggregate({
      where: {
        employee_code: employee.employee_code,
        action: "ยอดขาย",
      },
      _sum: {
        sales: true,
      },
    });

    res.json({ 
      ok: true, 
      data: {
        employee: {
          id: employee.id,
          employee_code: employee.employee_code,
          nickname: employee.nickname,
          position: employee.position,
          organizational_unit: employee.organizational_unit,
        },
        points: {
          earned: employee.point_earned,
          redeemed: employee.point_redeemed,
          available: availablePoints,
        },
        activity: {
          total_sales_logs: salesLogs,
          total_reward_logs: rewardLogs,
          total_sales_amount: totalSales._sum.sales || 0,
        },
        recent_logs: employee.logs,
      }
    });
  } catch (error) {
    console.error("Get employee stats error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const resetAllPoints = async (req, res) => {
  try {
    await prisma.employee_hq.updateMany({
      data: {
        point_earned: 0,
        point_redeemed: 0,
      },
    });
    res.json({ ok: true, message: "Reset all employee points successfully" });
  } catch (error) {
    console.error("Reset all points error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const bulkCreateEmployees = async (req, res) => {
  try {
    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ ok: false, message: "Invalid employees array" });
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const emp of employees) {
      try {
        const { employee_code, nickname, position, organizational_unit, role = "user", password } = emp;

        if (!employee_code || !nickname || !position || !organizational_unit) {
          results.failed.push({ employee_code, reason: "Missing required fields" });
          continue;
        }

        const data = {
          employee_code,
          nickname,
          position,
          organizational_unit,
          role,
          point_earned: 0,
          point_redeemed: 0,
        };

        if (role === "admin" && password) {
          const hashedPassword = await bcrypt.hash(password, 10);
          data.password = hashedPassword;
        }

        const created = await prisma.employee_hq.create({ data });
        results.success.push(created.employee_code);
      } catch (error) {
        results.failed.push({ 
          employee_code: emp.employee_code, 
          reason: error.code === "P2002" ? "Duplicate employee code" : error.message 
        });
      }
    }

    res.json({ 
      ok: true, 
      data: results,
      message: `Created ${results.success.length} employees, ${results.failed.length} failed`
    });
  } catch (error) {
    console.error("Bulk create employees error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

module.exports = {
  getAllEmployees,
  getEmployeeById,
  getEmployeeByCode,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeStats,
  resetAllPoints,
  bulkCreateEmployees,
};
