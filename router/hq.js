const express = require("express");
const router = express.Router();
const { hqAuthCheck, hqAdminCheck } = require("../middlewares/hqAuthCheck");

const authController = require("../controllers/hq/auth");
const branchController = require("../controllers/hq/branch");
const rewardController = require("../controllers/hq/reward");
const employeeController = require("../controllers/hq/employee");
const logController = require("../controllers/hq/log");

// ==================== AUTH ROUTES ====================
router.post("/hq/auth/register", authController.register);
router.post("/hq/auth/login", authController.login);
router.get("/hq/auth/current-user", hqAuthCheck, authController.getCurrentUser);

// ==================== BRANCH_HQ ROUTES ====================
router.get("/hq/branches", branchController.getAllBranches);
router.get("/hq/branches/:id", hqAuthCheck, branchController.getBranchById);
router.post("/hq/branches", hqAuthCheck, hqAdminCheck, branchController.createBranch);
router.put("/hq/branches/:id", hqAuthCheck, hqAdminCheck, branchController.updateBranch);
router.delete("/hq/branches/:id", hqAuthCheck, hqAdminCheck, branchController.deleteBranch);

const multer = require("multer");
const path = require("path");

// Configure multer for reward image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/rewards/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "reward-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// ==================== REWARD_HQ ROUTES ====================
router.get("/hq/rewards", rewardController.getAllRewards);
router.get("/hq/rewards/:id", hqAuthCheck, rewardController.getRewardById);
router.post("/hq/rewards", hqAuthCheck, hqAdminCheck, upload.single('image'), rewardController.createReward);
router.put("/hq/rewards/:id", hqAuthCheck, hqAdminCheck, upload.single('image'), rewardController.updateReward);
router.delete("/hq/rewards/:id", hqAuthCheck, hqAdminCheck, rewardController.deleteReward);

// ==================== EMPLOYEE_HQ ROUTES ====================
router.get("/hq/employees", employeeController.getAllEmployees);
router.get("/hq/employees/code/:employee_code", employeeController.getEmployeeByCode);
router.get("/hq/employees/:id", hqAuthCheck, employeeController.getEmployeeById);
router.get("/hq/employees/:id/stats", hqAuthCheck, employeeController.getEmployeeStats);
router.post("/hq/employees", hqAuthCheck, hqAdminCheck, employeeController.createEmployee);
router.post("/hq/employees/bulk", hqAuthCheck, hqAdminCheck, employeeController.bulkCreateEmployees);
router.put("/hq/employees/:id", hqAuthCheck, hqAdminCheck, employeeController.updateEmployee);
router.delete("/hq/employees/:id", hqAuthCheck, hqAdminCheck, employeeController.deleteEmployee);

// ==================== LOG_HQ ROUTES ====================
router.get("/hq/logs", hqAuthCheck, logController.getAllLogs);
router.get("/hq/logs/:id", hqAuthCheck, logController.getLogById);
router.post("/hq/logs", logController.createLog);
router.put("/hq/logs/:id", hqAuthCheck, hqAdminCheck, logController.updateLog);
router.delete("/hq/logs/:id", hqAuthCheck, hqAdminCheck, logController.deleteLog);

module.exports = router;
