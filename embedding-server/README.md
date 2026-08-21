Local Embedding Server
======================

This is a small FastAPI service that serves sentence-transformers embeddings.

Defaults:
- Model: `all-MiniLM-L6-v2` (configurable via `EMBEDDING_MODEL_NAME` env)
- Endpoints:
  - `POST /embed` -> { text }
  - `POST /embed/batch` -> { texts: [..] }
  - `GET /health`

Run with Docker Compose (root of repo):

```bash
docker compose up -d --build embedding-server
```

Once running, set `EMBEDDING_PROVIDER=local` and `EMBEDDING_LOCAL_URL=http://embedding-server:8000` for the server to use it.

Notes:
- Model weights are downloaded on first start; ensure enough disk space.
- For production, consider hosting on a GPU-enabled machine or using an optimized ONNX/quantized build.
