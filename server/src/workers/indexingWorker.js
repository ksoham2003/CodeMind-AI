const { Worker } = require('bullmq');
const { getRedis } = require('../config/redis');
const { generateArchitectureDiagram } = require('../services/llmService');
// Add other services as needed: indexingService, embeddingService

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const worker = new Worker(
  'codemind-jobs',
  async (job) => {
    console.log(`Worker processing job ${job.id} type=${job.name}`);
    try {
      if (job.name === 'generate-architecture') {
        const { retrievedChunks, repoName, diagramType, fileTree } = job.data;
        const { graph, summary, tokensUsed } = await generateArchitectureDiagram(
          retrievedChunks,
          repoName,
          diagramType,
          fileTree
        );
        return { graph, summary, tokensUsed };
      }

      if (job.name === 'index-repo') {
        // Placeholder: call indexing service to process repository
        // const result = await indexingService.indexRepository(job.data);
        return { success: true };
      }

      // Unknown job
      return { skipped: true };
    } catch (err) {
      console.error('Worker job error:', err);
      throw err;
    }
  },
  { connection: { url: redisUrl }, concurrency: Number(process.env.QUEUE_CONCURRENCY || 2) }
);

worker.on('failed', (job, err) => {
  console.error(`Job failed ${job.id}:`, err.message || err);
});

module.exports = worker;
