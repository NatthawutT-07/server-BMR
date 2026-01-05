const prisma = require("../config/prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ✅ ดึง Public IP ของ client ให้เหมือนที่ใช้ใน app.js
const getClientIp = (req) => {
  const cfIp = req.headers["cf-connecting-ip"];
  const trueClientIp = req.headers["true-client-ip"];
  const xRealIp = req.headers["x-real-ip"];
  const xff = req.headers["x-forwarded-for"];

  let ip =
    (Array.isArray(cfIp) ? cfIp[0] : cfIp) ||
    (Array.isArray(trueClientIp) ? trueClientIp[0] : trueClientIp) ||
    (Array.isArray(xRealIp) ? xRealIp[0] : xRealIp) ||
    (Array.isArray(xff) ? xff[0] : xff);

  if (ip && typeof ip === "string") ip = ip.split(",")[0].trim();
  ip = ip || req.socket?.remoteAddress || req.ip || "-";
  if (typeof ip === "string" && ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
};

// Helper: สร้าง access token
const signAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      role: user.role,
      tokenVersion: user.refreshTokenVersion,
    },
    process.env.SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRE || "15m" }
  );
};

// Helper: สร้าง refresh token
const signRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      tokenVersion: user.refreshTokenVersion,
    },
    process.env.REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || "7d" }
  );
};

const getRefreshCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/api/refresh-token",
  };
};

// Helper: ส่ง refresh token ผ่าน cookie
const sendRefreshToken = (res, token) => {
  res.cookie("jid", token, getRefreshCookieOptions());
};

const clearRefreshToken = (res) => {
  res.cookie("jid", "", {
    ...getRefreshCookieOptions(),
    expires: new Date(0),
  });
};

const getUserIdFromAccessToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth) return null;

  const [bearer, token] = auth.split(" ");
  if (bearer !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, process.env.SECRET);
    return payload?.id || null;
  } catch {
    return null;
  }
};

// --------------------- Register ---------------------
exports.register = async (req, res) => {
  try {
    const { name, password, role } = req.body;

    if (!name || !password) {
      return res.status(400).json({ msg: "Name and password are required" });
    }

    const exist = await prisma.user.findUnique({ where: { name } });
    if (exist) return res.status(400).json({ msg: "User already exists" });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        name,
        password: hash,
        role: role || "user",
        enabled: true,
        lastPasswordChange: new Date(),
      },
    });

    res.json({
      msg: "Register success",
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "Server error" });
  }
};

// --------------------- Login ---------------------
exports.login = async (req, res) => {
  try {
    const { name, password } = req.body;
    const rawName = String(name || "").trim();
    const normalizedName = /^[A-Za-z]{2}\d{3}$/.test(rawName)
      ? rawName.toUpperCase()
      : rawName;

    let user = await prisma.user.findFirst({ where: { name: normalizedName } });
    if (!user && !normalizedName.includes("@")) {
      user = await prisma.user.findFirst({ where: { name: `POG@${normalizedName}` } });
    }

    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";

    if (!user || !user.enabled) {
      await prisma.loginLog.create({
        data: {
          userId: user ? user.id : null,
          ip,
          userAgent,
          status: "failed",
        message: "User not found or not enabled",
      },
    });

      return res.status(400).json({ msg: "User Not found or not Enabled" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await prisma.loginLog.create({
        data: {
          userId: user.id,
          ip,
          userAgent,
          status: "failed",
          message: "Password invalid",
        },
      });

      return res.status(400).json({ msg: "Password Invalid!!!" });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    await prisma.loginLog.create({
      data: {
        userId: user.id,
        ip,
        userAgent,
        status: "success",
        message: "Login success",
      },
    });

    sendRefreshToken(res, refreshToken);

    res.json({
      payload: { id: user.id, name: user.name, role: user.role },
      accessToken,
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "server error" });
  }
};

// --------------------- Refresh Token ---------------------
exports.refreshToken = async (req, res) => {
  try {
    const token = req.cookies.jid;
    if (!token) {
      clearRefreshToken(res);
      return res.status(401).json({ msg: "No refresh token" });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.REFRESH_SECRET);
    } catch (err) {
      clearRefreshToken(res);
      return res.status(401).json({ msg: "Invalid refresh token" });
    }

    const user = await prisma.user.findFirst({
      where: { id: payload.id, enabled: true },
    });

    if (!user) {
      clearRefreshToken(res);
      return res.status(401).json({ msg: "User not found" });
    }

    if (user.refreshTokenVersion !== payload.tokenVersion) {
      clearRefreshToken(res);
      return res.status(401).json({ msg: "Token version mismatch" });
    }

    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);

    sendRefreshToken(res, newRefreshToken);

    res.json({
      accessToken: newAccessToken,
      payload: { id: user.id, name: user.name, role: user.role },
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "server error" });
  }
};

// --------------------- Logout ---------------------
exports.logout = async (req, res) => {
  try {
    const token = req.cookies?.jid;
    let userId = null;

    if (token) {
      try {
        const payload = jwt.verify(token, process.env.REFRESH_SECRET);
        userId = payload?.id || null;
      } catch {
        userId = null;
      }
    }

    if (!userId) {
      userId = getUserIdFromAccessToken(req);
    }

    if (userId) {
      await prisma.user.updateMany({
        where: { id: userId },
        data: { refreshTokenVersion: { increment: 1 } },
      });
    }

    clearRefreshToken(res);

    res.json({ msg: "Logged out" });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "server error" });
  }
};

// --------------------- Change Password ---------------------
exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const user = await prisma.user.findFirst({ where: { id: req.user.id } });
    if (!user) return res.status(400).json({ msg: "User not found" });

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Old password incorrect" });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hash,
        lastPasswordChange: new Date(),
        refreshTokenVersion: user.refreshTokenVersion + 1,
      },
    });

    res.json({ msg: "Password changed successfully" });
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "server error" });
  }
};

// --------------------- Current User ---------------------
exports.currentUser = async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user.id },
      select: { id: true, name: true, role: true },
    });

    res.json({ user });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "server error" });
  }
};

// --------------------- Current Admin ---------------------
exports.currentAdmin = async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user.id },
      select: { id: true, name: true, role: true },
    });

    res.json({ user });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "Server error" });
  }
};
