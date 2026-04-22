const prisma = require("../../config/prisma");
const fs = require("fs");
const path = require("path");

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

    res.json({ ok: true, data: rewards });
  } catch (error) {
    console.error("Get rewards error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const getRewardById = async (req, res) => {
  try {
    const { id } = req.params;
    const reward = await prisma.reward_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!reward) {
      return res.status(404).json({ ok: false, message: "Reward not found" });
    }

    res.json({ ok: true, data: reward });
  } catch (error) {
    console.error("Get reward error:", error);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const createReward = async (req, res) => {
  try {
    const { title, point_reward } = req.body;

    if (!title || point_reward === undefined) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ ok: false, message: "Missing required fields" });
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

    res.status(201).json({ ok: true, data: reward });
  } catch (error) {
    console.error("Create reward error:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ ok: false, message: error.message });
  }
};

const updateReward = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, point_reward } = req.body;

    const existingReward = await prisma.reward_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingReward) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ ok: false, message: "Reward not found" });
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

    res.json({ ok: true, data: reward });
  } catch (error) {
    console.error("Update reward error:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Reward not found" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

const deleteReward = async (req, res) => {
  try {
    const { id } = req.params;

    const existingReward = await prisma.reward_hq.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingReward) {
      return res.status(404).json({ ok: false, message: "Reward not found" });
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

    res.json({ ok: true, message: "Reward deleted successfully" });
  } catch (error) {
    console.error("Delete reward error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ ok: false, message: "Reward not found" });
    }
    res.status(500).json({ ok: false, message: error.message });
  }
};

module.exports = {
  getAllRewards,
  getRewardById,
  createReward,
  updateReward,
  deleteReward,
};
