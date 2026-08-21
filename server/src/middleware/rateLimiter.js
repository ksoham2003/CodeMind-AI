const { getRedis } = require('../config/redis');

/**
 * Redis-backed fixed-window rate limiter middleware.
 * Supports per-user, per-tenant, and per-IP limits.
 * Env vars:
 * - RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW (default per-user/ip)
 * - TENANT_RATE_LIMIT_REQUESTS, TENANT_RATE_LIMIT_WINDOW (per-tenant override)
 */
module.exports = function rateLimiter(options = {}) {
  const redis = getRedis();
  const requests = Number(process.env.RATE_LIMIT_REQUESTS || options.requests || 100);
  const windowSec = Number(process.env.RATE_LIMIT_WINDOW || options.window || 60);

  const tenantRequests = Number(process.env.TENANT_RATE_LIMIT_REQUESTS || options.tenantRequests || requests);
  const tenantWindowSec = Number(process.env.TENANT_RATE_LIMIT_WINDOW || options.tenantWindow || windowSec);

  return async (req, res, next) => {
    try {
      // Determine subject: prefer tenant -> user -> ip
      const tenantId = req.user && (req.user.tenantId || req.user.orgId || req.user.teamId);
      const userId = req.user && req.user.id;
      let subject;
      let limit = requests;
      let window = windowSec;

      if (tenantId) {
        subject = `tenant:${tenantId}`;
        limit = tenantRequests;
        window = tenantWindowSec;
      } else if (userId) {
        subject = `user:${userId}`;
        limit = requests;
        window = windowSec;
      } else {
        subject = `ip:${req.ip}`;
        limit = requests;
        window = windowSec;
      }

      const key = `ratelimit:${subject}`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, window);
      }

      const ttl = await redis.ttl(key);
      const remaining = Math.max(0, limit - current);

      // Standard rate limit headers
      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(remaining));
      res.set('X-RateLimit-Reset', String(Date.now() + (ttl > 0 ? ttl : window) * 1000));

      if (current > limit) {
        res.set('Retry-After', String(ttl > 0 ? ttl : window));
        return res.status(429).json({ success: false, message: 'Rate limit exceeded' });
      }

      return next();
    } catch (err) {
      console.error('Rate limiter error:', err);
      return next();
    }
  };
};
