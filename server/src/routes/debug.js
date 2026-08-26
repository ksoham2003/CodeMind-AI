const express = require('express');
const router = express.Router();

const { getEmbeddingMetrics } = require('../services/embeddingService');
const { getRedis } = require('../config/redis');
const { protect } = require('../middleware/authMiddleware');

// Redis key for storing historical snapshots
const EMBEDDING_METRICS_HISTORY_KEY = process.env.EMBEDDING_METRICS_HISTORY_KEY || 'embeddings:metrics:history';
const EMBEDDING_METRICS_HISTORY_MAX = parseInt(process.env.EMBEDDING_METRICS_HISTORY_MAX || '720', 10); // keep last 720 samples by default

// All debug routes require authentication
router.use(protect);

router.get('/providers', (req, res) => {
  const embeddingProvider = (process.env.EMBEDDING_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : (process.env.GEMINI_API_KEY ? 'gemini' : 'none'))).toLowerCase();
  const llmProvider = (process.env.LLM_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : (process.env.GROQ_API_KEY ? 'groq' : 'none'))).toLowerCase();

  res.json({
    success: true,
    embeddingProvider,
    llmProvider,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasGroqKey: !!process.env.GROQ_API_KEY,
  });
});

router.get('/embeddings-metrics', async (req, res) => {
  try {
    const metrics = await getEmbeddingMetrics();
    res.json({ success: true, metrics });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to read embedding metrics', error: e.message });
  }
});

// POST /api/debug/embeddings-metrics/snapshot
// Take a snapshot of current embedding metrics and persist in Redis list
router.post('/embeddings-metrics/snapshot', async (req, res) => {
  try {
    const metrics = await getEmbeddingMetrics();
    const redis = getRedis();
    const snapshot = Object.assign({}, metrics, { ts: Date.now() });
    await redis.lpush(EMBEDDING_METRICS_HISTORY_KEY, JSON.stringify(snapshot));
    await redis.ltrim(EMBEDDING_METRICS_HISTORY_KEY, 0, EMBEDDING_METRICS_HISTORY_MAX - 1);
    res.json({ success: true, snapshot });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to snapshot embedding metrics', error: e.message });
  }
});

// GET /api/debug/embeddings-metrics/history
// Query params: ?limit=100 or ?since=timestamp
router.get('/embeddings-metrics/history', async (req, res) => {
  try {
    const redis = getRedis();
    const limit = Math.min(1000, parseInt(req.query.limit || '200', 10));
    const raw = await redis.lrange(EMBEDDING_METRICS_HISTORY_KEY, 0, limit - 1);
    const rows = raw.map((r) => {
      try { return JSON.parse(r); } catch (e) { return null; }
    }).filter(Boolean);

    // If since provided, filter
    const since = req.query.since ? parseInt(req.query.since, 10) : null;
    const filtered = since ? rows.filter((r) => r.ts && r.ts >= since) : rows;

    res.json({ success: true, rows: filtered });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to read embedding metrics history', error: e.message });
  }
});

router.get('/embeddings-cost', async (req, res) => {
  try {
    const metrics = await getEmbeddingMetrics();
    // Allow operator to configure a per-1k embedding cost in USD
    const costPer1k = parseFloat(process.env.EMBEDDING_COST_PER_1K_USD || '') || null;
    let estimatedCostUsd = null;
    if (costPer1k !== null) {
      // Use total request count as proxy for number of embeddings generated
      const totalRequests = parseInt(metrics.requests || 0, 10);
      estimatedCostUsd = (totalRequests / 1000) * costPer1k;
    }

    res.json({ success: true, metrics, costPer1kUSD: costPer1k, estimatedCostUsd });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to compute embedding costs', error: e.message });
  }
});

module.exports = router;
