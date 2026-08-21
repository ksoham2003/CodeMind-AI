const { getEmbeddingClient } = require('../config/gemini');
const { getRedis } = require('../config/redis');
const OpenAI = require('openai');
const crypto = require('crypto');

// Determine embedding provider: explicit env `EMBEDDING_PROVIDER` or auto-detect
// Options: 'openai' | 'gemini' | 'local'
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'gemini')).toLowerCase();
// Allow overriding the exact embedding model via env. For OpenAI prefer smaller default to reduce cost.
const EMBEDDING_MODEL_OPENAI = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_MODEL_GEMINI = 'gemini-embedding-001';
const EMBEDDING_MODEL = EMBEDDING_PROVIDER === 'openai' ? EMBEDDING_MODEL_OPENAI : EMBEDDING_MODEL_GEMINI;

// Set embedding dimension dynamically based on chosen model
let EMBEDDING_DIMENSION = 3072;
if (EMBEDDING_PROVIDER === 'openai') {
  // text-embedding-3-small -> 1536, text-embedding-3-large -> 3072
  if (/small/i.test(EMBEDDING_MODEL)) EMBEDDING_DIMENSION = 1536;
  else EMBEDDING_DIMENSION = 3072;
} else {
  EMBEDDING_DIMENSION = 3072;
}
const BATCH_SIZE = 50;

let openaiClient = null;
const getOpenAIClient = () => {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set.');
    }
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

/**
 * Generate an embedding for a single text string
 * @param {string} text
 * @returns {number[]} embedding vector
 */
const embedText = async (text) => {
  const redis = getRedis();
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  const cacheKey = `embed:${hash}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      // Metrics: cache hit
      try { await redis.incr('metrics:embed:cache_hits'); } catch (e) {}
      return JSON.parse(cached);
    }
  } catch (err) {
    // ignore cache errors
    console.warn('Embedding cache read error:', err.message || err);
  }

  // Metrics: cache miss
  try { await redis.incr('metrics:embed:cache_misses'); } catch (e) {}

  // Metrics: request (we will attempt to generate an embedding)
  try { await redis.incr('metrics:embed:requests'); } catch (e) {}

  let values;
  if (EMBEDDING_PROVIDER === 'local') {
    // Call local embedding server with retry/backoff
    const localUrl = process.env.EMBEDDING_LOCAL_URL || 'http://embedding-server:8000';
    const resp = await fetchWithRetry(`${localUrl}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.replace(/\n/g, ' ') }),
    });
    if (!resp.ok) throw new Error(`Local embedding server error: ${resp.status}`);
    const data = await resp.json();
    values = data.embedding;
  } else if (EMBEDDING_PROVIDER === 'openai') {
    const client = getOpenAIClient();
    const resp = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text.replace(/\n/g, ' ') });
    values = resp.data[0].embedding;
  } else if (EMBEDDING_PROVIDER === 'gemini') {
    const gemini = getEmbeddingClient();
    const response = await gemini.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text.replace(/\n/g, ' '),
    });
    values = response.embeddings[0].values;
  } else {
    throw new Error(`Unsupported EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}`);
  }

  try {
    // Cache embeddings longer to maximize reuse across users/projects (7 days)
    await redis.set(cacheKey, JSON.stringify(values), 'EX', 60 * 60 * 24 * 7);
  } catch (err) {
    console.warn('Embedding cache write error:', err.message || err);
  }
  try {
    return values;
  } catch (e) {
    // Defensive: if anything goes wrong serializing/returning, increment error metric
    try { await redis.incr('metrics:embed:errors'); } catch (err) {}
    throw e;
  }
};

// Return basic embedding metrics from Redis
const getEmbeddingMetrics = async () => {
  const redis = getRedis();
  const keys = ['metrics:embed:requests', 'metrics:embed:cache_hits', 'metrics:embed:cache_misses', 'metrics:embed:errors', 'metrics:embed:batch_calls'];
  const res = {};
  try {
    const vals = await redis.mget(...keys);
    for (let i = 0; i < keys.length; i++) {
      res[keys[i].replace('metrics:embed:', '')] = parseInt(vals[i] || '0', 10);
    }
  } catch (e) {
    console.warn('Failed to read embedding metrics from Redis:', e.message || e);
    for (const k of keys) res[k.replace('metrics:embed:', '')] = 0;
  }
  return res;
};

// Generic fetch with retry/backoff for transient network errors
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Configurable via env vars for operational tuning
const EMBED_RETRY_ATTEMPTS = parseInt(process.env.EMBED_RETRY_ATTEMPTS || '5', 10);
const EMBED_RETRY_BASE_DELAY = parseInt(process.env.EMBED_RETRY_BASE_DELAY || '300', 10);

const fetchWithRetry = async (url, opts = {}, attempts = EMBED_RETRY_ATTEMPTS, baseDelay = EMBED_RETRY_BASE_DELAY) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, opts);
      return res;
    } catch (err) {
      lastErr = err;
      const delay = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 100);
      console.warn(`fetchWithRetry attempt ${i + 1} failed for ${url}: ${err.message || err}. Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
};

/**
 * Generate embeddings for a batch of chunks
 * @param {{ id, text, metadata }[]} chunks
 * @param {Function} onProgress - (completed, total) => void
 * @returns {{ id, values, metadata }[]} Pinecone-ready vectors
 */
const embedChunks = async (chunks, onProgress = () => {}) => {
  const vectors = [];
  const total = chunks.length;
  const redis = getRedis();

  // Deduplicate identical texts to avoid duplicate embedding calls
  const uniqueMap = new Map(); // textHash -> { text, ids: [] }
  for (const c of chunks) {
    const normalized = String(c.text || '').replace(/\s+/g, ' ').trim();
    const h = crypto.createHash('sha256').update(normalized).digest('hex');
    if (!uniqueMap.has(h)) uniqueMap.set(h, { text: normalized, ids: [], metadatas: [] });
    uniqueMap.get(h).ids.push(c.id);
    uniqueMap.get(h).metadatas.push(c.metadata);
  }

  const uniqueEntries = Array.from(uniqueMap.entries());

  for (let i = 0; i < uniqueEntries.length; i += BATCH_SIZE) {
    const batch = uniqueEntries.slice(i, i + BATCH_SIZE);

    // If local provider supports batch endpoint, call it once per batch
    let embeddings;
    if (EMBEDDING_PROVIDER === 'local') {
      const localUrl = process.env.EMBEDDING_LOCAL_URL || 'http://embedding-server:8000';
      const texts = batch.map(([, item]) => item.text);
      try {
        try { await redis.incr('metrics:embed:batch_calls'); } catch (e) {}
        const resp = await fetchWithRetry(`${localUrl}/embed/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts }),
        });
        if (!resp.ok) {
          try { await redis.incr('metrics:embed:errors'); } catch (e) {}
          throw new Error(`Local embedding server batch error: ${resp.status}`);
        }
        const data = await resp.json();
        embeddings = data.embeddings;
      } catch (err) {
        try { await redis.incr('metrics:embed:errors'); } catch (e) {}
        throw err;
      }
    } else {
      embeddings = await Promise.all(
        batch.map(async ([hash, item]) => {
          return await embedText(item.text);
        })
      );
    }

    for (let j = 0; j < batch.length; j++) {
      const [hash, item] = batch[j];
      const emb = embeddings[j];
      // Map embedding back to all original chunk ids that referenced this text
      for (let k = 0; k < item.ids.length; k++) {
        vectors.push({ id: item.ids[k], values: emb, metadata: item.metadatas[k] });
      }
    }

    onProgress(Math.min(i + BATCH_SIZE, uniqueEntries.length), uniqueEntries.length);
  }

  return vectors;
};

module.exports = { embedText, embedChunks, EMBEDDING_DIMENSION, getEmbeddingMetrics };
