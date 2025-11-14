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
| `NODE_ENV` | ➖ | `development` | Used for logging context |
| `GOOGLE_APPLICATION_CREDENTIALS` | ➖ | – | Path to service account JSON when running locally |
| `SMOKE_ID_TOKEN` | ➖ | – | Firebase ID token for smoke test authentication |
| `SMOKE_FUNCTIONS_URL` | ➖ | – | Base URL to Firebase Functions endpoint (for smoke test) |

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
- Never commit real secrets. Only `.env.example` files are tracked in Git.

## Validation Checklist

1. Copy the corresponding `.env.example` file for each service and populate required fields.
2. Run `npm test` inside `video-processing-service` to ensure env-dependent logic passes.
3. Execute `./video-processing-service/deploy.sh` to verify deploy script uses the documented variables.
4. Run `firebase functions:config:get` to confirm Firebase functions have matching values.

