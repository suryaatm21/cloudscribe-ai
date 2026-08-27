# Cloud Build + GitHub Integration

✅ **Now Implemented!** Continuous Deployment is active.

## Triggers Active

Three Cloud Build triggers monitor the `cloudscribe-ai` repository on push to `main`:

| Trigger | Config | Deploys |
| --- | --- | --- |
| `video-processing-service` | `video-processing-service/cloudbuild.yaml` | Cloud Run worker `video-processing-service` (internal ingress) |
| `web-client` | `yt-web-client/cloudbuild.yaml` | Cloud Run service `cloudscribe-ai` (public Next.js UI) |
| `api-service` | `api-service/cloudbuild.yaml` | Firebase Cloud Functions only (`getVideos`, `getTranscriptUrl`, `generateUploadUrl`, `getUploadUrl`, `createUser`, …) |

The `api-service` trigger is scoped to **`api-service/**`** so unrelated merges do not redeploy Functions.

### Failure mode this closes

Before the `api-service` trigger, a merged Functions fix could ship with green CI while production kept serving the previous deployment. Example: PR #15 fixed a cross-user data leak in `getVideos`, both existing triggers passed, and production still ran the unfiltered query from 2026-08-20 until someone ran `firebase deploy --only functions` by hand. That is the same source-versus-deployed divergence class as Firestore rules that were merged but never deployed.

**Firestore rules and indexes are not deployed by this trigger.** They remain manual (`firebase deploy --only firestore:rules` / `firestore:indexes`) so rule changes get deliberate review and deploy.

## How It Works

1. You commit and push code to `main` on GitHub
2. Cloud Build detects the push and triggers the matching service build
3. Build steps:
   - **Cloud Run services:** build Docker image for `linux/amd64` → Artifact Registry → `gcloud run deploy`
   - **Functions:** `npm ci` in `api-service/functions`, then `firebase deploy --only functions` (predeploy runs lint + build)
4. New revision goes live automatically

## Configuration

### Triggers

- Event: **Push to a branch**
- Branch (regex): `^main$`
- Configuration: **Cloud Build configuration file**
- Locations:
  - `video-processing-service/cloudbuild.yaml`
  - `yt-web-client/cloudbuild.yaml`
  - `api-service/cloudbuild.yaml` (included files: `api-service/**`)
- Service account: `262816123746-compute@developer.gserviceaccount.com`

### IAM Permissions

**Already bound (project `yt-clone-385f4`):**

- `roles/run.admin` — Deploy to Cloud Run (worker, web client, gen2 Functions)
- `roles/iam.serviceAccountUser` — Act as runtime service account
- `roles/editor` — Broad project editor (covers Cloud Functions deploy, Artifact Registry, Storage staging, and internal Cloud Build jobs triggered by Firebase)

**Recommended explicit bindings if `roles/editor` is ever removed** (least-privilege target for Functions-only deploy):

- `roles/cloudfunctions.admin` — Create/update/delete Cloud Functions
- `roles/artifactregistry.writer` — Push function container images
- `roles/storage.objectAdmin` — Upload function source to the Firebase staging bucket
- `roles/cloudbuild.builds.editor` — Allow Firebase to run build jobs for gen2 functions
- `roles/firebase.admin` — Firebase project deploy operations (or `roles/firebase.developAdmin` if sufficient)

Grant these on the Cloud Build service account before merging the `api-service` trigger if `roles/editor` is not present.

### Create or update the `api-service` trigger

```bash
gcloud builds triggers create github \
  --name=api-service \
  --region=global \
  --project=yt-clone-385f4 \
  --repo-name=cloudscribe-ai \
  --repo-owner=suryaatm21 \
  --branch-pattern='^main$' \
  --build-config=api-service/cloudbuild.yaml \
  --included-files='api-service/**' \
  --service-account=projects/yt-clone-385f4/serviceAccounts/262816123746-compute@developer.gserviceaccount.com
```

## Test the Triggers

1. Make a small change under the service directory you want to exercise
2. Commit and push to `main`:
   ```bash
   git add .
   git commit -m "test: ci/cd trigger"
   git push origin main
   ```
3. Monitor the build: https://console.cloud.google.com/cloud-build/builds?project=yt-clone-385f4
4. Once the build succeeds, verify the deployment:
   - Cloud Run: https://console.cloud.google.com/run?project=yt-clone-385f4
   - Functions: https://console.firebase.google.com/project/yt-clone-385f4/functions

## Rollback Strategy

- **Cloud Run:** Use revisions to roll back (`Deployments → Manage revisions → Roll back`)
- **Functions:** Redeploy a known-good commit from `main`, or roll back individual function revisions in Cloud Run (gen2 Functions are Cloud Run services)
- Disable the trigger temporarily from Cloud Build if you need to pause automated deploys
