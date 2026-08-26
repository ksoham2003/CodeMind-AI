# CodeMind AI — Kubernetes Deployment Guide

This guide deploys **all CodeMind AI services** to Kubernetes, including the `qwen3-coder:30b` LLM served by Ollama.

## Prerequisites

- `kubectl` configured and pointing at your cluster
- Container images built and pushed to a registry (or available locally via `imagePullPolicy: IfNotPresent`)
- K8s cluster with a node having **22GB+ VRAM GPU** or **24GB+ system RAM** for the Ollama pod

---

## Step 1 — Fill in Secrets

Edit `secret.yaml` and base64-encode your real values:

```bash
# Encode a value:
echo -n "your-strong-jwt-secret" | base64

# Decode to verify:
echo "eW91ci1zdHJvbmctand0LXNlY3JldA==" | base64 --decode
```

At minimum, `JWT_SECRET` must be set. Then edit `k8s/secret.yaml` and fill in the `data:` fields.

---

## Step 2 — Build & Push Docker Images

From the project root:

```bash
# Build all images
docker build -t your-registry/codemindai-server:latest ./server
docker build -t your-registry/codemindai-client:latest ./client \
  --build-arg VITE_API_URL=http://<your-cluster-ip>:5000
docker build -t your-registry/codemindai-embedding-server:latest ./embedding-server

# Push to registry
docker push your-registry/codemindai-server:latest
docker push your-registry/codemindai-client:latest
docker push your-registry/codemindai-embedding-server:latest
```

Then update the `image:` fields in `server.yaml`, `worker.yaml`, `client.yaml`, and `embedding-server.yaml` to use your registry path.

> **For local testing (no registry):** Leave `imagePullPolicy: IfNotPresent` and ensure images are present on each K8s node via `docker build` on the node itself, or use `kind load docker-image`.

---

## Step 3 — GPU Mode (Optional but Recommended)

If your node has an NVIDIA GPU with 22GB+ VRAM:

1. Install the NVIDIA device plugin:
```bash
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.16.0/deployments/static/nvidia-device-plugin.yml
```

2. Edit `k8s/ollama.yaml` and:
   - Comment out the **CPU mode** `resources:` block
   - Uncomment the **GPU mode** `resources:` block
   - Uncomment `nodeSelector` and `tolerations`

---

## Step 4 — Deploy

Apply all manifests in order:

```bash
# 1. Create namespace first
kubectl apply -f k8s/namespace.yaml

# 2. Config and secrets
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml

# 3. Stateful services (mongo, redis)
kubectl apply -f k8s/mongo.yaml
kubectl apply -f k8s/redis.yaml

# 4. ML services (embedding + Ollama — Ollama will pull 19GB model on first boot)
kubectl apply -f k8s/embedding-server.yaml
kubectl apply -f k8s/ollama.yaml

# 5. Application services
kubectl apply -f k8s/server.yaml
kubectl apply -f k8s/worker.yaml
kubectl apply -f k8s/client.yaml
```

Or all at once:

```bash
kubectl apply -f k8s/
```

---

## Step 5 — Wait for Ollama Model Pull

On **first deploy**, the Ollama init container will download `qwen3-coder:30b` (~19GB). This can take **10–20 minutes** depending on internet speed.

Watch the init container:

```bash
kubectl logs -n codemind -l app=codemind-ollama -c ollama-pull -f
```

Wait until you see: `Model pull complete.`

---

## Step 6 — Verify

```bash
# Check all pods are Running
kubectl get pods -n codemind

# Expected output:
# NAME                                    READY   STATUS    RESTARTS
# codemind-client-xxx                     1/1     Running   0
# codemind-embedding-xxx                  1/1     Running   0
# codemind-mongo-0                        1/1     Running   0
# codemind-ollama-xxx                     1/1     Running   0
# codemind-redis-xxx                      1/1     Running   0
# codemind-server-xxx                     1/1     Running   0
# codemind-worker-xxx                     1/1     Running   0

# Test Ollama directly
kubectl exec -n codemind deploy/codemind-ollama -- \
  curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-coder:30b","messages":[{"role":"user","content":"say hi"}],"stream":false}'

# Tail server logs
kubectl logs -n codemind deploy/codemind-server -f

# Get the external IP for the client
kubectl get svc -n codemind codemind-client
```

---

## Architecture

```
Internet
    │
    ▼
codemind-client (Nginx, LoadBalancer :80)
    │
    ▼ proxy /api/*
codemind-server (Node.js :5000)
    ├── codemind-mongo (:27017)
    ├── codemind-redis (:6379)
    ├── codemind-embedding (:8000)  ← all-MiniLM-L6-v2
    └── codemind-ollama (:11434)    ← qwen3-coder:30b
            │
            └── /v1/chat/completions (OpenAI-compatible)

codemind-worker (BullMQ indexing)
    ├── codemind-mongo
    ├── codemind-redis
    └── codemind-embedding
```

---

## Teardown

```bash
# Delete everything in the codemind namespace
kubectl delete namespace codemind

# This also deletes PVCs and model weights!
# To only scale down without deleting data:
kubectl scale deploy --all --replicas=0 -n codemind
```
