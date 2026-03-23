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
  getActiveBranches,
} = require("../controllers/auth");

const { authCheck, adminCheck } = require("../middlewares/authCheck");
const { verifyCsrf } = require("../middlewares/csrf");
const { loginLimiter } = require("../middlewares/rateLimiter");

// Zod Validation
const { validate } = require("../middlewares/validate");
const { registerSchema, loginSchema, changePasswordSchema } = require("../schemas/authSchema");

router.post("/register", validate(registerSchema), register);
router.post("/login", loginLimiter, validate(loginSchema), login);

// @ENDPOINT  GET /api/active-branches (Public route for login page)
router.get("/active-branches", getActiveBranches);

router.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: req.csrfToken || null });
});
router.post("/refresh-token", refreshToken);
router.post("/logout", verifyCsrf, logout);
router.post("/change-password", authCheck, verifyCsrf, validate(changePasswordSchema), changePassword);

router.post("/current-user", authCheck, currentUser);
router.post("/current-admin", authCheck, adminCheck, currentAdmin);

module.exports = router;
