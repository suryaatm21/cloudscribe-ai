# Cloud Build + GitHub Integration

Set up the trigger after the end-to-end upload pipeline is stable and manual deploys are no longer needed for debugging. Automating too early makes it harder to diagnose issues.

- NOT YET IMPLEMENTED

## Prerequisites

- `video-processing-service/cloudbuild.yaml` committed on `main`.
- Service account permissions: Cloud Build needs to deploy Cloud Run and push to Artifact Registry (roles/cloudbuild.builds.editor, roles/run.admin, roles/artifactregistry.writer).
- GitHub repository owner admin access.

## One-Time GCP Configuration

1. Open https://console.cloud.google.com/cloud-build (project `yt-clone-385f4`).
2. Enable Cloud Build API if prompted.
3. Connect repository: **Triggers → Manage Repositories → Connect Repository → GitHub → Authorize**.
4. Select `suryaatm21/cloudscribe-ai` and confirm access.

## Create the Trigger

1. In Cloud Build, click **Create Trigger**.
2. Name: `video-processing-deploy`.
3. Event: **Push to a branch**; Branch (regex): `^main$`.
4. Configuration: **Cloud Build configuration file**.
5. Location: `video-processing-service/cloudbuild.yaml`.
6. Substitutions: leave default (`_REGION` already set in the file).
7. Service account: choose a principal with Cloud Run deploy + Artifact Registry permissions (or accept default and grant roles).
8. Save.

## Test the Trigger

1. Commit a trivial change under `video-processing-service/`.
2. Push to `main` or open a PR that merges into `main`.
3. Monitor progress under **Cloud Build → History**. On success, Cloud Run deploys the new revision automatically.

## Rollback Strategy

- Use Cloud Run revisions to roll back if a bad build ships (`Deployments → Manage revisions → Roll back`).
- Disable the trigger temporarily from Cloud Build if you need to pause automated deploys.
