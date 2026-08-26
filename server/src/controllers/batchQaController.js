const Project = require('../models/Project');
const { jobsQueue } = require('../queues/queue');
const { protect } = require('../middleware/authMiddleware');

/**
 * POST /api/jobs/batch-qa
 * Body: { projectId, questions: [string] }
 * Enqueues a batch Q/A job that will run each question against the repository and persist results.
 */
const enqueueBatchQA = async (req, res) => {
  const { projectId, questions } = req.body || {};
  if (!projectId || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ success: false, message: 'projectId and questions[] required' });
  }

  const project = await Project.findById(projectId);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  // Enqueue job with questions and projectId
  const attempts = parseInt(process.env.BATCH_QA_ATTEMPTS || '3', 10);
  const backoffMs = parseInt(process.env.BATCH_QA_BACKOFF_MS || '500', 10);
  const job = await jobsQueue.add(
    'batch-qa',
    { projectId, questions, requester: req.user._id },
    { removeOnComplete: true, removeOnFail: false, attempts, backoff: { type: 'exponential', delay: backoffMs } }
  );

  return res.status(202).json({ success: true, message: 'Batch QA enqueued', jobId: job.id });
};

module.exports = { enqueueBatchQA };
