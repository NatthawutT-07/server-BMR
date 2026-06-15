const express = require("express");
const app = express();
app.disable("x-powered-by");

process.env.TZ = "Asia/Bangkok";

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

app.set("trust proxy", 1);

// CORS
const allowedOrigins = [
  // Production
  "https://bmrpog.com",
  "https://hq.bmrpog.com",

  // Development - Web
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",

  // Development - Mobile
  "http://localhost:8081",  // Metro bundler
  "http://localhost:19000", // dev server
  "http://localhost:19001",
  "http://localhost:19006", // web
];

const isMobileOrDevOrigin = (origin) => {
  if (!origin) return true; // Mobile apps, curl, Postman

  // development patterns
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

app.use(morgan('dev'));

app.use((req, res, next) => {
  const startTime = Date.now();

  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    const method = req.method;
    const url = req.originalUrl || req.url;

    console.log(`🔹 API ${method} ${url} - Status: ${status} - ${duration}ms`);

    originalEnd.apply(this, args);
  };

  next();
});

app.use(
  compression({
    brotli: { enabled: true, zlib: {} },
  })
);

app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

// Security headers
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

// CSRF cookie (double-submit)
app.use(ensureCsrfCookie);

// Normalize error responses
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



app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api", require("./router/auth"));
app.use("/api", require("./router/admin"));
app.use("/api", require("./router/user"));
app.use("/api", require("./router/userMobile"));
app.use("/api", require("./router/hq"));

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
