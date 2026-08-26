const { getPineconeIndex, getPineconeClient } = require('../config/pinecone');

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
/**
 * Query Pinecone for the most similar vectors to a question embedding
 * Supports optional metadata filters and post-query boosting rules.
 * @param {number[]} queryVector
 * @param {string} repoId
 * @param {number} topK
 * @param {{ filters?: object, boosts?: Array<{field:string,value:any,weight:number}> }} opts
 */
const querySimilar = async (queryVector, repoId, topK = 10, opts = {}) => {
  const index = getPineconeIndex();

  // Check index dimension to provide a clear error when vectors mismatch
  try {
    // Try to fetch index metadata via the client list/describe APIs
    const client = getPineconeClient();
    let indexInfo = null;
    try {
      const listRes = await client.listIndexes();
      // listIndexes may return { indexes: [ ... ] } or an array
      const indexes = Array.isArray(listRes) ? listRes : listRes?.indexes || [];
      indexInfo = indexes.find((i) => i.name === process.env.PINECONE_INDEX_NAME) || null;
    } catch (e) {
      // ignore and continue — we'll still attempt query and let Pinecone raise the error
      indexInfo = null;
    }

    // Build filter with repoId default and merge optional filters
    const baseFilter = { repoId: { $eq: repoId } };
    const userFilter = opts.filters || {};

    // Merge userFilter into baseFilter. For simple values, translate to $eq or $in for arrays.
    const mergedFilter = { ...baseFilter };
    for (const [k, v] of Object.entries(userFilter)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) mergedFilter[k] = { $in: v };
      else if (typeof v === 'object' && (v.$eq || v.$in || v.$gte || v.$lte || v.$contains)) mergedFilter[k] = v;
      else mergedFilter[k] = { $eq: v };
    }

    const results = await index.query({
      vector: queryVector,
      topK: Math.max(topK, 50), // fetch more to allow post-query boosting/re-ranking
      includeMetadata: true,
      filter: mergedFilter,
    });

    let matches = results.matches || [];

    // Apply optional boosting rules client-side: boosts is an array of { field, value, weight }
    const boosts = opts.boosts || [];
    if (Array.isArray(boosts) && boosts.length > 0) {
      for (const m of matches) {
        m._adjustedScore = m.score || 0;
        for (const b of boosts) {
          try {
            const metaVal = m.metadata && m.metadata[b.field];
            if (metaVal === undefined) continue;
            // match if equality or inclusion
            let matchesBoost = false;
            if (Array.isArray(metaVal)) {
              matchesBoost = metaVal.includes(b.value);
            } else {
              matchesBoost = String(metaVal) === String(b.value);
            }
            if (matchesBoost) {
              const weight = Number(b.weight) || 0;
              m._adjustedScore = (m._adjustedScore || 0) * (1 + weight);
            }
          } catch (e) {
            // ignore per-boost errors
          }
        }
      }
      // Sort by adjusted score desc
      matches.sort((a, z) => (z._adjustedScore || z.score || 0) - (a._adjustedScore || a.score || 0));
    }

    // Return topK after re-ranking
    return matches.slice(0, topK);
  } catch (err) {
    // Detect dimension mismatch and throw a clearer, actionable error
    const msg = err && (err.message || err.toString());
    if (msg && /dimension/i.test(msg)) {
      const vectorDim = Array.isArray(queryVector) ? queryVector.length : undefined;
      // Try to discover index dimension if possible
      let indexDim;
      try {
        const client = getPineconeClient();
        const listRes = await client.listIndexes();
        const indexes = Array.isArray(listRes) ? listRes : listRes?.indexes || [];
        const info = indexes.find((i) => i.name === process.env.PINECONE_INDEX_NAME) || null;
        indexDim = info?.dimension;
      } catch (e) {
        indexDim = undefined;
      }

      const e = new Error(
        `Embedding dimension mismatch: vector dimension ${vectorDim || 'unknown'} does not match Pinecone index${process.env.PINECONE_INDEX_NAME ? ` (${process.env.PINECONE_INDEX_NAME})` : ''} dimension ${indexDim || 'unknown'}.` +
          ' Ensure your embedding provider/model matches the index dimension, or create a matching index.'
      );
      e.code = 'DIMENSION_MISMATCH';
      e.vectorDim = vectorDim;
      e.indexDim = indexDim;
      throw e;
    }

    // Re-throw other errors
    throw err;
  }
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
