const express = require("express");
const app = express();
const morgan = require("morgan");
const { readdirSync } = require("fs");
const cors = require("cors");

app.use(morgan("dev"));
app.use(express.json({ limit: "20mb" }));

// ✅ Allow เฉพาะโดเมน production
const allowedOrigins = [
  "https://web-bmr.vercel.app", // React frontend production
  "http://localhost:5173", // สำหรับ dev
  "https://locustlike-snufflingly-anisa.ngrok-free.dev"
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);



readdirSync("./router").map((c) => app.use("/api", require("./router/" + c)));

app.listen(5001, "0.0.0.0", () =>
  console.log("🚀 Server running on port 5001")
);
