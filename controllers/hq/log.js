const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");

/**
 * GET /api/hq/logs
 */
const getAllLogs = async (req, res) => {
  try {
    const {
      employee_code,
      branch_code,
      action,
      start_date,
      end_date,
      search,
      limit = 100,
      offset = 0
    } = req.query;

    const where = {};
    if (employee_code) where.employee_code = employee_code;
    if (branch_code) where.branch_code = branch_code;
    if (action) where.action = action;
    if (search) {
      where.employee_code = { contains: search, mode: 'insensitive' };
    }
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

    return response.success(res, logs, {
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error("Get logs error:", error);
    return response.error(res, "ไม่สามารถดึงข้อมูลบันทึกกิจกรรมได้", "FETCH_ERROR", 500, error.message);
  }
};

/**
 * GET /api/hq/logs/:id
 */
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
      return response.error(res, "ไม่พบข้อมูลบันทึกกิจกรรม", "NOT_FOUND", 404);
    }

    return response.success(res, log);
  } catch (error) {
    console.error("Get log error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการดึงข้อมูล", "FETCH_ERROR", 500, error.message);
  }
};

/**
 * POST /api/hq/logs
 */
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
      return response.error(res, "กรุณากรอกข้อมูลให้ครบถ้วน", "BAD_REQUEST", 400);
    }

    if (action !== "แลกรางวัล" && action !== "หักคะแนน" && (!branch_code || !branch_name)) {
      return response.error(res, "กรุณาระบุข้อมูลสาขา", "BAD_REQUEST", 400);
    }

    const employeeExists = await prisma.employee_hq.findUnique({
      where: { employee_code },
    });

    if (!employeeExists) {
      return response.error(res, "ไม่พบข้อมูลพนักงาน", "NOT_FOUND", 404);
    }

    // Check for existing sales log for the same employee and day (limit once per day)
    if (action === "ขาย") {
      const dateStr = date.substring(0, 10); // YYYY-MM-DD
      const todayStart = new Date(dateStr + "T00:00:00.000+07:00");
      const todayEnd = new Date(dateStr + "T23:59:59.999+07:00");

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
        return response.error(res, "วันนี้คุณได้บันทึกยอดขายไปแล้ว กรุณาทำรายการใหม่ในวันพรุ่งนี้", "DUPLICATE_ENTRY", 400);
      }
    }

    const logData = {
      employee: {
        connect: { employee_code }
      },
      branch_code: branch_code || null,
      branch_name: branch_name || null,
      date: new Date(date.length === 10 ? date + "T00:00:00+07:00" : (date.length === 16 ? date + ":00+07:00" : date)),
      action,
      created_at: new Date(),
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

    // Update employee points
    if (action === "ยอดขาย" && point !== undefined && point !== null) {
      await prisma.employee_hq.update({
        where: { employee_code },
        data: { point_earned: { increment: parseInt(point) } },
      });
    } else if (action === "ขาย" && point !== undefined && point !== null && parseInt(point) > 0) {
      await prisma.employee_hq.update({
        where: { employee_code },
        data: {
          point_earned: { increment: parseInt(point) },
          point_redeemed: { increment: parseInt(point) },
        },
      });
    } else if (action === "แลกรางวัล" && point !== undefined && point !== null) {
      await prisma.employee_hq.update({
        where: { employee_code },
        data: { point_redeemed: { increment: parseInt(point) } },
      });
    }

    return response.success(res, log, null, "บันทึกข้อมูลสำเร็จ", 201);
  } catch (error) {
    console.error("Create log error:", error);
    return response.error(res, "ไม่สามารถบันทึกข้อมูลได้", "CREATE_ERROR", 500, error.message);
  }
};

/**
 * PUT /api/hq/logs/:id
 */
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
      updateData.date = new Date(date.length === 10 ? date + "T00:00:00+07:00" : (date.length === 16 ? date + ":00+07:00" : date));
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

    return response.success(res, log, null, "อัปเดตข้อมูลสำเร็จ");
  } catch (error) {
    console.error("Update log error:", error);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลที่ต้องการอัปเดต", "NOT_FOUND", 404);
    }
    return response.error(res, "ไม่สามารถอัปเดตข้อมูลได้", "UPDATE_ERROR", 500, error.message);
  }
};

/**
 * DELETE /api/hq/logs/:id
 */
const deleteLog = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.log_hq.delete({
      where: { id: parseInt(id) },
    });

    return response.success(res, null, null, "ลบข้อมูลสำเร็จ");
  } catch (error) {
    console.error("Delete log error:", error);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลที่ต้องการลบ", "NOT_FOUND", 404);
    }
    return response.error(res, "ไม่สามารถลบข้อมูลได้", "DELETE_ERROR", 500, error.message);
  }
};

module.exports = {
  getAllLogs,
  getLogById,
  createLog,
  updateLog,
  deleteLog,
};
