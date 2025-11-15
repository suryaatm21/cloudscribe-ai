#!/usr/bin/env bash

set -euo pipefail

function usage() {
  cat <<'EOF'
Usage: ./scripts/setup-transcription-infra.sh \
  --project <PROJECT_ID> \
  --region <REGION> \
  --service-account <SERVICE_ACCOUNT_EMAIL> \
  [--transcripts-bucket <GCS_BUCKET_NAME>] \
  [--topic <PUBSUB_TOPIC_NAME>] \
  [--dlq-topic <PUBSUB_DLQ_TOPIC_NAME>]

Creates the infrastructure required for Sprint 2 transcription:
  1. Speech-to-Text API enablement
  2. GCS transcripts bucket (with CMEK placeholder)
  3. Pub/Sub topic + subscription + dead-letter topic
  4. IAM bindings for the video-processing-service account

Example:
  ./scripts/setup-transcription-infra.sh \
    --project cloudscribe-dev \
    --region us-central1 \
    --service-account video-processing-service@cloudscribe-dev.iam.gserviceaccount.com
EOF
}

PROJECT_ID=""
REGION=""
SERVICE_ACCOUNT=""
TRANSCRIPTS_BUCKET_NAME="atmuri-yt-transcripts"
TOPIC_NAME="transcription-jobs"
DLQ_TOPIC_NAME="transcription-jobs-dlq"
RETENTION_DAYS=7
ACK_DEADLINE=600
DLQ_MAX_DELIVERY=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --service-account)
      SERVICE_ACCOUNT="$2"
      shift 2
      ;;
    --transcripts-bucket)
      TRANSCRIPTS_BUCKET_NAME="$2"
      shift 2
      ;;
    --topic)
      TOPIC_NAME="$2"
      shift 2
      ;;
    --dlq-topic)
      DLQ_TOPIC_NAME="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$REGION" || -z "$SERVICE_ACCOUNT" ]]; then
  echo "Missing required arguments."
  usage
  exit 1
fi

function ensure_api_enabled() {
  local api="$1"
  if gcloud services list --enabled --project "$PROJECT_ID" \
    --format="value(config.name)" | grep -q "^${api}$"; then
    echo "API ${api} already enabled."
  else
    echo "Enabling API ${api}..."
    gcloud services enable "$api" --project "$PROJECT_ID"
  fi
}

function ensure_bucket() {
  local bucket="gs://${TRANSCRIPTS_BUCKET_NAME}"
  if gcloud storage buckets list --project "$PROJECT_ID" \
    --format="value(name)" | grep -q "^${bucket}$"; then
    echo "Bucket ${bucket} already exists."
  else
    echo "Creating bucket ${bucket} in ${REGION}..."
    gcloud storage buckets create "$bucket" \
      --project "$PROJECT_ID" \
      --location "$REGION" \
      --uniform-bucket-level-access \
      --retention-period "${RETENTION_DAYS}d"
  fi
}

function ensure_topic() {
  local topic="$1"
  if gcloud pubsub topics list --project "$PROJECT_ID" \
    --format="value(name)" | grep -q "/topics/${topic}$"; then
    echo "Topic ${topic} already exists."
  else
    echo "Creating topic ${topic}..."
    gcloud pubsub topics create "$topic" --project "$PROJECT_ID"
  fi
}

function ensure_subscription() {
  local subscription="$1"
  local topic="$2"
  if gcloud pubsub subscriptions list --project "$PROJECT_ID" \
    --format="value(name)" | grep -q "/subscriptions/${subscription}$"; then
    echo "Subscription ${subscription} already exists."
  else
    echo "Creating subscription ${subscription}..."
    gcloud pubsub subscriptions create "$subscription" \
      --topic "$topic" \
      --ack-deadline "$ACK_DEADLINE" \
      --min-retry-delay 10 \
      --max-retry-delay 600 \
      --message-retention-duration "${RETENTION_DAYS}d" \
      --dead-letter-topic "$DLQ_TOPIC_NAME" \
      --max-delivery-attempts "$DLQ_MAX_DELIVERY" \
      --project "$PROJECT_ID"
  fi
}

function ensure_iam_binding() {
  local role="$1"
  local resource="$2"
  local member="serviceAccount:${SERVICE_ACCOUNT}"
  if gcloud "$resource" get-iam-policy --project "$PROJECT_ID" \
    --format=json | grep -q "\"members\": \\\[\"${member}\"\\]"; then
    echo "${member} already bound to ${role} on ${resource}."
  else
    echo "Granting ${role} to ${member} on ${resource}..."
    gcloud "$resource" add-iam-policy-binding \
      --member "$member" \
      --role "$role" \
      --project "$PROJECT_ID"
  fi
}

echo "===> Enabling required APIs..."
ensure_api_enabled "speech.googleapis.com"
ensure_api_enabled "pubsub.googleapis.com"

echo "===> Ensuring transcripts bucket..."
ensure_bucket

echo "===> Ensuring Pub/Sub topics..."
ensure_topic "$DLQ_TOPIC_NAME"
ensure_topic "$TOPIC_NAME"

echo "===> Ensuring subscription..."
ensure_subscription "${TOPIC_NAME}-sub" "$TOPIC_NAME"

echo "===> Configuring IAM..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/speech.client" >/dev/null

gcloud storage buckets add-iam-policy-binding "gs://${TRANSCRIPTS_BUCKET_NAME}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/storage.objectAdmin" >/dev/null

gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/pubsub.publisher" \
  --project "$PROJECT_ID" >/dev/null

gcloud pubsub subscriptions add-iam-policy-binding "${TOPIC_NAME}-sub" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/pubsub.subscriber" \
  --project "$PROJECT_ID" >/dev/null

echo "===> Transcription infrastructure setup complete."

