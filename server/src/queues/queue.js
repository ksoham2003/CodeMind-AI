const { Queue, QueueScheduler } = require('bullmq');
const url = require('url');

// Resolve Redis connection information from REDIS_URL
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
let connectionOptions;
try {
  const parsed = new url.URL(redisUrl);
  connectionOptions = { host: parsed.hostname, port: Number(parsed.port || 6379) };
} catch (err) {
  console.warn('Invalid REDIS_URL, falling back to host redis and port 6379', err.message || err);
  connectionOptions = { host: 'redis', port: 6379 };
}
console.log('BullMQ connecting to Redis at', `${connectionOptions.host}:${connectionOptions.port}`);

// Create a named queue for background jobs
const jobsQueue = new Queue('codemind-jobs', { connection: connectionOptions });
const jobsScheduler = new QueueScheduler('codemind-jobs', { connection: connectionOptions });

module.exports = { jobsQueue, jobsScheduler };
