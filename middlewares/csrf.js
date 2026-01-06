// C:\BMR\bmr_data\edit\server-BMR\middlewares\csrf.js
const crypto = require("crypto");

const CSRF_COOKIE = "csrfToken";

const getCsrfCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: false,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  };
};

const ensureCsrfCookie = (req, res, next) => {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (existing) {
    req.csrfToken = existing;
    return next();
  }

  const token = crypto.randomBytes(32).toString("hex");
  res.cookie(CSRF_COOKIE, token, getCsrfCookieOptions());
  req.csrfToken = token;
  return next();
};

const verifyCsrf = (req, res, next) => {
  const headerToken = req.headers["x-csrf-token"];
  const cookieToken = req.cookies?.[CSRF_COOKIE];

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({ msg: "Invalid CSRF token" });
  }

  return next();
};

module.exports = { ensureCsrfCookie, verifyCsrf, CSRF_COOKIE };
