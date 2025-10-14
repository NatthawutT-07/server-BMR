const prisma = require("../../config/prisma");

exports.listUser = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        role: true,
        enabled: true,
      },
    });
    res.json(users);
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "List Users Error" });
  }
};


exports.changeStatus = async (req, res) => {
  try {
    const { id, enabled } = req.body;
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { enabled: enabled },
    });

    res.send("Update Status Success");
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "changeStatus Error" });
  }
};

exports.changeRole = async (req, res) => {
  try {
    const { id, role } = req.body;
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { role: role },
    });

    res.send("Update Role Success");
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "changeStatus Error" });
  }
};

