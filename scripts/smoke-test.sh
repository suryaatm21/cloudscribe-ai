#!/bin/bash
set -euo pipefail

REQUIRED_VARS=(
  "SMOKE_PROJECT_ID"
  "SMOKE_FUNCTIONS_URL"
  "SMOKE_ID_TOKEN"
  "SMOKE_TEST_FILE"
  "SMOKE_PROCESSED_BUCKET"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: environment variable $var is required"
    exit 1
  fi
done

SMOKE_POLL_INTERVAL="${SMOKE_POLL_INTERVAL:-30}"
SMOKE_MAX_POLLS="${SMOKE_MAX_POLLS:-10}"
SMOKE_CONTENT_TYPE="${SMOKE_CONTENT_TYPE:-video/mp4}"
RAW_BUCKET="${SMOKE_RAW_BUCKET:-atmuri-yt-raw-videos}"

command -v curl >/dev/null 2>&1 || { echo "curl is required"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }
command -v gcloud >/dev/null 2>&1 || { echo "gcloud CLI is required"; exit 1; }
command -v gsutil >/dev/null 2>&1 || { echo "gsutil is required"; exit 1; }

function cleanup() {
  if [[ -n "${FILE_NAME:-}" ]]; then
    gsutil rm -f "gs://${RAW_BUCKET}/${FILE_NAME}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${PROCESSED_OBJECT:-}" ]]; then
    gsutil rm -f "${PROCESSED_OBJECT}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

function section() {
  printf "\n==== %s ====\n" "$1"
}

UPLOAD_EXTENSION="${SMOKE_TEST_FILE##*.}"
section "Requesting signed upload URL"
UPLOAD_RESPONSE=$(curl -s -X POST "${SMOKE_FUNCTIONS_URL}/getUploadUrl?extension=${UPLOAD_EXTENSION}" \
  -H "Authorization: Bearer ${SMOKE_ID_TOKEN}" \
  -H "Content-Type: application/json")

UPLOAD_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.url')
FILE_NAME=$(echo "$UPLOAD_RESPONSE" | jq -r '.fileName')

if [[ -z "$UPLOAD_URL" || -z "$FILE_NAME" || "$UPLOAD_URL" == "null" ]]; then
  echo "Failed to retrieve signed URL. Response: $UPLOAD_RESPONSE"
  exit 1
fi

section "Uploading sample file"
curl -s -X PUT -H "Content-Type: ${SMOKE_CONTENT_TYPE}" --upload-file "$SMOKE_TEST_FILE" "$UPLOAD_URL" >/dev/null

VIDEO_ID="${FILE_NAME%%.*}"
FIRESTORE_DOC="projects/${SMOKE_PROJECT_ID}/databases/(default)/documents/videos/${VIDEO_ID}"
ACCESS_TOKEN=$(gcloud auth application-default print-access-token)

section "Polling Firestore for processing status"
STATUS="pending"
for (( attempt=1; attempt<=SMOKE_MAX_POLLS; attempt++ )); do
  RESPONSE=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "https://firestore.googleapis.com/v1/${FIRESTORE_DOC}")
  STATUS=$(echo "$RESPONSE" | jq -r '.fields.status.stringValue // "pending"')
  echo "Attempt ${attempt}/${SMOKE_MAX_POLLS}: status=${STATUS}"
  if [[ "$STATUS" == "processed" ]]; then
    break
  fi
  sleep "$SMOKE_POLL_INTERVAL"
done

if [[ "$STATUS" != "processed" ]]; then
  echo "Video did not reach processed state within allotted time"
  exit 1
fi

section "Validating processed artifact exists"
PROCESSED_OBJECT="gs://${SMOKE_PROCESSED_BUCKET}/processed-${FILE_NAME}"
if ! gsutil ls "$PROCESSED_OBJECT" >/dev/null 2>&1; then
  echo "Processed file not found at $PROCESSED_OBJECT"
  exit 1
fi

printf "\n✅ Smoke test succeeded\n"
echo "Video ID: ${VIDEO_ID}"
echo "Processed object: ${PROCESSED_OBJECT}"
echo "Raw bucket: gs://${RAW_BUCKET}/${FILE_NAME}"
