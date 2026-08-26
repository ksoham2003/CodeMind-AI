const fetch = global.fetch || require('node-fetch');

const LOCAL_LLM_URL = (process.env.LOCAL_LLM_URL || 'http://local-llm:11434').replace(/\/$/, '');
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen3-coder:30b';

/**
 * Generate text from an Ollama server via the OpenAI-compatible API.
 * POST /v1/chat/completions  (non-streaming)
 */
const generate = async (prompt, opts = {}) => {
  const url = `${LOCAL_LLM_URL}/v1/chat/completions`;
  const model = opts.model || LOCAL_LLM_MODEL;
  const temperature = opts.temperature ?? 0.1;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || '';
  const tokens = json.usage?.total_tokens || 0;
  return { text, tokens, output: text };
};

/**
 * Stream text from Ollama via the OpenAI-compatible streaming API.
 * POST /v1/chat/completions  { stream: true }
 * Yields text chunks as they arrive via SSE.
 */
async function* stream(prompt, opts = {}) {
  const url = `${LOCAL_LLM_URL}/v1/chat/completions`;
  const model = opts.model || LOCAL_LLM_MODEL;
  const temperature = opts.temperature ?? 0.1;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        stream: true,
      }),
    });
  } catch (e) {
    throw new Error(`Ollama connection failed: ${e.message}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama stream error ${res.status}: ${errText}`);
  }

  // Parse SSE stream: each line is "data: <json>" or "data: [DONE]"
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);

        if (!line || !line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch (_) {
          // skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

module.exports = { generate, stream };

