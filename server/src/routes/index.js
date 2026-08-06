const express = require('express');
const router = express.Router();
const { startIndexing, getIndexingStatus } = require('../controllers/indexController');

router.post('/start', startIndexing);
router.get('/status/:projectId', getIndexingStatus);

module.exports = router;
