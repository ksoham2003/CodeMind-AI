const express = require('express');
const router = express.Router();
const { addGithubRepository, getRepository } = require('../controllers/repositoryController');

router.post('/github', addGithubRepository);
router.get('/:id', getRepository);

module.exports = router;
