#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID=${PROJECT_ID:-""}
REGION=${REGION:-"us-central1"}
SERVICE_NAME=${SERVICE_NAME:-"notes-service"}
IMAGE="us-central1-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest"

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID environment variable is required"
  exit 1
fi

npm install
npm run build
npm test

gcloud builds submit --config cloudbuild.yaml ..

cat <<DEPLOY
Deployment triggered for ${SERVICE_NAME}. Monitor Cloud Build for progress.
DEPLOY
