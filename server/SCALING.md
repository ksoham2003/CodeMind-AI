Scaling Plan — CodeMind AI

Goal: support a minimum of 10,000 concurrent or active users with predictable costs and SLAs.

Quick summary
- Move heavy/slow operations to background workers (indexing, embeddings, architecture generation).
- Use Redis for caching, rate-limiting, job queues, and session storage if needed.
- Make server stateless (JWT auth) and horizontally scalable behind a load balancer.
- Use a managed vector DB (Pinecone) with a replication/partition plan; cache nearest-neighbor results.
- Use OpenAI for LLM calls with cost controls and circuit breakers; use cheaper models for chat and summarization.

Phased plan

Phase 1 — Foundations (complete in days)
- Add Redis and BullMQ for job queueing and caching (this commit provides scaffolding).
- Add a Redis-backed rate limiter middleware for API protection.
- Document env vars and run instructions (`.env.example`).

Phase 2 — Make backend stateless + workers (weeks)
- Ensure auth via JWT exclusively (no sticky server sessions).
- Add worker processes to process `codemind-jobs` (indexing, architecture generation).
- Update indexing flow to enqueue jobs and return job ids; provide status polling endpoints.

Phase 3 — Provider & cost management (weeks)
- Use `gpt-3.5-turbo` for chat, `gpt-4` for architecture generation; add circuit breaker and quota handling.
- Cache embeddings and dedupe embedding requests.
- Add token logging and cost tracking per request.

Phase 4 — Scaling infra (1-2 months)
- Dockerize services, add Kubernetes manifests and HPA.
- Use Redis Cluster or managed Redis service; use managed Pinecone or alternatives.
- Configure socket.io Redis adapter and scale via multiple server replicas behind LB with sticky sessions.
- Add read replicas for MongoDB and optimize indexes.

Phase 5 — Observability and load testing
- Add Prometheus/Grafana, structured logs (ELK), alerts for SLOs.
- Execute load tests (k6/Locust) and iterate.

Operational notes
- Start small: use the cheapest chat model and schedule heavy operations offline.
- Monitor provider (OpenAI) usage daily. Set billing caps and alerts.

Files added in this change
- `src/config/redis.js` — ioredis client
- `src/queues/queue.js` — BullMQ queue scaffold
- `src/workers/indexingWorker.js` — simple worker skeleton
- `src/middleware/rateLimiter.js` — Redis-backed rate limiter
- `.env.example` updated with `REDIS_URL`, `QUEUE_CONCURRENCY`

Next implementation steps (I can do these now):
- Wire job enqueue points in controllers (indexing, architecture) so operations are processed asynchronously.
- Create job status endpoints and a lightweight dashboard for queued jobs.
- Add caching layer for embeddings and search results.

Run notes
- Install new dependencies in `server`:

```bash
cd server
npm install ioredis bullmq
```

- Start a local Redis for development (docker):

```bash
docker run -p 6379:6379 -d redis:7
```

- Start server and worker (same repo):

```bash
# start server
npm run dev
# in another terminal, run the worker (optional - worker file auto-runs when required)
node src/workers/indexingWorker.js
```

If you want, I will now:
1) Wire the architecture controller to enqueue a `generate-architecture` job instead of calling the LLM synchronously.
2) Add a job status endpoint `/api/jobs/:id`.
3) Add embedding cache helper and integrate it into `embeddingService.js`.

Pick which of (1)-(3) to implement next, or I'll proceed with (1) by default.
