const Project = require('../models/Project');
const { embedText } = require('../services/embeddingService');
const { querySimilar } = require('../services/pineconeService');
const { generateArchitectureDiagram } = require('../services/llmService');
const { jobsQueue } = require('../queues/queue');

/**
 * POST /api/architecture/visualize
 * Body: { projectId, diagramType? }
 *
 * diagramType: 'component' | 'dependency' | 'api-routes' (default: 'component')
 *
 * Queries Pinecone broadly across the repo, then asks the LLM
 * to produce a Mermaid diagram summarising the codebase structure.
 */
const visualizeArchitecture = async (req, res) => {
  const { projectId, diagramType = 'component' } = req.body;

  if (!projectId) {
    return res.status(400).json({ success: false, message: 'projectId is required' });
  }

  try {
    const project = await Project.findOne({ _id: projectId, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (project.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `Repository is not ready. Current status: ${project.status}`,
      });
    }

    // Build a broad query to capture overall structure
    const structureQueries = {
      component: 'main application entry point, component hierarchy, module exports, imports, and routing structure',
      dependency: 'import statements, require calls, module dependencies, and package usage across all files',
      'api-routes': 'express routes, API endpoints, controllers, middleware, request handlers, and service layer',
    };

    const queryText = structureQueries[diagramType] || structureQueries.component;
    const queryVector = await embedText(queryText);

    // Fetch more chunks than usual to get a broad view
    const matches = await querySimilar(queryVector, project.repoId, 20);

    if (matches.length === 0) {
      return res.json({
        success: true,
        graph: {
          nodes: [
            { id: 'A', label: 'No code chunks found' },
            { id: 'B', label: 'Try again or re-index the repository' },
          ],
          edges: [
            { id: 'e-A-B', source: 'A', target: 'B' },
          ],
          direction: 'LR',
        },
        summary: 'No indexed code chunks were found for this repository.',
      });
    }

    // If queueing is enabled, enqueue job and return job id
    if (process.env.USE_QUEUE === 'true') {
      const job = await jobsQueue.add('generate-architecture', {
        retrievedChunks: matches,
        repoName: project.name,
        diagramType,
        fileTree: project.fileTree,
      });

      return res.status(202).json({ success: true, jobId: job.id, message: 'Job queued' });
    }

    // Generate the architecture diagram via LLM (synchronous fallback)
    const { graph, summary, tokensUsed } = await generateArchitectureDiagram(
      matches,
      project.name,
      diagramType,
      project.fileTree
    );

    return res.json({
      success: true,
      graph,
      summary,
      diagramType,
      tokensUsed,
    });
  } catch (err) {
    // Log full error for debugging
    console.error('❌ Architecture visualize error (full):', err);
    console.error(err && err.stack ? err.stack : 'no stack');

    // If it's a known quota error from provider, forward 429
    if (err && (err.status === 429 || (err.error && err.error.code === 429))) {
      return res.status(429).json({
        success: false,
        message: 'AI quota exceeded. Please try again later.',
        details: err && err.message ? err.message : undefined,
      });
    }

    // Return the original error message as well for easier debugging in dev
    return res.status(500).json({
      success: false,
      message: 'Failed to generate architecture diagram. Please try again.',
      error: err && (err.message || err.toString()) ? (err.message || err.toString()) : undefined,
    });
  }
};

module.exports = { visualizeArchitecture };
