const prisma = require("../../config/prisma");
const bcrypt = require("bcryptjs");

exports.listUser = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        role: true,
        enabled: true,
      },
      orderBy: { id: 'asc' }
    });
    res.json(users);
  } catch (e) {
    console.log(e);
    res.status(500).json({ msg: "List Users Error" });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, password, role } = req.body;
    
    if (!name || !password) {
      return res.status(400).json({ message: "Name and password are required" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { name }
    });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: {
        name,
        password: hashedPassword,
        role: role || "user"
      },
      select: { id: true, name: true, role: true, enabled: true }
    });

    res.status(201).json(newUser);
  } catch (e) {
    console.log("Create User Error:", e);
    res.status(500).json({ message: "Server Error" });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = Number(id);

    if (isNaN(userId)) return res.status(400).json({ message: "Invalid ID" });

    // Optional: prevent deleting self or the main admin
    // For now, we'll just delete the user
    await prisma.user.delete({
      where: { id: userId }
    });

    res.json({ message: "User deleted successfully" });
  } catch (e) {
    console.log("Delete User Error:", e);
    if (e.code === "P2003" || e.code === "P2014" || e.code === "P2025") {
      return res.status(400).json({ message: "Cannot delete user because it is referenced by other records." });
    }
    res.status(500).json({ message: "Server Error" });
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

