# Environment Configuration

This document captures all required environment variables, service accounts, and external dependencies needed to boot every service locally and deploy to Cloud Run.

## Video Processing Service (`video-processing-service`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PROJECT_ID` | ✅ | – | Google Cloud project that owns Artifact Registry and Cloud Run |
| `REGION` | ✅ | `us-central1` | Region for Artifact Registry and Cloud Run |
| `REPOSITORY_NAME` | ✅ | `video-processing-service` | Artifact Registry repository name |
| `SERVICE_NAME` | ✅ | `video-processing-service` | Cloud Run service name |
| `RAW_VIDEO_BUCKET_NAME` | ✅ | `atmuri-yt-raw-videos` | Bucket receiving uploads from the web client |
| `PROCESSED_VIDEO_BUCKET_NAME` | ✅ | `atmuri-yt-processed-videos` | Bucket serving processed media |
| `PROCESSING_MAX_ATTEMPTS` | ✅ | `3` | Number of retries before marking a video as failed |
| `SERVICE_VERSION` | ➖ | `dev` | Overrides version reported by `/health` |
| `ENABLE_TRANSCRIPTION` | ➖ | `false` | When `true`, `/process-video` queues Speech jobs and `/transcribe-audio` plus `/reconcile-transcripts` run. Cloud Build deploys this from `_ENABLE_TRANSCRIPTION` (still `false`). Infra is provisioned; Cloud Scheduler hits `/reconcile-transcripts` every 15 minutes, so that endpoint must return 200 when the flag is off. |
| `SPEECH_PROCESSING_STRATEGY` | ➖ | `STANDARD` | **LAUNCH BLOCKER.** Speech-to-Text v2 `batchRecognize` processing strategy. Accepted values (exact, case-sensitive): `STANDARD` (default; maps to `PROCESSING_STRATEGY_UNSPECIFIED`; processes immediately at ~$0.016/min so test runs finish in minutes) or `DYNAMIC_BATCHING` (~$0.003/min, fulfilled within 24 hours). Unrecognized values refuse to start the service. Cloud Build deploys this from `_SPEECH_PROCESSING_STRATEGY`. `STANDARD` is 5× the batch price — switch to `DYNAMIC_BATCHING` before production lecture audio. |
| `TRANSCRIPTS_BUCKET_NAME` | ➖ | `atmuri-yt-transcripts` | Speech result + normalized transcript bucket. Cloud Build deploys this from `_TRANSCRIPTS_BUCKET_NAME` so the worker matches provisioned infra instead of relying on the code default. |
| `AUDIO_WORK_BUCKET_NAME` | ➖ | `atmuri-yt-audio-work` | Intermediate FLAC bucket. Cloud Build deploys this from `_AUDIO_WORK_BUCKET_NAME`. |
| `TRANSCRIPTION_TOPIC_NAME` | ➖ | `transcription-jobs` | Pub/Sub topic `/process-video` publishes jobs to. Cloud Build deploys this from `_TRANSCRIPTION_TOPIC_NAME`. |
| `NODE_ENV` | ➖ | `development` | Used for logging context |
| `GOOGLE_APPLICATION_CREDENTIALS` | ➖ | – | Path to service account JSON when running locally |
| `SMOKE_ID_TOKEN` | ➖ | – | Firebase ID token for smoke test authentication |
| `SMOKE_FUNCTIONS_URL` | ➖ | – | Base URL to Firebase Functions endpoint (for smoke test) |
| `RUN_LOCAL_TESTS` | ➖ | `false` | Set to `true` to run npm build/tests inside `deploy.sh` before container builds |

**Required APIs**

- Cloud Run Admin API
- Artifact Registry API
- Cloud Build API
- Cloud Logging API
- Cloud Storage JSON API
- Firestore API
- Pub/Sub API

**Service Accounts**

- `video-processing-service@<PROJECT_ID>.iam.gserviceaccount.com`
  - `roles/run.invoker`, `roles/run.admin`
  - `roles/artifactregistry.writer`
  - `roles/storage.objectAdmin` on both buckets
  - `roles/pubsub.subscriber` for processing subscription

## Firebase Functions API (`api-service/functions`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GCLOUD_PROJECT` | ✅ | – | Firebase/GCP project ID |
| `RAW_VIDEO_BUCKET_NAME` | ✅ | `atmuri-yt-raw-videos` | Bucket used to mint signed upload URLs |
| `FIREBASE_API_KEY` | ✅ | – | Client API key for callable functions |
| `FIREBASE_AUTH_DOMAIN` | ✅ | – | Auth domain for Firebase client |
| `GOOGLE_APPLICATION_CREDENTIALS` | ➖ | – | Needed locally to authenticate admin SDK |

**Required APIs**

- Firebase Management API
- Cloud Functions API
- Cloud Storage JSON API
- Identity Toolkit API

**Service Accounts**

- Firebase admin SDK default service account requires `roles/storage.objectCreator` on the raw bucket to issue signed URLs.

**Transcription signing IAM**

`scripts/setup-transcription-infra.sh` grants `roles/storage.objectViewer` on the transcripts bucket to the Firebase Functions runtime identity so `getTranscriptUrl` can mint V4 signed URLs.

That binding is pinned to the identity resolved on that run. It does **not** automatically follow a later identity split: if `getTranscriptUrl` is redeployed with a different service account, rerun the script (or pass `--functions-service-account <new-email>`) so the new identity receives `objectViewer` and `iam.serviceAccountTokenCreator`. The previous identity keeps its binding until it is removed by hand.

If the script cannot describe the gen2 Functions services, pass `--functions-service-account` explicitly. It will not guess the Compute Engine default SA.

## Web Client (`yt-web-client`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | ✅ | – | Browser key for Firebase SDK |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | ✅ | – | Authentication domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | ✅ | – | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | ✅ | – | Storage bucket for static assets |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | ✅ | – | Firebase messaging sender id |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | ✅ | – | Firebase web app id |
| `NEXT_PUBLIC_API_FUNCTIONS_URL` | ✅ | – | Base URL for callable HTTPS API |
| `NEXT_PUBLIC_VIDEO_PROCESSOR_URL` | ➖ | – | Optional direct link to Cloud Run health endpoint |

## Secret Management

- Local development uses `.env` files located beside each service; production values are stored in Secret Manager and referenced by Cloud Run/Cloud Functions.
- Never commit real secrets. `.env.example` files are tracked as templates. `yt-web-client/.env.production` is also tracked on purpose: it holds only `NEXT_PUBLIC_*` Firebase web config, which is public-by-design and must be present at Docker build time so `next build` can inline it. Real secrets stay out of Git.

## Validation Checklist

1. Copy the corresponding `.env.example` file (kept beside each service, e.g., `video-processing-service/.env`) and populate required fields.
2. Run `npm test` inside `video-processing-service` to ensure env-dependent logic passes.
3. Execute `./video-processing-service/deploy.sh` to verify deploy script uses the documented variables.
4. Run `firebase functions:config:get` to confirm Firebase functions have matching values.

## Pre-launch checklist (transcription)

Transcription infrastructure **exists** in `yt-clone-385f4` as of 20 August 2026. `scripts/setup-transcription-infra.sh` was run and verified idempotent. Cloud Scheduler job `reconcile-transcripts` is ENABLED every 15 minutes. `ENABLE_TRANSCRIPTION` remains **false**. No Speech call has been made and no real Speech v2 output has been observed.

The new buckets also carry GCP's default 7-day soft delete (`retentionDurationSeconds: 604800`), which the script did not set.

Do not turn `ENABLE_TRANSCRIPTION` on for real lecture audio until every remaining item is done:

1. ~~Run `scripts/setup-transcription-infra.sh`~~ **Done** (buckets `atmuri-yt-transcripts` / `atmuri-yt-audio-work`, topics, push/DLQ subscriptions, `raw/` notification, scheduler). Rerun is safe (idempotent) but not required.
2. Confirm `_ENABLE_TRANSCRIPTION` stays `"false"` on the Cloud Build trigger until you intend to turn transcription on.
3. **LAUNCH BLOCKER — Speech price:** set `_SPEECH_PROCESSING_STRATEGY=DYNAMIC_BATCHING` on the `video-processing-service` Cloud Build trigger. The code and substitution default is `STANDARD` (~$0.016/min, 5× `DYNAMIC_BATCHING`) so local/test runs finish in minutes. Shipping `STANDARD` to production is a cost defect, not an oversight you can notice later.
4. `getTranscriptUrl` is deployed as Cloud Run service `gettranscripturl` (runtime SA `262816123746-compute@developer.gserviceaccount.com`).
5. Flip `_ENABLE_TRANSCRIPTION=true` on the trigger, then deploy the worker.
6. Update README, this file, and `docs/cost-and-credits.md` in the same PR as the flag flip.

Existing subscriptions were created without `--expiration-period=never` and currently expire after 31 days idle. The setup script now passes that flag; live subscriptions still need a one-time `gcloud pubsub subscriptions update ... --expiration-period=never` (do not run it from CI).

