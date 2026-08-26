const Project = require('../models/Project');
const Chunk = require('../models/Chunk');
const { embedChunks } = require('../services/embeddingService');
const { upsertVectors } = require('../services/pineconeService');

/**
 * POST /api/embed/on-demand
 * Body: { chunkIds: ["uuid", ...] }
 * Immediately generates embeddings for the provided chunk ids (if missing), upserts to vector DB,
 * and updates Chunk documents with embedding and status.
 */
const onDemandEmbed = async (req, res) => {
  const { chunkIds } = req.body || {};
  if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
    return res.status(400).json({ success: false, message: 'chunkIds required' });
  }

  // Load chunks
  const chunks = await Chunk.find({ _id: { $in: chunkIds } }).lean();
  if (!chunks || chunks.length === 0) {
    return res.status(404).json({ success: false, message: 'No chunks found for provided ids' });
  }

  // Enqueue background job for embedding so it can be processed asynchronously by the worker
  const { addEmbedJob } = require('../queues/embedQueue');
  const job = await addEmbedJob({ chunkIds, projectId: chunks[0].project });
  return res.status(202).json({ success: true, message: 'Embedding job enqueued', jobId: job.id });
};

module.exports = { onDemandEmbed };
