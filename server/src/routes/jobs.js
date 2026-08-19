const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getJobStatus } = require('../controllers/jobsController');

router.get('/:id', protect, getJobStatus);

module.exports = router;
