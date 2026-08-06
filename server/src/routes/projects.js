const express = require('express');
const router = express.Router();
const { getAllProjects, getProject, deleteProject } = require('../controllers/projectController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getAllProjects);
router.get('/:id', getProject);
router.delete('/:id', deleteProject);

module.exports = router;
