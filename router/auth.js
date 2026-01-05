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
const { verifyCsrf } = require("../middlewares/csrf");
const { loginLimiter } = require("../middlewares/rateLimiter");

router.post("/register", register);
router.post("/login", loginLimiter, login);
router.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: req.csrfToken || null });
});
router.post("/refresh-token", verifyCsrf, refreshToken);
router.post("/logout", verifyCsrf, logout);
router.post("/change-password", authCheck, verifyCsrf, changePassword);

router.post("/current-user", authCheck, currentUser);
router.post("/current-admin", authCheck, adminCheck, currentAdmin);

module.exports = router;
