const prisma = require("../../config/prisma");
const bcrypt = require("bcrypt");
const response = require("../../utils/responseHelper");
const cacheManager = require("../../utils/cacheManager");

const employeeCache = cacheManager.getCache("employees", { stdTTL: 1 });

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

    const cacheKey = `list_${JSON.stringify(req.query)}`;

    // Check cache first
    const cachedData = employeeCache.get(cacheKey);
    if (cachedData) {
      console.log(`[Cache] Serving employees from cache: ${cacheKey}`);
      return response.success(res, cachedData.employees, cachedData.meta);
    }

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
          status: true,
        },
        orderBy: { employee_code: "asc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.employee_hq.count({ where }),
    ]);

    const meta = {
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    employeeCache.set(cacheKey, { employees, meta });

    return response.success(res, employees, meta);
  } catch (error) {
    console.error("Get employees error:", error);
    return response.error(res, "ไม่สามารถดึงข้อมูลพนักงานได้", "FETCH_ERROR", 500, error.message);
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
        status: true,
      },
    });

    if (!employee) {
      return response.error(res, "ไม่พบข้อมูลพนักงาน", "NOT_FOUND", 404);
    }

    return response.success(res, employee);
  } catch (error) {
    console.error("Get employee error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการดึงข้อมูล", "FETCH_ERROR", 500, error.message);
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
        status: true,
      },
    });

    if (!employee) {
      return response.error(res, "ไม่พบข้อมูลพนักงาน", "NOT_FOUND", 404);
    }

    return response.success(res, employee);
  } catch (error) {
    console.error("Get employee by code error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการดึงข้อมูล", "FETCH_ERROR", 500, error.message);
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
      return response.error(res, "กรุณากรอกข้อมูลให้ครบถ้วน", "BAD_REQUEST", 400);
    }

    const data = {
      employee_code,
      nickname,
      position,
      organizational_unit,
      role,
      status: "active",
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
        status: true,
      },
    });

    // Clear cache
    employeeCache.flushAll();

    return response.success(res, employee, null, "เพิ่มพนักงานสำเร็จ", 201);
  } catch (error) {
    console.error("Create employee error:", error);
    if (error.code === "P2002") {
      return response.error(res, "รหัสพนักงานนี้มีอยู่ในระบบแล้ว", "CONFLICT", 409);
    }
    return response.error(res, "ไม่สามารถสร้างพนักงานได้", "CREATE_ERROR", 500, error.message);
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
      point_redeemed,
      status
    } = req.body;

    const updateData = {};
    if (employee_code !== undefined) updateData.employee_code = employee_code;
    if (nickname !== undefined) updateData.nickname = nickname;
    if (position !== undefined) updateData.position = position;
    if (organizational_unit !== undefined) updateData.organizational_unit = organizational_unit;
    if (role !== undefined) updateData.role = role;
    if (point_earned !== undefined) updateData.point_earned = parseInt(point_earned);
    if (point_redeemed !== undefined) updateData.point_redeemed = parseInt(point_redeemed);
    if (status !== undefined) updateData.status = status;

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
        status: true,
      },
    });

    // Clear cache
    employeeCache.flushAll();

    return response.success(res, employee, null, "อัปเดตข้อมูลพนักงานสำเร็จ");
  } catch (error) {
    console.error("Update employee error:", error);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลพนักงาน", "NOT_FOUND", 404);
    }
    if (error.code === "P2002") {
      return response.error(res, "รหัสพนักงานนี้มีอยู่ในระบบแล้ว", "CONFLICT", 409);
    }
    return response.error(res, "ไม่สามารถอัปเดตข้อมูลได้", "UPDATE_ERROR", 500, error.message);
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee_hq.findUnique({
      where: { id: parseInt(id) },
      select: { employee_code: true, nickname: true },
    });

    if (!employee) {
      return response.error(res, "ไม่พบข้อมูลพนักงานที่ต้องการลบ", "NOT_FOUND", 404);
    }

    const [deletedLogs] = await prisma.$transaction([
      prisma.log_hq.deleteMany({
        where: { employee_code: employee.employee_code },
      }),
      prisma.employee_hq.delete({
        where: { id: parseInt(id) },
      }),
    ]);

    console.log(`Deleted employee ${employee.employee_code} (${employee.nickname}) with ${deletedLogs.count} related logs`);

    // Clear cache
    employeeCache.flushAll();

    return response.success(res, null, null, `ลบพนักงานสำเร็จ (ลบ log ที่เกี่ยวข้อง ${deletedLogs.count} รายการ)`);
  } catch (error) {
    console.error("Delete employee error:", error);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลพนักงานที่ต้องการลบ", "NOT_FOUND", 404);
    }
    return response.error(res, "ไม่สามารถลบข้อมูลได้", "DELETE_ERROR", 500, error.message);
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
      return response.error(res, "ไม่พบข้อมูลพนักงาน", "NOT_FOUND", 404);
    }

    const availablePoints = employee.point_earned - employee.point_redeemed;

    const salesLogsCount = await prisma.log_hq.count({
      where: {
        employee_code: employee.employee_code,
        action: "ยอดขาย",
      },
    });

    const rewardLogsCount = await prisma.log_hq.count({
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

    const stats = {
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
        total_sales_logs: salesLogsCount,
        total_reward_logs: rewardLogsCount,
        total_sales_amount: totalSales._sum.sales || 0,
      },
      recent_logs: employee.logs,
    };

    return response.success(res, stats);
  } catch (error) {
    console.error("Get employee stats error:", error);
    return response.error(res, "ไม่สามารถดึงข้อมูลสถิติได้", "FETCH_ERROR", 500, error.message);
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
    // Clear cache
    employeeCache.flushAll();

    return response.success(res, null, null, "ล้างแต้มพนักงานทุกคนสำเร็จ");
  } catch (error) {
    console.error("Reset all points error:", error);
    return response.error(res, "ไม่สามารถล้างแต้มได้", "RESET_ERROR", 500, error.message);
  }
};

const bulkCreateEmployees = async (req, res) => {
  try {
    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return response.error(res, "ข้อมูลพนักงานไม่ถูกต้อง", "BAD_REQUEST", 400);
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const emp of employees) {
      try {
        const { employee_code, nickname, position, organizational_unit, role = "user", password } = emp;

        if (!employee_code || !nickname || !position || !organizational_unit) {
          results.failed.push({ employee_code, reason: "ข้อมูลไม่ครบถ้วน" });
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
          reason: error.code === "P2002" ? "รหัสพนักงานซ้ำ" : error.message
        });
      }
    }

    return response.success(res, results, null, `สร้างพนักงานสำเร็จ ${results.success.length} รายการ, ล้มเหลว ${results.failed.length} รายการ`);
  } catch (error) {
    console.error("Bulk create employees error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการสร้างข้อมูลแบบกลุ่ม", "BULK_ERROR", 500, error.message);
  }
};

const bulkAddPoints = async (req, res) => {
  try {
    const { employee_hits } = req.body;

    if (!employee_hits || typeof employee_hits !== 'object') {
      return response.error(res, "ข้อมูลไม่ถูกต้อง", "BAD_REQUEST", 400);
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const [employee_code, hits] of Object.entries(employee_hits)) {
      try {
        const addedPoints = parseInt(hits);
        if (isNaN(addedPoints) || addedPoints <= 0) continue;

        const updated = await prisma.employee_hq.update({
          where: { employee_code },
          data: {
            point_earned: { increment: addedPoints },
            point_redeemed: { increment: addedPoints }
          },
          select: {
            employee_code: true,
            nickname: true
          }
        });

        results.success.push({
          employee_code: updated.employee_code,
          nickname: updated.nickname,
          addedPoints
        });
      } catch (error) {
        results.failed.push({
          employee_code,
          reason: error.code === "P2025" ? "ไม่พบรหัสพนักงานในระบบ" : error.message
        });
      }
    }

    employeeCache.flushAll();

    return response.success(res, results, null, `บันทึกคะแนนสำเร็จ ${results.success.length} รายการ`);
  } catch (error) {
    console.error("Bulk add points error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการบันทึกคะแนน", "BULK_ERROR", 500, error.message);
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
  bulkAddPoints,
};
