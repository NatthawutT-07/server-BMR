const prisma = require("../../config/prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const response = require("../../utils/responseHelper");

/**
 * POST /api/hq/auth/register
 */
exports.register = async (req, res) => {
  try {
    const { employee_code, nickname, position, organizational_unit, password, role } = req.body;

    const existingEmployee = await prisma.employee_hq.findUnique({
      where: { employee_code },
    });

    if (existingEmployee) {
      return response.error(res, "รหัสพนักงานนี้มีอยู่ในระบบแล้ว", "CONFLICT", 400);
    }

    let hashedPassword = null;
    if (role === "admin" && password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const employee = await prisma.employee_hq.create({
      data: {
        employee_code,
        nickname,
        position,
        organizational_unit,
        role: role || "user",
        password: hashedPassword,
      },
    });

    const { password: _, ...employeeData } = employee;

    return response.success(res, employeeData, null, "ลงทะเบียนสำเร็จ", 201);
  } catch (error) {
    console.error("Register error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการลงทะเบียน", "REGISTER_ERROR");
  }
};

/**
 * POST /api/hq/auth/login
 */
exports.login = async (req, res) => {
  try {
    const { employee_code, password } = req.body;

    const employee = await prisma.employee_hq.findUnique({
      where: { employee_code },
    });

    if (!employee) {
      return response.error(res, "ไม่พบรหัสพนักงานในระบบ", "UNAUTHORIZED", 401);
    }

    if (employee.status === 'inactive') {
      return response.error(res, "รหัสพนักงานนี้ถูกระงับการใช้งาน", "FORBIDDEN", 401);
    }

    if (employee.role !== "admin") {
      return response.error(res, "ระบบนี้สงวนสิทธิ์การเข้าใช้งานเฉพาะ Admin เท่านั้น", "FORBIDDEN", 401);
    }

    if (!password) {
      return response.error(res, "กรุณากรอกรหัสผ่าน", "BAD_REQUEST", 401);
    }

    const isPasswordValid = await bcrypt.compare(password, employee.password);
    if (!isPasswordValid) {
      return response.error(res, "รหัสผ่านไม่ถูกต้อง", "UNAUTHORIZED", 401);
    }

    const token = jwt.sign(
      {
        id: employee.id,
        employee_code: employee.employee_code,
        role: employee.role,
      },
      process.env.SECRET,
      { expiresIn: "7d" }
    );

    const { password: _, ...userData } = employee;

    return response.success(res, { token, user: userData }, null, "เข้าสู่ระบบสำเร็จ");
  } catch (error) {
    console.error("Login error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการเข้าสู่ระบบ", "LOGIN_ERROR");
  }
};

/**
 * GET /api/hq/auth/me
 */
exports.getCurrentUser = async (req, res) => {
  try {
    const employee = await prisma.employee_hq.findUnique({
      where: { id: req.user.id },
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

    if (employee.status === "inactive") {
      return response.error(res, "รหัสพนักงานนี้ถูกระงับการใช้งาน", "FORBIDDEN", 403);
    }

    return response.success(res, employee);
  } catch (error) {
    console.error("Get current user error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้", "FETCH_ERROR");
  }
};
