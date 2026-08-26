const { Queue } = require('bullmq');
const { getRedis } = require('../config/redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let queue = null;
const getQueue = () => {
  if (!queue) {
    // BullMQ can accept connection options or ioredis instance; pass URL for simplicity
    queue = new Queue('embed-on-demand', { connection: REDIS_URL });
  }
  return queue;
};

const addEmbedJob = async (data, opts = {}) => {
  const q = getQueue();
  const job = await q.add('embed', data, opts);
  return job;
};

module.exports = { getQueue, addEmbedJob };
