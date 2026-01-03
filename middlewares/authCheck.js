const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

exports.authCheck = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization) {
      const [bearer, value] = req.headers.authorization.split(" ");
      if (bearer === "Bearer") token = value;
    }

    if (!token) return res.status(401).json({ msg: "No token provided" });

    let decode;
    try {
      decode = jwt.verify(token, process.env.SECRET);
    } catch (err) {
      return res.status(401).json({ msg: "Token invalid or expired" });
    }

    const user = await prisma.user.findFirst({
      where: { id: decode.id, enabled: true },
    });

    if (!user) return res.status(400).json({ msg: "User not found or disabled" });

    if (decode.tokenVersion !== user.refreshTokenVersion) {
      return res.status(401).json({
        msg: "Token expired, refresh required",
        code: "TOKEN_VERSION_MISMATCH",
      });
    }

    req.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (e) {
    console.error("AuthCheck Error:", e);
    res.status(500).json({ msg: "Internal server error" });
  }
};

exports.adminCheck = async (req, res, next) => {
  try {
    const admin = await prisma.user.findFirst({
      where: { id: req.user.id, role: "admin" },
    });

    if (!admin) return res.status(403).json({ msg: "Access denied: Admin only" });

    next();
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "Error Admin access denied" });
  }
};
