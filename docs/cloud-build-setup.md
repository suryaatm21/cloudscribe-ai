# Cloud Build + GitHub Integration

✅ **Now Implemented!** Continuous Deployment is active.

## Triggers Active

Two Cloud Build triggers are now deployed and monitoring the `cloudscribe-ai` repository:

1. **`video-processing-service`** → Deploys `video-processing-service` Cloud Run service
2. **`web-client`** → Deploys `cloudscribe-ai` Cloud Run service

Both trigger on push to `main` branch.

## How It Works

1. You commit and push code to `main` on GitHub
2. Cloud Build detects the push and triggers the appropriate service's build
3. Build steps:
   - Build Docker image for `linux/amd64`
   - Push to Artifact Registry
   - Deploy to Cloud Run
4. New revision goes live automatically

## Configuration

### Triggers

- Event: **Push to a branch**
- Branch (regex): `^main$`
- Configuration: **Cloud Build configuration file**
- Locations:
  - `video-processing-service/cloudbuild.yaml`
  - `yt-web-client/cloudbuild.yaml`
- Service account: `262816123746-compute@developer.gserviceaccount.com`

### IAM Permissions (Applied)

- `roles/run.admin` — Deploy to Cloud Run
- `roles/iam.serviceAccountUser` — Act as service account

## Test the Triggers

1. Make a small change to any file in either service directory
2. Commit and push to `main`:
   ```bash
   git add .
   git commit -m "test: ci/cd trigger"
   git push origin main
   ```
3. Monitor the build: https://console.cloud.google.com/cloud-build/builds?project=yt-clone-385f4
4. Once the build succeeds, verify the service deployed: https://console.cloud.google.com/run?project=yt-clone-385f4

## Rollback Strategy

- Use Cloud Run revisions to roll back if a bad build ships (`Deployments → Manage revisions → Roll back`)
- Disable the trigger temporarily from Cloud Build if you need to pause automated deploys
