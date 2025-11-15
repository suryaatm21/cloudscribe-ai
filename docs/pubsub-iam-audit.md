# Pub/Sub IAM Audit

## Current Topics and Subscriptions

| Topic | Subscription | Delivery | Push Endpoint |
| --- | --- | --- | --- |
| `video-uploads-topic` | `video-processing-subscription` | Push | `https://video-processing-service-<HASH>-uc.a.run.app/process-video` |

```bash
gcloud pubsub topics list --project "${PROJECT_ID}"
gcloud pubsub subscriptions describe video-processing-subscription \
  --project "${PROJECT_ID}"
```

## Required IAM Roles

| Principal | Scope | Roles | Purpose |
| --- | --- | --- | --- |
| `serviceAccount:video-processing-service@${PROJECT_ID}.iam.gserviceaccount.com` | Subscription `video-processing-subscription` | `roles/pubsub.subscriber` | Receive push deliveries and manage ack IDs |
| `serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com` (default Cloud Run runtime) | Artifact Registry, GCS buckets | `roles/run.invoker`, `roles/storage.objectAdmin`, `roles/artifactregistry.reader` | Allow service to fetch artifacts and objects |
| `serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com` | Pub/Sub subscription | `roles/iam.serviceAccountTokenCreator` | Signs OIDC tokens for push auth |
| `serviceAccount:service-${PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com` | Pub/Sub topic | `roles/pubsub.publisher` | Lets Cloud Storage publish to topic |

## Verification Commands

```bash
# Confirm Cloud Storage notification publishes to the expected topic
gcloud storage buckets notifications list gs://atmuri-yt-raw-videos

# Inspect IAM policy on the Pub/Sub topic
gcloud pubsub topics get-iam-policy video-uploads-topic \
  --project "${PROJECT_ID}"

# Inspect IAM policy on the subscription
gcloud pubsub subscriptions get-iam-policy video-processing-subscription \
  --project "${PROJECT_ID}"

# Ensure Cloud Run service account has subscriber role
gcloud pubsub subscriptions get-iam-policy video-processing-subscription \
  --flatten="bindings[].members" \
  --format="table(bindings.role, bindings.members)" \
  --project "${PROJECT_ID}"

# Validate push authentication service account
gcloud pubsub subscriptions describe video-processing-subscription \
  --project "${PROJECT_ID}" \
  --format="value(pushConfig.oidcToken.serviceAccountEmail)"
```

## Gaps & Follow-ups

- 🔐 **Confirm** `video-processing-service` runtime account is restricted to the single subscription to avoid over-broad permissions.
- 🧾 **Document** approval for Cloud Storage service account to publish to other topics (currently unrestricted).
- 📎 **Automate** these IAM checks in CI by adding a `gcloud` audit step before deployment.

