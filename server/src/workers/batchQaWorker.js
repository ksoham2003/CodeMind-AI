const { Worker } = require('bullmq');
const { jobsQueue } = require('../queues/queue');
const { querySimilar } = require('../services/pineconeService');
const { embedText } = require('../services/embeddingService');
const { generateAnswer } = require('../services/llmWrapper');
const Chat = require('../models/Chat');
const Project = require('../models/Project');
const { getIo } = require('../controllers/indexController');
const url = require('url');

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
let connectionOptions;
try {
  const parsed = new url.URL(redisUrl);
  connectionOptions = { host: parsed.hostname, port: Number(parsed.port || 6379) };
} catch (err) {
  connectionOptions = { host: 'redis', port: 6379 };
}

const concurrency = parseInt(process.env.BATCH_QA_CONCURRENCY || '2', 10);

const concurrency = parseInt(process.env.BATCH_QA_CONCURRENCY || '2', 10);
const questionAttempts = parseInt(process.env.BATCH_QA_QUESTION_ATTEMPTS || '3', 10);
const questionBackoffMs = parseInt(process.env.BATCH_QA_QUESTION_BACKOFF_MS || '500', 10);

const worker = new Worker(
  'codemind-jobs',
  async (job) => {
    if (job.name !== 'batch-qa') return { ok: false };
    const { projectId, questions, requester } = job.data;
    const project = await Project.findById(projectId);
    if (!project) throw new Error('Project not found');

    const io = getIo();
    const results = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      job.updateProgress(Math.round(((i + 1) / questions.length) * 100));
      if (io) io.to(projectId).emit('batchqa:progress', { index: i, total: questions.length });

      let success = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= questionAttempts; attempt++) {
        try {
          // Embed query and search
          const qVec = await embedText(q);
          const matches = await querySimilar(qVec, project.repoId, 6);
          const { answer, tokensUsed } = await generateAnswer(q, matches, project.name);

          // Persist as Chat record (owner=requester)
          const chat = await Chat.create({ projectId, owner: requester, question: q, answer, sources: matches.map((m) => ({ file: m.metadata.path })), tokensUsed });
          results.push({ question: q, chatId: chat._id, answer });
          success = true;
          break;
        } catch (qerr) {
          lastErr = qerr;
          const willRetry = attempt < questionAttempts;
          console.warn(`BatchQA question attempt ${attempt} failed:`, qerr && qerr.message);
          if (!willRetry) break;
          const delay = questionBackoffMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (!success) {
        results.push({ question: q, error: lastErr && lastErr.message ? lastErr.message : 'failed' });
      }
    }

    if (io) io.to(projectId).emit('batchqa:done', { count: results.length });
    return { ok: true, results };
  },
  { connection: connectionOptions, concurrency }
);

worker.on('failed', (job, err) => console.error('BatchQA job failed', job.id, err && err.message));

module.exports = worker;
