const rateLimit = require("express-rate-limit");

// จำกัดการยิง /login
exports.loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 นาที
  max: 100, // 10 ครั้งต่อ 15 นาที ต่อ IP
  message: { msg: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
