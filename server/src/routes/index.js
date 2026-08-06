const express = require('express');
const router = express.Router();
const { startIndexing, getIndexingStatus } = require('../controllers/indexController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/start', startIndexing);
router.get('/status/:projectId', getIndexingStatus);

module.exports = router;
