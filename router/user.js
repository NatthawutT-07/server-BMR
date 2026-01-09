const express = require('express');
const { authCheck } = require('../middlewares/authCheck');
const { UserTemplateItem, getStockLastUpdate, getBranchShelves } = require('../controllers/user/template');
const { createPogRequest, getMyPogRequests, deleteMyPogRequest } = require('../controllers/user/pogRequest');
const router = express.Router()


router.post('/template-item', authCheck, UserTemplateItem);
router.get("/stock-last-update", authCheck, getStockLastUpdate);
router.get("/branch-shelves", authCheck, getBranchShelves); // ✅ ดึง shelf templates ของสาขา

// POG Request routes (for user)
router.post('/pog-request', authCheck, createPogRequest);
router.get('/pog-request', authCheck, getMyPogRequests);
router.delete('/pog-request/:id', authCheck, deleteMyPogRequest);

module.exports = router;

