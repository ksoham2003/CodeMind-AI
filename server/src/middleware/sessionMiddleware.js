const session = require('express-session');
const createRedisStore = require('connect-redis');
const { getRedis } = require('../config/redis');

/**
 * Returns session middleware configured with Redis store when enabled.
 * Enable by setting `SESSIONS_ENABLED=true` in env.
 */
const sessionMiddleware = (app) => {
  if (process.env.SESSIONS_ENABLED !== 'true') {
    return (req, res, next) => next();
  }

  const RedisStore = createRedisStore(session);
  const redisClient = getRedis();

  // trust proxy when behind a load balancer (set externally if needed)
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }

  return session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || 'fallback_session_secret_12345',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  });
};

module.exports = sessionMiddleware;
