const prisma = require("../../config/prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.register = async (req, res) => {
  try {
    const { employee_code, nickname, position, organizational_unit, password, role } = req.body;

    const existingEmployee = await prisma.employee_hq.findUnique({
      where: { employee_code },
    });

    if (existingEmployee) {
      return res.status(400).json({
        ok: false,
        message: "รหัสพนักงานนี้มีอยู่ในระบบแล้ว",
      });
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

    res.status(201).json({
      ok: true,
      message: "ลงทะเบียนสำเร็จ",
      data: employeeData,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      ok: false,
      message: "เกิดข้อผิดพลาดในการลงทะเบียน",
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { employee_code, password } = req.body;

    const employee = await prisma.employee_hq.findUnique({
      where: { employee_code },
    });

    if (!employee) {
      return res.status(401).json({
        ok: false,
        message: "ไม่พบรหัสพนักงานในระบบ",
      });
    }

    if (employee.status === 'inactive') {
      return res.status(401).json({
        ok: false,
        message: "รหัสพนักงานนี้ถูกระงับการใช้งาน",
      });
    }

    if (employee.role !== "admin") {
      return res.status(401).json({
        ok: false,
        message: "ระบบนี้สงวนสิทธิ์การเข้าใช้งานเฉพาะ Admin เท่านั้น",
      });
    }

    if (!password) {
      return res.status(401).json({
        ok: false,
        message: "กรุณากรอกรหัสผ่าน",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, employee.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        ok: false,
        message: "รหัสผ่านไม่ถูกต้อง",
      });
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

    res.json({
      ok: true,
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: userData,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      ok: false,
      message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ",
    });
  }
};

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
      return res.status(404).json({
        ok: false,
        message: "ไม่พบข้อมูลพนักงาน",
      });
    }

    if (employee.status === "inactive") {
      return res.status(403).json("รหัสพนักงานนี้ถูกระงับการใช้งาน");
    }

    res.json({
      ok: true,
      data: employee,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      ok: false,
      message: "เกิดข้อผิดพลาด",
    });
  }
};
