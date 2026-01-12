const express = require('express');
const { authCheck } = require('../middlewares/authCheck');
const { UserTemplateItem, getStockLastUpdate, getBranchShelves } = require('../controllers/user/template');
const { createPogRequest, getMyPogRequests, cancelMyPogRequest } = require('../controllers/user/pogRequest');
const router = express.Router()


router.post('/template-item', authCheck, UserTemplateItem);
router.get("/stock-last-update", authCheck, getStockLastUpdate);
router.get("/branch-shelves", authCheck, getBranchShelves); // ✅ ดึง shelf templates ของสาขา

// POG Request routes (for user)
router.post('/pog-request', authCheck, createPogRequest);
router.get('/pog-request', authCheck, getMyPogRequests);
router.patch('/pog-request/:id/cancel', authCheck, cancelMyPogRequest); // ✅ ยกเลิก (ไม่ลบ)

module.exports = router;

