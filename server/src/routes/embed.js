const express = require('express');
const router = express.Router();
const { onDemandEmbed } = require('../controllers/embedController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/on-demand', onDemandEmbed);

module.exports = router;
