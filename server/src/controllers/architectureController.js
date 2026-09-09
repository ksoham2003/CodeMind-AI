const Project = require('../models/Project');
const Chunk = require('../models/Chunk');
const { generateArchitectureDiagram } = require('../services/llmService');

/**
 * GET /api/architecture/:projectId
 * Retrieve or generate an architecture diagram for a project
 */
async function getArchitecture(req, res, next) {
  try {
    const { projectId } = req.params;
    
    const project = await Project.findOne({ _id: projectId, owner: req.user._id });
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    if (project.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `Repository is not ready for visualization. Current status: ${project.status}. Please wait for indexing to complete.`,
      });
    }

    // Fetch chunks from MongoDB (populated during indexing)
    const chunks = await Chunk.find({ project: projectId }).limit(50).lean();

    if (!chunks || chunks.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No indexed code chunks found. Please wait for indexing to complete.',
      });
    }

    // Convert MongoDB chunks to the format expected by generateArchitectureDiagram
    const formattedChunks = chunks.map(c => {
      const metadata = c.metadata || {};
      return {
        text: c.text || c.content || '',
        metadata: {
          path: c.path || metadata.path || '',
          functionName: c.functionName || metadata.functionName || '',
          className: c.className || metadata.className || '',
          chunkType: c.chunkType || metadata.chunkType || 'code',
          startLine: c.startLine || metadata.startLine || 0,
          endLine: c.endLine || metadata.endLine || 0,
          content: (c.text || c.content || '').slice(0, 1500),
        }
      };
    });

    const result = await generateArchitectureDiagram(formattedChunks, projectId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/architecture/visualize
 * Generate a Mermaid diagram from the project code
 */
async function visualizeArchitecture(req, res, next) {
  try {
    const { projectId, diagramType = 'component' } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'projectId is required',
      });
    }

    const project = await Project.findOne({ _id: projectId, owner: req.user._id });
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    if (project.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `Repository is not ready for visualization. Current status: ${project.status}. Please wait for indexing to complete.`,
      });
    }

    // Fetch chunks from MongoDB (populated during indexing)
    const chunks = await Chunk.find({ project: projectId }).limit(50).lean();

    if (!chunks || chunks.length === 0) {
      return res.json({
        success: true,
        graph: {
          nodes: [
            { id: 'A', label: 'No code chunks found' },
            { id: 'B', label: 'Please complete repository indexing' },
          ],
          edges: [
            { id: 'e-A-B', source: 'A', target: 'B' },
          ],
          direction: 'LR',
        },
        summary: 'No indexed code found. Complete indexing to generate architecture diagram.',
        message: 'Repository indexing is still in progress or no code was indexed.'
      });
    }

    // Convert MongoDB chunks to the format expected by generateArchitectureDiagram
    const formattedChunks = chunks.map(c => {
      const metadata = c.metadata || {};
      return {
        text: c.text || c.content || '',
        metadata: {
          path: c.path || metadata.path || '',
          functionName: c.functionName || metadata.functionName || '',
          className: c.className || metadata.className || '',
          chunkType: c.chunkType || metadata.chunkType || 'code',
          startLine: c.startLine || metadata.startLine || 0,
          endLine: c.endLine || metadata.endLine || 0,
          content: (c.text || c.content || '').slice(0, 1500),
        }
      };
    });

    const result = await generateArchitectureDiagram(formattedChunks, projectId, diagramType);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getArchitecture,
  visualizeArchitecture,
};
