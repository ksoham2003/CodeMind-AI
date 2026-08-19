const { Queue, Worker, QueueScheduler } = require('bullmq');
const { getRedis } = require('../config/redis');

const connection = (() => {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  return { connection: { url: redisUrl } };
})();

// Create a named queue for background jobs
const jobsQueue = new Queue('codemind-jobs', { connection: connection.connection });
const jobsScheduler = new QueueScheduler('codemind-jobs', { connection: connection.connection });

module.exports = { jobsQueue, jobsScheduler, Worker, QueueScheduler };
