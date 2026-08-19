const Redis = require('ioredis');

let client = null;

const getRedis = () => {
  if (!client) {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    // Use lazyConnect so the app doesn't crash if Redis is unavailable at startup
    client = new Redis(url, { lazyConnect: true, enableOfflineQueue: true });
    client.on('error', (err) => console.error('Redis error:', err));
    // attempt to connect in background
    client.connect().catch((err) => {
      console.warn('Redis connect failed (will retry):', err.message || err);
    });
  }
  return client;
};

module.exports = { getRedis };
