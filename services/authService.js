const prisma = require("../config/prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

exports.register = async (name, password, role) => {
  if (!name || !password) throw new Error("Name and password are required");
  
  const exist = await prisma.user.findUnique({ where: { name } });
  if (exist) throw new Error("User already exists");

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

  return { id: user.id, name: user.name, role: user.role };
};

exports.login = async (name, password, ip, userAgent) => {
  const rawName = String(name || "").trim();
  const normalizedName = /^[A-Za-z]{2}\d{3}$/.test(rawName)
    ? rawName.toUpperCase()
    : rawName;

  let user = await prisma.user.findFirst({ where: { name: normalizedName } });
  if (!user && !normalizedName.includes("@")) {
    user = await prisma.user.findFirst({ where: { name: `POG@${normalizedName}` } });
  }

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
    throw new Error("User Not found or not Enabled");
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
    throw new Error("Password Invalid!!!");
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

  return { 
    user: { id: user.id, name: user.name, role: user.role }, 
    accessToken, 
    refreshToken 
  };
};

exports.refresh = async (token) => {
  let payload;
  try {
    payload = jwt.verify(token, process.env.REFRESH_SECRET);
  } catch (err) {
    throw new Error("Invalid refresh token");
  }

  const user = await prisma.user.findFirst({
    where: { id: payload.id, enabled: true },
  });

  if (!user) throw new Error("User not found");
  if (user.refreshTokenVersion !== payload.tokenVersion) {
    throw new Error("Token version mismatch");
  }

  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
    user: { id: user.id, name: user.name, role: user.role },
  };
};

exports.logout = async (token, fallbackUserId) => {
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
    userId = fallbackUserId;
  }

  if (userId) {
    await prisma.user.updateMany({
      where: { id: userId },
      data: { refreshTokenVersion: { increment: 1 } },
    });
  }
};

exports.changePassword = async (userId, oldPassword, newPassword) => {
  const user = await prisma.user.findFirst({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) throw new Error("Old password incorrect");

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
};

exports.getUser = async (userId) => {
  return await prisma.user.findFirst({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });
};
