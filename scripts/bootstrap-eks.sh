#!/usr/bin/env bash
# =============================================================================
# CodeMind AI — AWS EKS Bootstrap Script
# Run this ONCE to provision the cluster and install dependencies.
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - eksctl installed: https://eksctl.io/installation/
#   - kubectl installed
#   - helm installed: https://helm.sh/docs/intro/install/
#
# Usage:
#   chmod +x scripts/bootstrap-eks.sh
#   ./scripts/bootstrap-eks.sh
# =============================================================================
set -euo pipefail

CLUSTER_NAME="codemind-cluster"
REGION="us-east-1"
NODE_TYPE="t3.medium"     # 2 vCPU, 4GB RAM — upgrade to t3.large for more headroom
MIN_NODES=2
MAX_NODES=6
NAMESPACE="codemind"

echo "======================================================"
echo " CodeMind AI — EKS Bootstrap"
echo " Cluster : $CLUSTER_NAME"
echo " Region  : $REGION"
echo " Nodes   : $MIN_NODES-$MAX_NODES x $NODE_TYPE"
echo "======================================================"

# ─── Step 1: Create EKS cluster ──────────────────────────────────────────────
echo ""
echo "[1/6] Creating EKS cluster (this takes ~15 minutes)..."
eksctl create cluster \
  --name "$CLUSTER_NAME" \
  --region "$REGION" \
  --nodegroup-name standard-workers \
  --node-type "$NODE_TYPE" \
  --nodes-min "$MIN_NODES" \
  --nodes-max "$MAX_NODES" \
  --managed \
  --with-oidc \
  --asg-access \
  --alb-ingress-access

# ─── Step 2: Install NGINX Ingress Controller ────────────────────────────────
echo ""
echo "[2/6] Installing NGINX Ingress Controller..."
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.replicaCount=2 \
  --set controller.service.type=LoadBalancer

# Wait for external IP
echo "  Waiting for LoadBalancer IP..."
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

LB_IP=$(kubectl get svc ingress-nginx-controller \
  -n ingress-nginx \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "  ✅ LoadBalancer address: $LB_IP"
echo "  👉 Point your DNS A-record (or CNAME) to: $LB_IP"

# ─── Step 3: Install cert-manager ────────────────────────────────────────────
echo ""
echo "[3/6] Installing cert-manager..."
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --version v1.14.0 \
  --set installCRDs=true

# ─── Step 4: Install Metrics Server (needed for HPA) ─────────────────────────
echo ""
echo "[4/6] Installing Metrics Server..."
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# ─── Step 5: Create namespace + apply base config ────────────────────────────
echo ""
echo "[5/6] Creating namespace and applying base config..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.prod.yaml

# ─── Step 6: Apply secrets (manual step — FILL IN secret.prod.yaml FIRST) ───
echo ""
echo "[6/6] Applying secrets..."
if [ -f "k8s/secret.prod.yaml" ]; then
  kubectl apply -f k8s/secret.prod.yaml
  echo "  ✅ Secrets applied"
else
  echo "  ⚠️  k8s/secret.prod.yaml not found!"
  echo "     Copy k8s/secret.prod.example.yaml → k8s/secret.prod.yaml"
  echo "     Fill in all REPLACE_ME values, then run:"
  echo "     kubectl apply -f k8s/secret.prod.yaml"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo " ✅ EKS cluster is ready!"
echo ""
echo " Next steps:"
echo "   1. Copy k8s/secret.prod.example.yaml → k8s/secret.prod.yaml"
echo "   2. Fill in all API keys (OpenAI, MongoDB Atlas, Redis, etc.)"
echo "   3. kubectl apply -f k8s/secret.prod.yaml"
echo "   4. Update ingress.yaml with your domain name"
echo "   5. kubectl apply -f k8s/ingress.yaml"
echo "   6. Push to 'main' — GitHub Actions will deploy automatically"
echo ""
echo " LoadBalancer DNS: $LB_IP"
echo "======================================================"
