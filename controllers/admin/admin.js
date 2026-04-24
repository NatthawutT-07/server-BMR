const prisma = require("../../config/prisma");
const bcrypt = require("bcryptjs");
const response = require("../../utils/responseHelper");

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
    return response.success(res, users);
  } catch (e) {
    console.log(e);
    return response.error(res, "List Users Error");
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, password, role } = req.body;
    
    if (!name || !password) {
      return response.error(res, "Name and password are required", "BAD_REQUEST", 400);
    }

    const existingUser = await prisma.user.findUnique({
      where: { name }
    });

    if (existingUser) {
      return response.error(res, "User already exists", "CONFLICT", 400);
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

    return response.success(res, newUser, null, "User created successfully", 201);
  } catch (e) {
    console.log("Create User Error:", e);
    return response.error(res, "Server Error");
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = Number(id);

    if (isNaN(userId)) return response.error(res, "Invalid ID", "BAD_REQUEST", 400);

    await prisma.user.delete({
      where: { id: userId }
    });

    return response.success(res, null, null, "User deleted successfully");
  } catch (e) {
    console.log("Delete User Error:", e);
    if (e.code === "P2003" || e.code === "P2014" || e.code === "P2025") {
      return response.error(res, "Cannot delete user because it is referenced by other records.", "BAD_REQUEST", 400);
    }
    return response.error(res, "Server Error");
  }
};

exports.changeStatus = async (req, res) => {
  try {
    const { id, enabled } = req.body;
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { enabled: enabled },
    });

    return response.success(res, null, null, "Update Status Success");
  } catch (e) {
    console.log(e);
    return response.error(res, "changeStatus Error");
  }
};

exports.changeRole = async (req, res) => {
  try {
    const { id, role } = req.body;
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { role: role },
    });

    return response.success(res, null, null, "Update Role Success");
  } catch (e) {
    console.log(e);
    return response.error(res, "changeRole Error");
  }
};

