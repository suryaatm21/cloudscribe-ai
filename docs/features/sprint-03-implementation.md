# Sprint 3 – AI Notes Service Implementation

## Overview

Sprint 3 introduces an automated notes generation workflow that listens for completed transcripts, generates structured study notes via Vertex AI Gemini, and stores the markdown output in a dedicated bucket. The flow is fully asynchronous and feature-flagged, ensuring we can hot-toggle per workspace without redeploying.

## Components

- **notes-service**: Cloud Run service exposing `/notes/:jobId` for Pub/Sub push deliveries. It validates payloads, fetches transcript JSON from GCS, loads the selected prompt template, calls Gemini, writes markdown to `atmuri-yt-notes`, and persists Firestore metadata under `videos/{videoId}/notes/{noteId}`.
- **video-processing-service**: When `/transcribe-audio` marks a transcript as `done`, it now evaluates feature flags and publishes a message to the `notes-jobs` topic containing `videoId`, `transcriptId`, `noteId`, `transcriptGcsPath`, and `userId`.
- **api-service**: Provides callable functions to fetch signed URLs for notes (`getNotesUrl`) and to read/update user-level feature flags (`getNotesFeatureFlag`, `setNotesFeatureFlag`).
- **Prompt templates**: Stored in `notes-service/prompts/` and mirrored to `gs://atmuri-yt-notes-prompts`. Each template contains `id`, `version`, `template`, and optional metadata. The service caches templates for five minutes.

## Feature Flags

1. **Global flag** (`config/features.notesEnabled` + `ENABLE_NOTES` env) must be `true` to enqueue jobs.
2. **Per-user flag** (`users/{userId}/settings/preferences.notesEnabled`) allows workspace-level opt-out without redeploying.
3. Both the video-processing service and notes-service enforce the hybrid logic, preventing unexpected runs if either side disables the feature.

## Deployment Steps

1. Provision infrastructure via `./scripts/setup-notes-infra.sh --project <id> --region <region> --service-account <svc>@<project>.iam.gserviceaccount.com --push-endpoint <notes_service_url>/notes`.
2. Upload prompt templates with `./scripts/upload-prompts.sh <bucket>`.
3. Deploy `notes-service` using `notes-service/deploy.sh` or the provided `cloudbuild.yaml` trigger.
4. Confirm Pub/Sub push deliveries succeed and that the `/health` endpoint returns status `ok`.

## Observability & Monitoring

- Structured logs include `videoId`, `transcriptId`, `noteId`, `promptVersion`, and Pub/Sub `messageId`.
- GCS object paths follow `${videoId}/${noteId}.md`, simplifying manual audits.
- Add Cloud Monitoring alerting on the `notes-jobs-dlq` topic to surface failed generations.

## Troubleshooting

| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| Notes document stuck in `pending` | Feature flag disabled or Pub/Sub delivery failure | Check `config/features`, user settings, and Pub/Sub subscription metrics |
| Notes document `failed` with `Notes generation disabled` | Hybrid flag evaluated to false | Confirm user preference and global flag |
| `getNotesUrl` returns `failed-precondition` | Markdown not yet available | Inspect notes-service logs for errors and ensure Vertex AI quota is sufficient |
| Prompt changes not reflected | Cached template still valid | Run `scripts/upload-prompts.sh` then redeploy or wait for cache expiry |

## Acceptance Tests

- Run `scripts/smoke-test.sh` to validate upload → transcript → notes pipeline end-to-end.
- `notes-service` Jest suite covers prompt loading, feature flags, and prompt materialization helpers.
- `video-processing-service` includes a unit test ensuring notes jobs publish to the correct topic.
