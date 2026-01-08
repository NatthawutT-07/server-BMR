const express = require("express");
const app = express();
app.disable("x-powered-by");

const morgan = require("morgan");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { ensureCsrfCookie } = require("./middlewares/csrf");

// ✅ อยู่หลัง proxy (เช่น Cloudflare / Nginx)
app.set("trust proxy", 1);

// ✅ CORS (ต้องเปิด credentials เพื่อส่ง cookie refresh token)
const allowedOrigins = [
  // "https://web-bmr.ngrok.app",
  // "http://localhost:4173",
  "http://localhost:5173",
  "https://bmrpog.com",
];

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);

/* =========================
   Helpers: Client IP + User
========================= */

// ✅ ดึง Public IP ของ client ให้ “ถูกตัวจริงที่สุด” เมื่ออยู่หลัง Cloudflare/Proxy
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

  if (ip && typeof ip === "string") {
    ip = ip.split(",")[0].trim();
  }

  ip = ip || req.socket?.remoteAddress || req.ip || "-";
  if (typeof ip === "string" && ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
};

// ✅ อ่าน user จาก access token แบบ “เบาๆ” เพื่อให้ morgan เห็น user ได้ทันที
const attachUserFromAccessToken = (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return next();

    const [bearer, token] = auth.split(" ");
    if (bearer !== "Bearer" || !token) return next();

    const decoded = jwt.verify(token, process.env.SECRET);
    req.user = { id: decoded.id, name: decoded.name, role: decoded.role };
    return next();
  } catch (err) {
    return next();
  }
};

/* =========================
   Morgan tokens
========================= */

morgan.token("th-time", () => {
  return new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour12: false,
  });
});

morgan.token("real-ip", (req) => getClientIp(req));
morgan.token("user", (req) => req.user?.name || req.user?.username || "-");
morgan.token("agent", (req) => req.headers["user-agent"] || "-");

/* =========================
   ✅ Colored status (console only)
========================= */
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",

  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

const colorStatus = (status) => {
  const s = Number(status);
  if (s >= 200 && s < 300) return `${ANSI.green}${s}${ANSI.reset}`; // 2xx
  if (s >= 300 && s < 400) return `${ANSI.cyan}${s}${ANSI.reset}`;  // 3xx
  if (s >= 400 && s < 500) return `${ANSI.yellow}${s}${ANSI.reset}`; // 4xx
  if (s >= 500) return `${ANSI.red}${s}${ANSI.reset}`;              // 5xx
  return `${ANSI.gray}${status}${ANSI.reset}`;
};

// token ที่ “คืน status แบบมีสี”
morgan.token("status-color", (req, res) => colorStatus(res.statusCode));

// (เสริม) สี method ให้อ่านง่าย
const colorMethod = (method) => {
  if (method === "GET") return `${ANSI.cyan}${method}${ANSI.reset}`;
  if (method === "POST") return `${ANSI.green}${method}${ANSI.reset}`;
  if (method === "PUT" || method === "PATCH") return `${ANSI.yellow}${method}${ANSI.reset}`;
  if (method === "DELETE") return `${ANSI.red}${method}${ANSI.reset}`;
  return `${ANSI.gray}${method}${ANSI.reset}`;
};
morgan.token("method-color", (req) => colorMethod(req.method));

/* =========================
   Log ลงไฟล์ (ไม่ใส่สี)
========================= */

const accessLogStream = fs.createWriteStream(path.join(__dirname, "access.log"), {
  flags: "a",
});

// ✅ สำคัญ: attachUserFromAccessToken ต้องมาก่อน morgan
app.use(attachUserFromAccessToken);

app.use(
  morgan(
    ':th-time | user=:user | ip=:real-ip | agent=":agent" | :method :url | :status | :response-time ms',
    { stream: accessLogStream }
  )
);

// ---------- log ลง console (ใส่สี) ----------
app.use(
  morgan(
    ':th-time | user=:user | ip=:real-ip | :method-color :url | :status-color | :response-time ms'
  )
);

/* =========================
   Middlewares
========================= */

app.use(
  compression({
    brotli: { enabled: true, zlib: {} },
  })
);

app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

// ✅ Security headers (helmet)
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 15552000, includeSubDomains: true, preload: true }
        : false,
  })
);

// ✅ CSRF cookie (double-submit)
app.use(ensureCsrfCookie);

// ✅ Normalize error responses (ให้ทุก controller ได้รูปแบบเดียวกัน)
app.use((req, res, next) => {
  const rawJson = res.json.bind(res);
  const rawSend = res.send.bind(res);

  res.json = (payload) => {
    const status = res.statusCode || 200;
    if (status >= 400) {
      if (payload && payload.ok === false) return rawJson(payload);

      const message =
        payload?.message ||
        payload?.msg ||
        payload?.error ||
        "Error";
      const code = payload?.code || "ERROR";

      const normalized = { ok: false, code, message };
      return rawJson(normalized);
    }
    return rawJson(payload);
  };

  res.send = (payload) => {
    const status = res.statusCode || 200;
    if (status >= 400) {
      const message =
        typeof payload === "string" && payload.trim()
          ? payload
          : "Error";
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return rawSend(JSON.stringify({ ok: false, code: "ERROR", message }));
    }
    return rawSend(payload);
  };

  next();
});



// routes
app.use("/api", require("./router/auth"));
app.use("/api", require("./router/admin"));
app.use("/api", require("./router/user"));
app.use("/api", require("./router/userMobile"));

// ✅ Error handler: response format สั้น/สม่ำเสมอ
app.use((err, req, res, next) => {
  const status = err?.status || err?.statusCode || 500;
  const message = err?.message || "Server error";
  const code = err?.code || "SERVER_ERROR";
  res.status(status).json({
    ok: false,
    code,
    message,
  });
});

const port = process.env.PORT || 5001;
app.listen(port, () => console.log(`Server running on port ${port}`));
