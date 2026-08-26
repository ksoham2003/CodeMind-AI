require('dotenv').config();
require('express-async-errors');

// Fail fast on missing critical secrets
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getRedis } = require('./config/redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const rateLimiter = require('./middleware/rateLimiter');
const sessionMiddleware = require('./middleware/sessionMiddleware');
// Optionally start the worker in-process when START_WORKER=true
if (process.env.START_WORKER === 'true') {
  try {
    require('./workers/embedWorker');
    require('./workers/batchQaWorker');
    console.log('Worker started in-process');
  } catch (err) {
    console.error('Failed to start worker in-process:', err);
  }
}

// Optional metrics snapshotter (persist embedding metrics for dashboards)
if (process.env.METRICS_SNAPSHOTTER_ENABLED === 'true') {
  try {
    const snapshotter = require('./services/metricsSnapshotter');
    snapshotter.start();
  } catch (err) {
    console.warn('Failed to start metrics snapshotter:', err && err.message ? err.message : err);
  }
}

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// Routes
const repositoryRoutes = require('./routes/repository');
const indexRoutes = require('./routes/index');
const chatRoutes = require('./routes/chat');
const projectRoutes = require('./routes/projects');
const authRoutes = require('./routes/auth');
const architectureRoutes = require('./routes/architecture');
const jobsRoutes = require('./routes/jobs');
const debugRoutes = require('./routes/debug');
const embedRoutes = require('./routes/embed');
const jwt = require('jsonwebtoken');

// Controllers that need Socket.io injected
const { setIo } = require('./controllers/indexController');

// ── App Setup ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost',
  'http://localhost:5173',
  'http://127.0.0.1',
  'http://127.0.0.1:5173',
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Inject io into indexController
setIo(io);

// Configure Socket.io Redis adapter for scaling (best-effort)
(async () => {
  try {
    const redis = getRedis();
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    await pubClient.connect();
    await subClient.connect();
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.io Redis adapter configured');
  } catch (err) {
    console.warn('Socket.io Redis adapter not configured:', err.message || err);
  }
})();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Session middleware (optional, enabled with SESSIONS_ENABLED=true)
app.use(sessionMiddleware(app));

// Apply rate limiter to API routes
app.use('/api', rateLimiter());

// ── Ensure temp directory ─────────────────────────────────────────────────────
const tempDir = path.join(__dirname, '..', process.env.TEMP_DIR || 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/repository', repositoryRoutes);
app.use('/api/index', indexRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/architecture', architectureRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/embed', embedRoutes);

// Serving frontend build assets in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    // Only serve index.html for non-API routes
    if (!req.originalUrl.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    } else {
      res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
    }
  });
} else {
  // 404 handler for development
  app.use('*', (req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
  });
}

// Global error handler (must be last)
app.use(errorHandler);

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id} (User: ${socket.user.id})`);

  // Client joins a room for their project to receive progress updates
  socket.on('join:project', (projectId) => {
    socket.join(projectId);
    console.log(`📁 Socket ${socket.id} joined room: ${projectId}`);
  });

  socket.on('leave:project', (projectId) => {
    socket.leave(projectId);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`\n🚀 CodeMind AI Server running on http://localhost:${PORT}`);
    console.log(`📡 Socket.io ready`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
