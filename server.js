const express = require("express");
const app = express();
const morgan = require("morgan");
const { readdirSync } = require("fs");
const cors = require('cors')

// app.use(morgan('combined'));  // ใช้ log ที่ละเอียดขึ้น
app.use(morgan("dev"));
app.use(express.json({ limit: "20mb" }));
app.use(cors())

// app.use(cors({
//     origin: ["https://web-bmr.ngrok.app"],
//     credentials: true,
// }));


// app.use((req, res, next) => {
//     setTimeout(() => {
//         next();
//     }, 1000);
// });

readdirSync("./router").map((c) => app.use("/api", require("./router/" + c)));

app.listen(5001, () => console.log("server run port 5001"));
