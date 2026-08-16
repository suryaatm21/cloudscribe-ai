#!/usr/bin/env bash
set -euo pipefail

function usage() {
  cat <<'USAGE'
Usage: ./scripts/setup-notes-infra.sh \
  --project <PROJECT_ID> \
  --region <REGION> \
  --service-account <SERVICE_ACCOUNT_EMAIL> \
  --push-endpoint <NOTES_SERVICE_PUSH_URL> \
  [--notes-bucket <NOTES_BUCKET_NAME>] \
  [--prompts-bucket <PROMPTS_BUCKET_NAME>] \
  [--topic <PUBSUB_TOPIC_NAME>] \
  [--dlq-topic <PUBSUB_DLQ_TOPIC_NAME>]
USAGE
}

PROJECT_ID=""
REGION="us-central1"
SERVICE_ACCOUNT=""
NOTES_BUCKET="atmuri-yt-notes"
PROMPTS_BUCKET="atmuri-yt-notes-prompts"
TOPIC_NAME="notes-jobs"
DLQ_TOPIC_NAME="notes-jobs-dlq"
PUSH_ENDPOINT=""

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
    --notes-bucket)
      NOTES_BUCKET="$2"
      shift 2
      ;;
    --prompts-bucket)
      PROMPTS_BUCKET="$2"
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
    --push-endpoint)
      PUSH_ENDPOINT="$2"
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

if [[ -z "$PROJECT_ID" || -z "$SERVICE_ACCOUNT" || -z "$PUSH_ENDPOINT" ]]; then
  echo "--project, --service-account, and --push-endpoint are required"
  usage
  exit 1
fi

echo "Using project: $PROJECT_ID"
echo "Region: $REGION"

gcloud config set project "$PROJECT_ID" >/dev/null

function ensure_api() {
  local api="$1"
  gcloud services enable "$api" --project "$PROJECT_ID" >/dev/null
  echo "Enabled API: $api"
}

ensure_api run.googleapis.com
ensure_api storage.googleapis.com
ensure_api pubsub.googleapis.com
ensure_api aiplatform.googleapis.com

function ensure_bucket() {
  local bucket="$1"
  if gsutil ls -b "gs://$bucket" >/dev/null 2>&1; then
    echo "Bucket gs://$bucket already exists"
  else
    gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://$bucket"
    echo "Created bucket gs://$bucket"
  fi
}

ensure_bucket "$NOTES_BUCKET"
ensure_bucket "$PROMPTS_BUCKET"

gcloud pubsub topics create "$TOPIC_NAME" --project "$PROJECT_ID" --quiet || true
gcloud pubsub topics create "$DLQ_TOPIC_NAME" --project "$PROJECT_ID" --quiet || true

gcloud pubsub subscriptions create "${TOPIC_NAME}-subscription" \
  --topic "$TOPIC_NAME" \
  --push-endpoint "$PUSH_ENDPOINT" \
  --push-auth-service-account "$SERVICE_ACCOUNT" \
  --dead-letter-topic "$DLQ_TOPIC_NAME" \
  --max-delivery-attempts 5 \
  --project "$PROJECT_ID" --quiet || true

gcloud pubsub subscriptions update "${TOPIC_NAME}-subscription" \
  --ack-deadline 60 \
  --project "$PROJECT_ID" --quiet

gsutil iam ch "serviceAccount:${SERVICE_ACCOUNT}:objectAdmin" "gs://${NOTES_BUCKET}"
gsutil iam ch "serviceAccount:${SERVICE_ACCOUNT}:objectViewer" "gs://${PROMPTS_BUCKET}"

gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/pubsub.publisher" \
  --project "$PROJECT_ID" --quiet

gcloud pubsub subscriptions add-iam-policy-binding "${TOPIC_NAME}-subscription" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/pubsub.subscriber" \
  --project "$PROJECT_ID" --quiet

echo "Notes infrastructure ready."
