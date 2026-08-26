const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { getRedis } = require('../config/redis');
const Chunk = require('../models/Chunk');
const Project = require('../models/Project');
const { embedChunks } = require('../services/embeddingService');
const { upsertVectors } = require('../services/pineconeService');
const { getIo } = require('../controllers/indexController');
const crypto = require('crypto');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Create a separate ioredis connection for BullMQ pub/sub
const connection = new IORedis(REDIS_URL, { lazyConnect: true });
connection.connect().catch(() => {});

const worker = new Worker(
  'embed-on-demand',
  async (job) => {
    const { chunkIds = [], projectId } = job.data || {};
    if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
      return { ok: false, reason: 'no_chunk_ids' };
    }

    // Load chunks that need embeddings
    const chunks = await Chunk.find({ _id: { $in: chunkIds } }).lean();
    const toEmbed = chunks.filter((c) => !c.embedding || c.embedding.length === 0).map((c) => ({ id: c._id, text: c.text, metadata: c.metadata }));

    if (toEmbed.length === 0) return { ok: true, embedded: 0 };

    // Notify clients that embedding started
    const io = getIo();
    if (io && projectId) io.to(projectId).emit('embed:started', { chunkCount: toEmbed.length });

    // Generate embeddings (uses embeddingService batching/dedupe)
    const vectors = await embedChunks(toEmbed, (completed, total) => {
      if (io && projectId) io.to(projectId).emit('embed:progress', { completed, total });
    });

    // Upsert to vector DB
    await upsertVectors(vectors);

    // Update chunk docs with embeddings and embeddingSha
    const bulkOps = vectors.map((v) => {
      const sha = crypto.createHash('sha256').update(String(v.values || [])).digest('hex');
      return {
        updateOne: {
          filter: { _id: v.id },
          update: { $set: { embedding: v.values, embeddingSha: sha, status: 'embedded' } },
        },
      };
    });
    if (bulkOps.length > 0) await Chunk.bulkWrite(bulkOps, { ordered: false }).catch((e) => console.warn('Chunk bulkWrite error:', e.message || e));

    if (io && projectId) io.to(projectId).emit('embed:done', { embedded: vectors.length });

    return { ok: true, embedded: vectors.length };
  },
  { connection }
);

worker.on('completed', (job) => {
  console.log(`Embed job ${job.id} completed`);
});
worker.on('failed', (job, err) => {
  console.error(`Embed job ${job.id} failed:`, err && err.message ? err.message : err);
});

module.exports = worker;
