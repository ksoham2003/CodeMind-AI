const express = require('express');
const { visualizeArchitecture, getArchitecture } = require('../controllers/architectureController');
const { protect: authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// POST /api/architecture/visualize - Generate architecture diagram
router.post('/visualize', authMiddleware, visualizeArchitecture);

// GET /api/architecture/:projectId - Get existing architecture
router.get('/:projectId', authMiddleware, getArchitecture);

module.exports = router;
