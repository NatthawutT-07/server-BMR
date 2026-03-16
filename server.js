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
  // Production
  "https://bmrpog.com",

  // Development - Web
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",

  // Development - Mobile (Expo)
  "http://localhost:8081",  // Metro bundler
  "http://localhost:19000", // Expo dev server
  "http://localhost:19001",
  "http://localhost:19006", // Expo web
];

// Mobile apps ไม่มี origin (เหมือน Postman) หรือมี pattern พิเศษ
const isMobileOrDevOrigin = (origin) => {
  if (!origin) return true; // Mobile apps, curl, Postman

  // Expo development patterns
  if (origin.includes("exp://")) return true;
  if (origin.includes(".exp.direct")) return true;
  if (origin.includes("expo.dev")) return true;

  // LAN IP patterns (192.168.x.x, 10.x.x.x, etc.)
  if (/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(origin)) return true;

  return false;
};

app.use(
  cors({
    origin: (origin, cb) => {
      // Mobile apps และ dev tools
      if (isMobileOrDevOrigin(origin)) return cb(null, true);

      // Allowed origins list
      if (allowedOrigins.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);

// ✅ Console-only logging (no file output)
app.use(morgan('dev'));

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



// ✅ Health check endpoint for Docker/Kubernetes
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
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
