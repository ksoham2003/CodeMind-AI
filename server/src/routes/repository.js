const express = require('express');
const router = express.Router();
const { addGithubRepository, getRepository } = require('../controllers/repositoryController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/github', addGithubRepository);
router.get('/:id', getRepository);

module.exports = router;
