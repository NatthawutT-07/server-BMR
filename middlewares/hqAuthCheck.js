const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

exports.hqAuthCheck = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization) {
      const [bearer, value] = req.headers.authorization.split(" ");
      if (bearer === "Bearer") token = value;
    }

    if (!token) return res.status(401).json({ ok: false, msg: "No token provided" });

    let decode;
    try {
      decode = jwt.verify(token, process.env.SECRET);
    } catch (err) {
      return res.status(401).json({ ok: false, msg: "Token invalid or expired" });
    }

    const employee = await prisma.employee_hq.findFirst({
      where: { id: decode.id },
    });

    if (!employee) return res.status(400).json({ ok: false, msg: "Employee not found" });

    req.user = { 
      id: employee.id, 
      employee_code: employee.employee_code, 
      role: employee.role 
    };
    next();
  } catch (e) {
    console.error("HQ AuthCheck Error:", e);
    res.status(500).json({ ok: false, msg: "Internal server error" });
  }
};

exports.hqAdminCheck = async (req, res, next) => {
  try {
    const admin = await prisma.employee_hq.findFirst({
      where: { id: req.user.id, role: "admin" },
    });

    if (!admin) return res.status(403).json({ ok: false, msg: "Access denied: Admin only" });

    next();
  } catch (e) {
    console.error("HQ AdminCheck Error:", e);
    res.status(500).json({ ok: false, msg: "Error Admin access denied" });
  }
};
