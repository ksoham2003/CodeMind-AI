const { getRedis } = require('../config/redis');

/**
 * Simple Redis-backed fixed-window rate limiter middleware.
 * Configurable via env: RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW (seconds)
 */
module.exports = function rateLimiter(options = {}) {
  const redis = getRedis();
  const requests = Number(process.env.RATE_LIMIT_REQUESTS || options.requests || 100);
  const windowSec = Number(process.env.RATE_LIMIT_WINDOW || options.window || 60);

  return async (req, res, next) => {
    try {
      const key = `ratelimit:${req.ip}`;
      const ttlKey = `${key}:ttl`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSec);
      }

      if (current > requests) {
        const ttl = await redis.ttl(key);
        res.set('Retry-After', String(ttl > 0 ? ttl : windowSec));
        return res.status(429).json({ success: false, message: 'Rate limit exceeded' });
      }

      return next();
    } catch (err) {
      console.error('Rate limiter error:', err);
      return next();
    }
  };
};
