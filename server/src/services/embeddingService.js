const { getEmbeddingClient } = require('../config/gemini');

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSION = 3072;
const BATCH_SIZE = 50;

/**
 * Generate an embedding for a single text string
 * @param {string} text
 * @returns {number[]} embedding vector
 */
const embedText = async (text) => {
  const gemini = getEmbeddingClient();
  const response = await gemini.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text.replace(/\n/g, ' '),
  });
  return response.embeddings[0].values;
};

/**
 * Generate embeddings for a batch of chunks
 * @param {{ id, text, metadata }[]} chunks
 * @param {Function} onProgress - (completed, total) => void
 * @returns {{ id, values, metadata }[]} Pinecone-ready vectors
 */
const embedChunks = async (chunks, onProgress = () => {}) => {
  const gemini = getEmbeddingClient();
  const vectors = [];
  const total = chunks.length;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    // Process batch concurrently
    const embeddings = await Promise.all(
      batch.map(async (c) => {
        const response = await gemini.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: c.text.replace(/\n/g, ' '),
        });
        return response.embeddings[0].values;
      })
    );

    for (let j = 0; j < batch.length; j++) {
      vectors.push({
        id: batch[j].id,
        values: embeddings[j],
        metadata: batch[j].metadata,
      });
    }

    onProgress(Math.min(i + BATCH_SIZE, total), total);
  }

  return vectors;
};

module.exports = { embedText, embedChunks, EMBEDDING_DIMENSION };
