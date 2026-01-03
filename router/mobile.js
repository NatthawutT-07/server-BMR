const express = require("express");
const router = express.Router();



const { authCheck, adminCheck } = require("../middlewares/authCheck");
const { loginLimiter } = require("../middlewares/rateLimiter");

const { lookupByBarcode } = require("../controllers/mobile/locations");
const { getShelfBlocks } = require("../controllers/mobile/shelfBlocks");

router.get("/lookup", lookupByBarcode);
router.get("/shelf-blocks", getShelfBlocks);


module.exports = router;