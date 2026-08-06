const express = require('express');
const router = express.Router();
const { sendMessage, getChatHistory } = require('../controllers/chatController');

router.post('/', sendMessage);
router.get('/history/:projectId', getChatHistory);

module.exports = router;
