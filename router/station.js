const express = require('express');
const { liststation, callStation } = require('../controllers/user/station-user');
const { authCheck } = require('../middlewares/authCheck');
const router = express.Router()


router.get('/station-list' , liststation);
router.get('/detailuser', callStation);

module.exports = router;