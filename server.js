const express = require("express");
const app = express();
const morgan = require("morgan");
const { readdirSync } = require("fs");
const cors = require('cors')


app.use(morgan("dev"));
app.use(express.json({ limit: "20mb" }));
app.use(cors())

// console.log(readdirSync('./router'))
readdirSync("./router").map((c) => app.use("/api", require("./router/" + c)));

app.listen(5001, () => console.log("server run port 5001"));
