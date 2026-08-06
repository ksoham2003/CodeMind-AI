const { v4: uuidv4 } = require('uuid');
const Project = require('../models/Project');
const { parseGithubUrl } = require('../services/githubService');

/**
 * POST /api/repository/github
 * Body: { url, name? }
 */
const addGithubRepository = async (req, res) => {
  const { url, name } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, message: 'GitHub URL is required' });
  }

  // Validate URL format
  let parsed;
  try {
    parsed = parseGithubUrl(url);
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }

  const repoName = name || `${parsed.owner}/${parsed.repo}`;
  const repoId = `${parsed.owner}-${parsed.repo}-${uuidv4().slice(0, 8)}`;

  // Check for existing project with same URL (to avoid duplicate indexing)
  const existing = await Project.findOne({ githubUrl: url, owner: req.user._id, status: 'ready' });
  if (existing) {
    return res.status(200).json({
      success: true,
      message: 'Repository already indexed',
      project: existing,
      alreadyExists: true,
    });
  }

  const project = await Project.create({
    owner: req.user._id,
    name: repoName,
    githubUrl: url,
    repoId,
    status: 'pending',
  });

  res.status(201).json({
    success: true,
    message: 'Repository registered. Start indexing to process it.',
    project,
  });
};

/**
 * GET /api/repository/:id
 */
const getRepository = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }
  res.json({ success: true, project });
};

module.exports = { addGithubRepository, getRepository };
