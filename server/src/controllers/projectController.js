const Project = require('../models/Project');
const Chat = require('../models/Chat');
const { deleteRepositoryVectors } = require('../services/pineconeService');
const { deleteRepository } = require('../services/githubService');

/**
 * GET /api/projects
 */
const getAllProjects = async (req, res) => {
  const projects = await Project.find({ owner: req.user._id })
    .sort({ createdAt: -1 })
    .select('-fileTree -__v');

  res.json({ success: true, projects });
};

/**
 * GET /api/projects/:id
 */
const getProject = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }
  res.json({ success: true, project });
};

/**
 * DELETE /api/projects/:id
 * Removes project, all chats, all Pinecone vectors, and any temp files
 */
const deleteProject = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  // Delete in parallel
  await Promise.allSettled([
    deleteRepositoryVectors(project.repoId),
    Chat.deleteMany({ projectId: project._id, owner: req.user._id }),
    deleteRepository(project.repoId),
  ]);

  await project.deleteOne();

  res.json({ success: true, message: 'Project deleted successfully' });
};

module.exports = { getAllProjects, getProject, deleteProject };
