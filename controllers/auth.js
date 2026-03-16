const authService = require("../services/authService");
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

const getRefreshCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/api/refresh-token",
  };
};

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
    const user = await authService.register(name, password, role);

    res.json({
      msg: "Register success",
      user,
    });
  } catch (e) {
    if (e.message === "Name and password are required" || e.message === "User already exists") {
      return res.status(400).json({ msg: e.message });
    }
    console.log(e);
    res.status(500).json({ msg: "Server error" });
  }
};

// --------------------- Login ---------------------
exports.login = async (req, res) => {
  try {
    const { name, password } = req.body;
    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";

    const { user, accessToken, refreshToken } = await authService.login(name, password, ip, userAgent);

    sendRefreshToken(res, refreshToken);

    res.json({
      payload: user,
      accessToken,
    });
  } catch (e) {
    if (e.message === "User Not found or not Enabled" || e.message === "Password Invalid!!!") {
      return res.status(400).json({ msg: e.message });
    }
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

    const { accessToken, refreshToken, user } = await authService.refresh(token);

    sendRefreshToken(res, refreshToken);

    res.json({
      accessToken: accessToken,
      payload: user,
    });
  } catch (e) {
    clearRefreshToken(res);
    if (e.message === "Invalid refresh token" || e.message === "User not found" || e.message === "Token version mismatch") {
      return res.status(401).json({ msg: e.message });
    }
    console.log(e);
    res.status(500).json({ msg: "server error" });
  }
};

// --------------------- Logout ---------------------
exports.logout = async (req, res) => {
  try {
    const token = req.cookies?.jid;
    const fallbackUserId = getUserIdFromAccessToken(req);

    await authService.logout(token, fallbackUserId);

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
    await authService.changePassword(req.user.id, oldPassword, newPassword);

    res.json({ msg: "Password changed successfully" });
  } catch (e) {
    if (e.message === "User not found" || e.message === "Old password incorrect") {
      return res.status(400).json({ msg: e.message });
    }
    console.log(e);
    res.status(500).json({ msg: "server error" });
  }
};

// --------------------- Current User ---------------------
exports.currentUser = async (req, res) => {
  try {
    const user = await authService.getUser(req.user.id);
    res.json({ user });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "server error" });
  }
};

// --------------------- Current Admin ---------------------
exports.currentAdmin = async (req, res) => {
  try {
    const user = await authService.getUser(req.user.id);
    res.json({ user });
  } catch (e) {
    console.log(e);
    res.status(500).json({ message: "Server error" });
  }
};
