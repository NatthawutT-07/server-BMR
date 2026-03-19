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
const router = express.Router()


router.post('/template-item', authCheck, UserTemplateItem);
router.get("/stock-last-update", authCheck, getStockLastUpdate);
router.get("/branch-shelves", authCheck, getBranchShelves); // ✅ ดึง shelf templates ของสาขา

// POG Request routes (for user)
router.post('/pog-request', authCheck, createPogRequest);
router.get('/pog-request', authCheck, getMyPogRequests);
router.patch('/pog-request/:id/cancel', authCheck, cancelMyPogRequest); // ✅ ยกเลิก (ไม่ลบ)

// ✅ Register Product routes (ลงทะเบียนสินค้าโดยตรง)
router.get('/register/check-product', authCheck, checkProductExists);
router.get('/register/shelves', authCheck, getShelvesForRegister);
router.get('/register/next-index', authCheck, getNextIndex);
router.post('/register/product', authCheck, registerProduct);

// ✅ Shelf Change Logs Notification - for user web
const { getShelfChangeLogs, acknowledgeChangeLog, acknowledgeAllChangeLogs } = require('../controllers/admin/shelfUpdate');
router.get("/shelf-change-logs/:branchCode", authCheck, getShelfChangeLogs);
router.post("/shelf-change-log-acknowledge/:id", authCheck, acknowledgeChangeLog);
router.post("/shelf-change-logs-acknowledge-all/:branchCode", authCheck, acknowledgeAllChangeLogs);

module.exports = router;

