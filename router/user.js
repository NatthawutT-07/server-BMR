const express = require('express');
const { authCheck } = require('../middlewares/authCheck');
const { UserTemplateItem, getStockLastUpdate, getBranchShelves } = require('../controllers/user/template');
const { createPogRequest, getMyPogRequests, cancelMyPogRequest } = require('../controllers/user/pogRequest');
const {
    checkProductExists,
    getShelvesForRegister,
    getNextIndex,
    registerProduct
} = require('../controllers/user/registerProduct');
const upload = require('../config/multerConfig');
const { uploadStockXLSX } = require('../controllers/admin/upload/uploadController');
const router = express.Router()


router.post("/shelf-templates/items", authCheck, UserTemplateItem);
router.post('/upload-stock', authCheck, upload.single('file'), uploadStockXLSX);
router.get("/stock-last-update", authCheck, getStockLastUpdate);
router.get("/branch-shelves", authCheck, getBranchShelves);

// POG Request routes (for user)
router.post('/pog-request', authCheck, createPogRequest);
router.get('/pog-request', authCheck, getMyPogRequests);
router.patch('/pog-request/:id/cancel', authCheck, cancelMyPogRequest);

// Register Product routes (ลงทะเบียนสินค้าโดยตรง)
router.get("/products/check", authCheck, checkProductExists);
router.get('/register/shelves', authCheck, getShelvesForRegister);
router.get('/register/next-index', authCheck, getNextIndex);
router.post('/register/product', authCheck, registerProduct);

// Shelf Change Logs Notification - for user web
const { getShelfChangeLogs, acknowledgeChangeLog, acknowledgeAllChangeLogs } = require('../controllers/admin/shelfUpdate');
router.get("/shelf-change-logs/:branch_code", authCheck, getShelfChangeLogs);
router.post("/shelf-change-log-acknowledge/:id", authCheck, acknowledgeChangeLog);
router.post("/shelf-change-logs-acknowledge-all/:branch_code", authCheck, acknowledgeAllChangeLogs);

module.exports = router;

