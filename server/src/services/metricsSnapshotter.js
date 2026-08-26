const { getEmbeddingMetrics } = require('./embeddingService');
const { getRedis } = require('../config/redis');

const KEY = process.env.EMBEDDING_METRICS_HISTORY_KEY || 'embeddings:metrics:history';
const MAX = parseInt(process.env.EMBEDDING_METRICS_HISTORY_MAX || '720', 10);
const INTERVAL_MS = parseInt(process.env.METRICS_SNAPSHOT_INTERVAL_MS || String(5 * 60 * 1000), 10); // default 5 minutes

let timer = null;

const takeSnapshot = async () => {
  try {
    const metrics = await getEmbeddingMetrics();
    const redis = getRedis();
    const snapshot = Object.assign({}, metrics, { ts: Date.now() });
    await redis.lpush(KEY, JSON.stringify(snapshot));
    await redis.ltrim(KEY, 0, MAX - 1);
    console.log('Metrics snapshot saved:', new Date(snapshot.ts).toISOString());
  } catch (err) {
    console.warn('Failed to take metrics snapshot:', err && err.message ? err.message : err);
  }
};

const start = () => {
  if (timer) return;
  console.log('Starting metrics snapshotter: interval', INTERVAL_MS, 'ms');
  // take an immediate snapshot, then schedule
  takeSnapshot();
  timer = setInterval(takeSnapshot, INTERVAL_MS);
};

const stop = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

module.exports = { start, stop };
