const express = require('express');
const router = express.Router();

const { getEmbeddingMetrics } = require('../services/embeddingService');

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
