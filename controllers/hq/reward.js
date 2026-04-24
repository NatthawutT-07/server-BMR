const prisma = require("../../config/prisma");
const response = require("../../utils/responseHelper");
const fs = require("fs");
const path = require("path");

/**
 * GET /api/hq/rewards
 */
const getAllRewards = async (req, res) => {
  try {
    const { min_points, max_points } = req.query;
    
    const where = {};
    if (min_points || max_points) {
      where.point_reward = {};
      if (min_points) where.point_reward.gte = parseInt(min_points);
      if (max_points) where.point_reward.lte = parseInt(max_points);
    }

    const rewards = await prisma.reward_hq.findMany({
      where,
      orderBy: { point_reward: "asc" },
    });

    return response.success(res, rewards);
  } catch (error) {
    console.error("Get rewards error:", error);
    return response.error(res, "ไม่สามารถดึงข้อมูลรางวัลได้", "FETCH_ERROR", 500, error.message);
  }
};

/**
 * GET /api/hq/rewards/:id
 */
const getRewardById = async (req, res) => {
  try {
    const { id } = req.params;
    const reward = await prisma.reward_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!reward) {
      return response.error(res, "ไม่พบข้อมูลรางวัล", "NOT_FOUND", 404);
    }

    return response.success(res, reward);
  } catch (error) {
    console.error("Get reward error:", error);
    return response.error(res, "เกิดข้อผิดพลาดในการดึงข้อมูล", "FETCH_ERROR", 500, error.message);
  }
};

/**
 * POST /api/hq/rewards
 */
const createReward = async (req, res) => {
  try {
    const { title, point_reward } = req.body;

    if (!title || point_reward === undefined) {
      if (req.file) fs.unlinkSync(req.file.path);
      return response.error(res, "กรุณากรอกข้อมูลให้ครบถ้วน", "BAD_REQUEST", 400);
    }

    const data = {
      title,
      point_reward: parseInt(point_reward),
    };

    if (req.file) {
      data.image_url = `/uploads/rewards/${req.file.filename}`;
    }

    const reward = await prisma.reward_hq.create({
      data,
    });

    return response.success(res, reward, null, "เพิ่มรางวัลสำเร็จ", 201);
  } catch (error) {
    console.error("Create reward error:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    return response.error(res, "ไม่สามารถสร้างรางวัลได้", "CREATE_ERROR", 500, error.message);
  }
};

/**
 * PUT /api/hq/rewards/:id
 */
const updateReward = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, point_reward } = req.body;

    const existingReward = await prisma.reward_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingReward) {
      if (req.file) fs.unlinkSync(req.file.path);
      return response.error(res, "ไม่พบข้อมูลรางวัล", "NOT_FOUND", 404);
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (point_reward !== undefined) updateData.point_reward = parseInt(point_reward);

    if (req.file) {
      updateData.image_url = `/uploads/rewards/${req.file.filename}`;
      // Delete old image
      if (existingReward.image_url) {
        const oldImagePath = path.join(__dirname, "../../", existingReward.image_url);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
    }

    const reward = await prisma.reward_hq.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    return response.success(res, reward, null, "อัปเดตข้อมูลรางวัลสำเร็จ");
  } catch (error) {
    console.error("Update reward error:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลรางวัล", "NOT_FOUND", 404);
    }
    return response.error(res, "ไม่สามารถอัปเดตข้อมูลได้", "UPDATE_ERROR", 500, error.message);
  }
};

/**
 * DELETE /api/hq/rewards/:id
 */
const deleteReward = async (req, res) => {
  try {
    const { id } = req.params;

    const existingReward = await prisma.reward_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingReward) {
      return response.error(res, "ไม่พบข้อมูลรางวัลที่ต้องการลบ", "NOT_FOUND", 404);
    }

    await prisma.reward_hq.delete({
      where: { id: parseInt(id) },
    });

    // Delete associated image
    if (existingReward.image_url) {
      const imagePath = path.join(__dirname, "../../", existingReward.image_url);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    return response.success(res, null, null, "ลบรางวัลสำเร็จ");
  } catch (error) {
    console.error("Delete reward error:", error);
    if (error.code === "P2025") {
      return response.error(res, "ไม่พบข้อมูลรางวัล", "NOT_FOUND", 404);
    }
    return response.error(res, "ไม่สามารถลบข้อมูลได้", "DELETE_ERROR", 500, error.message);
  }
};

module.exports = {
  getAllRewards,
  getRewardById,
  createReward,
  updateReward,
  deleteReward,
};
