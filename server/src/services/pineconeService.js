const { getPineconeIndex } = require('../config/pinecone');

const UPSERT_BATCH_SIZE = 100;

/**
 * Upsert vectors into Pinecone in batches
 * @param {{ id, values, metadata }[]} vectors
 * @param {Function} onProgress - (done, total) => void
 */
const upsertVectors = async (vectors, onProgress = () => {}) => {
  const index = getPineconeIndex();
  const total = vectors.length;

  for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
    const batch = vectors.slice(i, i + UPSERT_BATCH_SIZE);
    await index.upsert(batch);
    onProgress(Math.min(i + UPSERT_BATCH_SIZE, total), total);
  }
};

/**
 * Query Pinecone for the most similar vectors to a question embedding
 * @param {number[]} queryVector - The embedding of the user's question
 * @param {string} repoId - Filter results to this repository
 * @param {number} topK - Number of results to return
 * @returns {object[]} Matched vectors with scores and metadata
 */
const querySimilar = async (queryVector, repoId, topK = 10) => {
  const index = getPineconeIndex();

  const results = await index.query({
    vector: queryVector,
    topK,
    includeMetadata: true,
    filter: { repoId: { $eq: repoId } },
  });

  return results.matches || [];
};

/**
 * Delete all vectors for a repository namespace
 * @param {string} repoId
 */
const deleteRepositoryVectors = async (repoId) => {
  const index = getPineconeIndex();
  try {
    // Delete by metadata filter — requires Pinecone serverless or starter plan
    await index.deleteMany({ repoId: { $eq: repoId } });
  } catch {
    // If deleteMany isn't supported, use namespace approach
    console.warn(`Could not delete vectors for repoId ${repoId} — manual cleanup may be needed`);
  }
};

module.exports = { upsertVectors, querySimilar, deleteRepositoryVectors };
