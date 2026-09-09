const path = require('path');

let llmService = null;
try {
  llmService = require('./llmService');
} catch (e) {
  console.warn('llmService require failed in wrapper:', e && e.message ? e.message : e);
}
const localLlm = require('./localLlmService');

// (exports defined at end)

// Provide safe wrappers for generateAnswer and streamAnswer
const generateAnswer = async (question, retrievedChunks, repoName) => {
  if (llmService && typeof llmService.generateAnswer === 'function') {
    return llmService.generateAnswer(question, retrievedChunks, repoName);
  }

  // Fallback: call local LLM with a simple prompt
  try {
    const j = await localLlm.generate(`Question: ${question}\n\nContext: ${JSON.stringify(retrievedChunks || []).slice(0, 2000)}`, { model: 'local' });
    return { answer: j.text || j.output || '', tokensUsed: j.tokens || 0 };
  } catch (e) {
    return { answer: "Local LLM unavailable.", tokensUsed: 0 };
  }
};

const streamAnswer = async function* (question, retrievedChunks, repoName) {
  if (llmService && typeof llmService.streamAnswer === 'function') {
    for await (const c of llmService.streamAnswer(question, retrievedChunks, repoName)) {
      yield c;
    }
    return;
  }

  // Fallback: stream from localLlm if available
  try {
    for await (const chunk of localLlm.stream(`Question: ${question}\n\nContext: ${JSON.stringify(retrievedChunks || []).slice(0, 2000)}`, { model: 'local' })) {
      yield chunk;
    }
  } catch (e) {
    yield 'Local LLM streaming unavailable.';
  }
};

module.exports = { generateAnswer, streamAnswer };
