const express = require('express');
const router = express.Router();
const { visualizeArchitecture } = require('../controllers/architectureController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/visualize', visualizeArchitecture);

module.exports = router;
