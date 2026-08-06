const Project = require('../models/Project');
const { runIndexingPipeline } = require('../services/indexingService');

// Store reference to the Socket.io server (injected at startup)
let ioInstance = null;
const setIo = (io) => { ioInstance = io; };

/**
 * POST /api/index/start
 * Body: { projectId }
 */
const startIndexing = async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ success: false, message: 'projectId is required' });
  }

  const project = await Project.findById(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  if (project.status === 'ready') {
    return res.status(200).json({ success: true, message: 'Already indexed', project });
  }

  if (['cloning', 'parsing', 'embedding', 'indexing'].includes(project.status)) {
    return res.status(200).json({ success: true, message: 'Indexing already in progress', project });
  }

  // Acknowledge immediately, run pipeline in background
  res.status(202).json({
    success: true,
    message: 'Indexing started',
    project,
  });

  // Fire-and-forget — errors are caught inside and emitted via socket
  runIndexingPipeline(projectId, ioInstance).catch((err) => {
    console.error('Pipeline error (caught at controller):', err.message);
  });
};

/**
 * GET /api/index/status/:projectId
 */
const getIndexingStatus = async (req, res) => {
  const project = await Project.findById(req.params.projectId).select(
    'status errorMessage fileCount chunkCount indexedAt'
  );
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }
  res.json({ success: true, project });
};

module.exports = { startIndexing, getIndexingStatus, setIo };
