const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

exports.authCheck = async (req, res, next) => {
  try {
    const headerToken = req.headers.authorization;
    // console.log(headerToken)
    if (!headerToken) {
      return res.status(401).json({ msg: "No Token" });
    }
    const token = headerToken.split(" ")[1]; // 0 = Bearer Token

    const decode = jwt.verify(token, process.env.SECRET);
    req.user = decode; // .user คือเพิ่ม key วิ่งไปทุกๆหน้า

    const user = await prisma.user.findFirst({
      where: {
        name: req.user.name,
      },
    });
    if (!user.enabled) {
      return res.status(400).json({ msg: "This account cannot access" });
    }

    next();
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "Token Invalid" });
  }
};

exports.adminCheck = async (req, res, next) => {
  try {
    const { name } = req.user;
    const adminUser = await prisma.user.findFirst({
      where: { name: name }
    })
    if (!adminUser || adminUser.role !== 'admin') {
      return req.status(403).json({ msg: 'Acess denied : Admin only' })
    }

    next()
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "Error Admin access denied" });
  }
};
