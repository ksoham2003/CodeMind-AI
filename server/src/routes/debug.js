const express = require('express');
const router = express.Router();

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

module.exports = router;
