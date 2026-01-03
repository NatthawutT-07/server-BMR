const express = require("express");
const router = express.Router();

const {
  register,
  login,
  currentUser,
  currentAdmin,
  refreshToken,
  logout,
  changePassword,
} = require("../controllers/auth");

const { authCheck, adminCheck } = require("../middlewares/authCheck");
const { loginLimiter } = require("../middlewares/rateLimiter");

router.post("/register", register);
router.post("/login", loginLimiter, login);
router.post("/refresh-token", refreshToken);
router.post("/logout", logout);
router.post("/change-password", authCheck, changePassword);

router.post("/current-user", authCheck, currentUser);
router.post("/current-admin", authCheck, adminCheck, currentAdmin);

module.exports = router;
