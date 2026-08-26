const express = require('express');
const router = express.Router();
const { sendMessage, getChatHistory, streamMessage } = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/', sendMessage);
router.get('/history/:projectId', getChatHistory);
router.post('/stream', streamMessage);

module.exports = router;
