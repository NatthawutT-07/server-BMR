const express = require('express');
const { liststation, callStation } = require('../controllers/user/station-user');
const router = express.Router()


router.get('/post', liststation);
router.get('/detailuser', callStation);

module.exports = router;