const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getJobStatus } = require('../controllers/jobsController');
const { enqueueBatchQA } = require('../controllers/batchQaController');

router.get('/:id', protect, getJobStatus);
router.post('/batch-qa', protect, enqueueBatchQA);

module.exports = router;
