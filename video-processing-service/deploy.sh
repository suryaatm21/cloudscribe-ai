#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE=""
for candidate in "${SCRIPT_DIR}/.env" "${PROJECT_ROOT}/.env"; do
  if [[ -f "${candidate}" ]]; then
    ENV_FILE="${candidate}"
    break
  fi
done

if [[ -z "${ENV_FILE}" ]]; then
  echo "Error: .env file not found. Expected at ${SCRIPT_DIR}/.env"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${PROJECT_ID:?Error: PROJECT_ID is required in .env}"
REGION="${REGION:-us-central1}"
REPOSITORY_NAME="${REPOSITORY_NAME:-video-processing-service}"
SERVICE_NAME="${SERVICE_NAME:-video-processing-service}"
PROCESSING_MAX_ATTEMPTS="${PROCESSING_MAX_ATTEMPTS:-3}"

IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY_NAME}/${SERVICE_NAME}"
GIT_SHA="$(git -C "${PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
IMAGE_SHA_TAG="${IMAGE_BASE}:${GIT_SHA}"
IMAGE_LATEST_TAG="${IMAGE_BASE}:latest"

echo "🚀 Starting deployment process..."
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Deploying commit: ${GIT_SHA}"
echo "Target image: ${IMAGE_SHA_TAG}"

cd "${SCRIPT_DIR}"

RUN_LOCAL_TESTS="${RUN_LOCAL_TESTS:-false}"
if [[ "${RUN_LOCAL_TESTS}" == "true" ]]; then
  echo "🧪 Running build and test suite..."
  npm ci
  npm run build
  npm test
else
  echo "⚠️  Skipping local npm build/tests (set RUN_LOCAL_TESTS=true to enable)."
fi

echo "📦 Building Docker image for linux/amd64..."
docker build --platform linux/amd64 -t "${IMAGE_SHA_TAG}" -t "${IMAGE_LATEST_TAG}" .

echo "⬆️  Pushing image tags to Artifact Registry..."
docker push "${IMAGE_SHA_TAG}"
docker push "${IMAGE_LATEST_TAG}"

echo "☁️  Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_SHA_TAG}" \
  --region="${REGION}" \
  --platform managed \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --ingress=internal \
  --set-env-vars "PROCESSING_MAX_ATTEMPTS=${PROCESSING_MAX_ATTEMPTS}" \
  --project="${PROJECT_ID}"

echo "✅ Deployment successful!"
echo "📌 Deployed image tag: ${IMAGE_SHA_TAG}"
echo "🎉 Video processing service is now live!"
