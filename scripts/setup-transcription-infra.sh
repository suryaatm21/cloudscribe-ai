#!/usr/bin/env bash

set -euo pipefail

function usage() {
  cat <<'EOF'
Usage: ./scripts/setup-transcription-infra.sh \
  --project <PROJECT_ID> \
  --region <REGION> \
  --service-url <CLOUD_RUN_URL> \
  --push-identity <PUSH_SERVICE_ACCOUNT_EMAIL> \
  [--service-account <RUNTIME_SERVICE_ACCOUNT_EMAIL>] \
  [--oidc-audience <AUDIENCE>] \
  [--cloud-run-service <SERVICE_NAME>] \
  [--transcripts-bucket <GCS_BUCKET_NAME>] \
  [--audio-work-bucket <GCS_BUCKET_NAME>] \
  [--jobs-topic <PUBSUB_TOPIC_NAME>] \
  [--ready-topic <PUBSUB_TOPIC_NAME>] \
  [--raw-transcript-prefix <PREFIX>]

Creates the infrastructure required for Sprint 2 transcription:
  1. Enable Speech-to-Text, Pub/Sub, Cloud Scheduler, Storage, and Run APIs
  2. Preflight iam.serviceAccounts.actAs on the push identity
  3. Transcripts + audio-work buckets (lifecycle expiry, not retention lock)
  4. Push subscriptions to /transcribe-audio and /transcript-ready
  5. DLQ topics AND DLQ subscriptions
  6. Pub/Sub service-agent IAM required for dead-lettering
  7. Prefix-filtered GCS notification on the configured raw prefix
  8. Cloud Scheduler job targeting /reconcile-transcripts

--push-identity is the Pub/Sub OIDC push / Scheduler identity.
Runtime Speech/Storage/Firestore/publisher roles go to --service-account,
or to the Cloud Run service's runtime identity if omitted. These must not
be the same by default: the live push identity is the App Engine default
SA, while Cloud Run runs as the Compute Engine default SA.

The creator must have iam.serviceAccounts.actAs on --push-identity so
gcloud can configure OIDC push authentication.

Example:
  ./scripts/setup-transcription-infra.sh \
    --project yt-clone-385f4 \
    --region us-central1 \
    --service-url https://video-processing-service-xxxxx.run.app \
    --push-identity yt-clone-385f4@appspot.gserviceaccount.com \
    --service-account 262816123746-compute@developer.gserviceaccount.com
EOF
}

PROJECT_ID=""
REGION=""
SERVICE_URL=""
PUSH_IDENTITY=""
OIDC_AUDIENCE=""
SERVICE_ACCOUNT=""
CLOUD_RUN_SERVICE="video-processing-service"
TRANSCRIPTS_BUCKET_NAME="atmuri-yt-transcripts"
AUDIO_WORK_BUCKET_NAME="atmuri-yt-audio-work"
JOBS_TOPIC="transcription-jobs"
READY_TOPIC="transcripts-ready"
RAW_TRANSCRIPT_PREFIX="raw"
LIFECYCLE_DAYS=7
ACK_DEADLINE=600
DLQ_MAX_DELIVERY=5
SCHEDULER_JOB="reconcile-transcripts"

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
    --service-url)
      SERVICE_URL="${2%/}"
      shift 2
      ;;
    --push-identity)
      PUSH_IDENTITY="$2"
      shift 2
      ;;
    --oidc-audience)
      OIDC_AUDIENCE="$2"
      shift 2
      ;;
    --service-account)
      SERVICE_ACCOUNT="$2"
      shift 2
      ;;
    --cloud-run-service)
      CLOUD_RUN_SERVICE="$2"
      shift 2
      ;;
    --transcripts-bucket)
      TRANSCRIPTS_BUCKET_NAME="$2"
      shift 2
      ;;
    --audio-work-bucket)
      AUDIO_WORK_BUCKET_NAME="$2"
      shift 2
      ;;
    --jobs-topic)
      JOBS_TOPIC="$2"
      shift 2
      ;;
    --ready-topic)
      READY_TOPIC="$2"
      shift 2
      ;;
    --raw-transcript-prefix)
      RAW_TRANSCRIPT_PREFIX="$2"
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

if [[ -z "$PROJECT_ID" || -z "$REGION" || -z "$SERVICE_URL" || -z "$PUSH_IDENTITY" ]]; then
  echo "Missing required arguments."
  usage
  exit 1
fi

OIDC_AUDIENCE="${OIDC_AUDIENCE:-$SERVICE_URL}"
RAW_TRANSCRIPT_PREFIX="${RAW_TRANSCRIPT_PREFIX#/}"
RAW_TRANSCRIPT_PREFIX="${RAW_TRANSCRIPT_PREFIX%/}"
if [[ -z "$RAW_TRANSCRIPT_PREFIX" ]]; then
  echo "ERROR: --raw-transcript-prefix must be non-empty."
  exit 1
fi
RAW_OBJECT_PREFIX="${RAW_TRANSCRIPT_PREFIX}/"
JOBS_DLQ_TOPIC="${JOBS_TOPIC}-dlq"
READY_DLQ_TOPIC="${READY_TOPIC}-dlq"
JOBS_SUB="${JOBS_TOPIC}-push"
READY_SUB="${READY_TOPIC}-push"
JOBS_DLQ_SUB="${JOBS_DLQ_TOPIC}-sub"
READY_DLQ_SUB="${READY_DLQ_TOPIC}-sub"

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

function bucket_exists() {
  local name="$1"
  gcloud storage buckets list --project "$PROJECT_ID" \
    --format="value(name)" | grep -qx "${name}"
}

function apply_lifecycle() {
  local bucket="$1"
  local lifecycle_json="$2"
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$lifecycle_json" >"$tmp"
  gcloud storage buckets update "gs://${bucket}" \
    --lifecycle-file="$tmp" \
    --project "$PROJECT_ID"
  rm -f "$tmp"
}

function ensure_bucket() {
  local name="$1"
  local lifecycle_json="$2"
  if bucket_exists "$name"; then
    echo "Bucket ${name} already exists."
  else
    echo "Creating bucket gs://${name} in ${REGION}..."
    gcloud storage buckets create "gs://${name}" \
      --project "$PROJECT_ID" \
      --location "$REGION" \
      --uniform-bucket-level-access
  fi
  echo "Applying lifecycle expiry on gs://${name}..."
  apply_lifecycle "$name" "$lifecycle_json"
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

function ensure_push_subscription() {
  local subscription="$1"
  local topic="$2"
  local endpoint="$3"
  local dlq_topic="$4"
  if gcloud pubsub subscriptions list --project "$PROJECT_ID" \
    --format="value(name)" | grep -q "/subscriptions/${subscription}$"; then
    echo "Subscription ${subscription} already exists."
  else
    echo "Creating push subscription ${subscription} -> ${endpoint}..."
    gcloud pubsub subscriptions create "$subscription" \
      --topic "$topic" \
      --push-endpoint "$endpoint" \
      --push-auth-service-account "$PUSH_IDENTITY" \
      --push-auth-token-audience "$OIDC_AUDIENCE" \
      --ack-deadline "$ACK_DEADLINE" \
      --min-retry-delay 10 \
      --max-retry-delay 600 \
      --message-retention-duration "${LIFECYCLE_DAYS}d" \
      --dead-letter-topic "$dlq_topic" \
      --max-delivery-attempts "$DLQ_MAX_DELIVERY" \
      --project "$PROJECT_ID"
  fi
}

function ensure_pull_subscription() {
  local subscription="$1"
  local topic="$2"
  if gcloud pubsub subscriptions list --project "$PROJECT_ID" \
    --format="value(name)" | grep -q "/subscriptions/${subscription}$"; then
    echo "Subscription ${subscription} already exists."
  else
    echo "Creating pull subscription ${subscription}..."
    gcloud pubsub subscriptions create "$subscription" \
      --topic "$topic" \
      --ack-deadline 60 \
      --message-retention-duration "${LIFECYCLE_DAYS}d" \
      --project "$PROJECT_ID"
  fi
}

function preflight_act_as() {
  echo "Preflight: iam.serviceAccounts.actAs on ${PUSH_IDENTITY}"
  local allowed
  allowed="$(gcloud iam service-accounts test-iam-permissions "$PUSH_IDENTITY" \
    --project "$PROJECT_ID" \
    --permissions iam.serviceAccounts.actAs \
    --format='value(permissions)' 2>/dev/null || true)"
  if [[ "$allowed" != *"iam.serviceAccounts.actAs"* ]]; then
    echo "ERROR: current credentials lack iam.serviceAccounts.actAs on ${PUSH_IDENTITY}."
    echo "OIDC push subscriptions and Cloud Scheduler require this permission."
    exit 1
  fi
}

function resolve_runtime_service_account() {
  if [[ -n "$SERVICE_ACCOUNT" ]]; then
    echo "Using runtime service account ${SERVICE_ACCOUNT}."
    return
  fi
  echo "Deriving runtime service account from Cloud Run service ${CLOUD_RUN_SERVICE}..."
  SERVICE_ACCOUNT="$(gcloud run services describe "$CLOUD_RUN_SERVICE" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --format='value(spec.template.spec.serviceAccountName)')"
  if [[ -z "$SERVICE_ACCOUNT" ]]; then
    local project_number
    project_number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
    SERVICE_ACCOUNT="${project_number}-compute@developer.gserviceaccount.com"
    echo "Cloud Run has no explicit service account; using default compute SA ${SERVICE_ACCOUNT}."
  else
    echo "Cloud Run runtime service account is ${SERVICE_ACCOUNT}."
  fi
  if [[ "$SERVICE_ACCOUNT" == "$PUSH_IDENTITY" ]]; then
    echo "WARNING: runtime and push identities are identical (${SERVICE_ACCOUNT})."
    echo "That is unusual; confirm this is intentional."
  fi
}

echo "===> Enabling required APIs..."
ensure_api_enabled "speech.googleapis.com"
ensure_api_enabled "pubsub.googleapis.com"
ensure_api_enabled "cloudscheduler.googleapis.com"
ensure_api_enabled "storage.googleapis.com"
ensure_api_enabled "run.googleapis.com"

preflight_act_as
resolve_runtime_service_account

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PUBSUB_SA="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
GCS_SA="service-${PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com"

TRANSCRIPTS_LIFECYCLE="$(cat <<EOF
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": ${LIFECYCLE_DAYS}, "matchesPrefix": ["${RAW_OBJECT_PREFIX}"]}
    }
  ]
}
EOF
)"

AUDIO_LIFECYCLE="$(cat <<EOF
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": ${LIFECYCLE_DAYS}}
    }
  ]
}
EOF
)"

echo "===> Ensuring buckets..."
ensure_bucket "$TRANSCRIPTS_BUCKET_NAME" "$TRANSCRIPTS_LIFECYCLE"
ensure_bucket "$AUDIO_WORK_BUCKET_NAME" "$AUDIO_LIFECYCLE"

echo "===> Ensuring Pub/Sub topics..."
ensure_topic "$JOBS_TOPIC"
ensure_topic "$JOBS_DLQ_TOPIC"
ensure_topic "$READY_TOPIC"
ensure_topic "$READY_DLQ_TOPIC"

echo "===> Ensuring subscriptions..."
ensure_push_subscription \
  "$JOBS_SUB" "$JOBS_TOPIC" "${SERVICE_URL}/transcribe-audio" "$JOBS_DLQ_TOPIC"
ensure_push_subscription \
  "$READY_SUB" "$READY_TOPIC" "${SERVICE_URL}/transcript-ready" "$READY_DLQ_TOPIC"
ensure_pull_subscription "$JOBS_DLQ_SUB" "$JOBS_DLQ_TOPIC"
ensure_pull_subscription "$READY_DLQ_SUB" "$READY_DLQ_TOPIC"

echo "===> Configuring IAM..."
gcloud run services add-iam-policy-binding "$CLOUD_RUN_SERVICE" \
  --member "serviceAccount:${PUSH_IDENTITY}" \
  --role "roles/run.invoker" \
  --region "$REGION" \
  --project "$PROJECT_ID" >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/speech.client" >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/datastore.user" >/dev/null

gcloud storage buckets add-iam-policy-binding "gs://${TRANSCRIPTS_BUCKET_NAME}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/storage.objectAdmin" >/dev/null

gcloud storage buckets add-iam-policy-binding "gs://${AUDIO_WORK_BUCKET_NAME}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/storage.objectAdmin" >/dev/null

gcloud pubsub topics add-iam-policy-binding "$JOBS_TOPIC" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" \
  --role "roles/pubsub.publisher" \
  --project "$PROJECT_ID" >/dev/null

gcloud pubsub topics add-iam-policy-binding "$JOBS_DLQ_TOPIC" \
  --member "serviceAccount:${PUBSUB_SA}" \
  --role "roles/pubsub.publisher" \
  --project "$PROJECT_ID" >/dev/null

gcloud pubsub topics add-iam-policy-binding "$READY_DLQ_TOPIC" \
  --member "serviceAccount:${PUBSUB_SA}" \
  --role "roles/pubsub.publisher" \
  --project "$PROJECT_ID" >/dev/null

gcloud pubsub subscriptions add-iam-policy-binding "$JOBS_SUB" \
  --member "serviceAccount:${PUBSUB_SA}" \
  --role "roles/pubsub.subscriber" \
  --project "$PROJECT_ID" >/dev/null

gcloud pubsub subscriptions add-iam-policy-binding "$READY_SUB" \
  --member "serviceAccount:${PUBSUB_SA}" \
  --role "roles/pubsub.subscriber" \
  --project "$PROJECT_ID" >/dev/null

gcloud pubsub topics add-iam-policy-binding "$READY_TOPIC" \
  --member "serviceAccount:${GCS_SA}" \
  --role "roles/pubsub.publisher" \
  --project "$PROJECT_ID" >/dev/null

echo "===> Ensuring prefix-filtered GCS notification..."
EXISTING_NOTIFICATION="$(
  gcloud storage buckets notifications list "gs://${TRANSCRIPTS_BUCKET_NAME}" \
    --format="csv[no-heading](topic,payload_format,object_name_prefix)" \
    --project "$PROJECT_ID" 2>/dev/null || true
)"
if echo "$EXISTING_NOTIFICATION" | grep -q "${READY_TOPIC}" && \
   echo "$EXISTING_NOTIFICATION" | grep -Fq "${RAW_OBJECT_PREFIX}"; then
  echo "GCS notification on ${RAW_OBJECT_PREFIX} -> ${READY_TOPIC} already exists."
else
  gcloud storage buckets notifications create "gs://${TRANSCRIPTS_BUCKET_NAME}" \
    --topic "$READY_TOPIC" \
    --event-types OBJECT_FINALIZE \
    --object-prefix "${RAW_OBJECT_PREFIX}" \
    --payload-format json \
    --project "$PROJECT_ID"
fi

echo "===> Ensuring Cloud Scheduler job..."
if gcloud scheduler jobs describe "$SCHEDULER_JOB" \
  --location "$REGION" \
  --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Updating scheduler job ${SCHEDULER_JOB}..."
  gcloud scheduler jobs update http "$SCHEDULER_JOB" \
    --location "$REGION" \
    --schedule "every 15 minutes" \
    --uri "${SERVICE_URL}/reconcile-transcripts" \
    --http-method POST \
    --oidc-service-account-email "$PUSH_IDENTITY" \
    --oidc-token-audience "$OIDC_AUDIENCE" \
    --project "$PROJECT_ID"
else
  echo "Creating scheduler job ${SCHEDULER_JOB}..."
  gcloud scheduler jobs create http "$SCHEDULER_JOB" \
    --location "$REGION" \
    --schedule "every 15 minutes" \
    --uri "${SERVICE_URL}/reconcile-transcripts" \
    --http-method POST \
    --oidc-service-account-email "$PUSH_IDENTITY" \
    --oidc-token-audience "$OIDC_AUDIENCE" \
    --project "$PROJECT_ID"
fi

echo "===> Transcription infrastructure setup complete."
echo "Push identity ${PUSH_IDENTITY} can invoke ${CLOUD_RUN_SERVICE}."
echo "Runtime account ${SERVICE_ACCOUNT} has speech.client and datastore.user."
echo "GCS notification filter is ${RAW_OBJECT_PREFIX}."
