const { getRedis } = require('../config/redis');
const { jobsQueue } = require('../queues/queue');

const getJobStatus = async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'job id required' });

  try {
    const job = await jobsQueue.getJob(id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    const state = await job.getState();
    const progress = job.progress || 0;
    const result = job.returnvalue || null;

    return res.json({ success: true, id: job.id, name: job.name, state, progress, result });
  } catch (err) {
    console.error('Jobs status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch job status' });
  }
};

module.exports = { getJobStatus };
