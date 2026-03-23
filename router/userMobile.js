const express = require("express");
const router = express.Router();

const { lookupByBarcode } = require("../controllers/user/lookup");
const { getShelfBlocks } = require("../controllers/user/shelfBlocks");

router.get("/lookup", lookupByBarcode);
router.get("/shelf-blocks", getShelfBlocks);


module.exports = router;
