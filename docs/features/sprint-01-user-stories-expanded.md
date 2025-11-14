# Sprint 1 – Pipeline Stabilization: Expanded User Stories

## Project Direction & Vision

**cloudscribe-ai** is transforming from a YouTube clone to an AI-powered study platform. Sprint 1 stabilizes the **media ingestion and processing pipeline** — the foundation for adding transcription (Sprint 2), AI note-generation (Sprint 3), RAG-based retrieval (Sprint 4), live transcription (Sprint 6), and a study chatbot (Sprint 5).

The core flow is: **Upload → GCS → Pub/Sub → Cloud Run processing → Firestore metadata → Cloud Storage output**.

---

## Deliverables with Technical Context

### 1. **Reliable Media Processing Pipeline**

**User Story:**  
As a student, I want my uploaded videos to be processed reliably in the background so that I can trust my content will always become viewable without manual intervention.

**Notes for You:**

- **Why it matters**: Pub/Sub can retry messages infinitely; without deduplication logic, the same video could be processed multiple times, creating duplicates in Firestore and GCS.
- **Current implementation**: `video-processing-service` checks `isVideoNew()` in Firestore before processing. If a video is already being processed, it returns 200 (success) to Pub/Sub to prevent retries.
- **Tradeoff**: Push subscriptions have a 600s (10 min) timeout. If processing takes longer, the HTTP connection closes but Cloud Run may still write to storage. We accept potential duplicate processing in exchange for a simpler architecture vs. pull subscriptions (which require more infra).
- **Next**: For Sprint 2 (transcription), Speech-to-Text v2 may take 5-30 min depending on video length. Plan to move to Cloud Tasks or Firestore transaction-based locking for longer jobs.

---

### 2. **Clear System Health Checks**

**User Story:**  
As a product owner, I want a health dashboard and API checks for the processing service so that I can quickly see if the system is healthy and resolve incidents before students are impacted.

**Notes for You:**

- **Why it matters**: Cloud Run auto-scales containers; if the `/health` endpoint fails, GCP may think the service is dead and spin up unnecessary replicas, wasting budget.
- **Current implementation**: `index.ts` has a `/health` endpoint that checks GCS bucket access and Firestore connectivity. Returns 200 (ok) or 503 (unhealthy) with structured JSON.
- **Technical decision**: Health checks should be **fast** (<1s) and **independent** of downstream services where possible. We check buckets/Firestore because they're critical; we don't call Speech-to-Text API on health check (that would add latency).
- **Monitoring**: Cloud Run logs 5xx errors automatically. Set up Cloud Monitoring alert: if 5xx rate >2% for 15 min, page on-call engineer.
- **Tradeoff**: Simple synchronous health checks vs. distributed tracing. Sprint 1 focuses on health; Sprint 2 adds Cloud Trace instrumentation for deeper observability.

---

### 3. **End-to-End Smoke Test for Uploads**

**User Story:**  
As an engineer, I want a one-command smoke test that uploads a sample file and verifies it flows through GCS, Pub/Sub, Cloud Run, and Firestore so that we can confidently validate the pipeline after each change or deploy.

**Notes for You:**

- **Why it matters**: Manual testing is error-prone and doesn't scale. A smoke test runs after every deploy (via Cloud Build) to catch regressions immediately.
- **Test flow**:
  1. Call Firebase Function `getSignedUrl()` to get upload credentials
  2. Upload test video (e.g., 10 MB) to `raw-videos` bucket via signed URL
  3. GCS fires Pub/Sub event (configured via Cloud Storage → Pub/Sub trigger)
  4. Cloud Run receives message and processes video
  5. Query Firestore for document with status "processed"
  6. Verify processed video exists in `processed-videos` bucket
- **Technical decision**: Smoke test is **blocking** (must pass before deploy). It's shallow (doesn't test UI, auth, or transcription) but catches pipeline breaks early.
- **Tradeoff**: Takes ~30s to run; in sprint 2+ consider parallel smoke tests (upload multiple videos simultaneously) to validate concurrency.

---

### 4. **Documented Configuration and Secrets**

**User Story:**  
As an onboarding teammate, I want clear `.env` examples and a config matrix for every service so that I can run the system locally or in a new environment without guessing required settings.

**Notes for You:**

- **Why it matters**: New engineers shouldn't need to reverse-engineer the codebase to find what env vars are required. Reduces onboarding time and prevents "works on my machine" bugs.
- **Current state**: No `.env.example` files exist. Need to create:
  - `video-processing-service/.env.example`
  - `api-service/functions/.env.example`
  - `yt-web-client/.env.example`
- **Config matrix** documents:
  - Variable name (e.g., `RAW_VIDEO_BUCKET`)
  - Type (string, number, boolean)
  - Required or optional
  - Default value (or N/A)
  - Owner (who manages this in prod: DevOps, Backend, etc.)
- **Security consideration**: Never commit `.env` files with real credentials. Use Secret Manager or `.env.local` (gitignored) locally. In Cloud Run, inject secrets via environment variables from Secret Manager.
- **Tradeoff**: More docs to maintain as services grow; but worth it for team velocity.

---

### 5. **Versioned, Test-Gated Deployments**

**User Story:**  
As a stakeholder, I want every deployment to be tied to a specific git commit and to run tests automatically before going live so that rollbacks are easy and production always runs known-good builds.

**Notes for You:**

- **Why it matters**: If production breaks, you need to know exactly which code is running and be able to rollback in 2 minutes, not 2 hours.
- **Current implementation**: Cloud Build triggers on `main` push. Builds tag Docker images with `$COMMIT_SHA` (e.g., `video-processing-service:a7c1be7`). Deploys with tagged image.
- **Testing gate**: `cloudbuild.yaml` can run `npm test` before building (not yet implemented in this sprint but documented for future).
- **Rollback strategy**: Cloud Run keeps 100 revisions. To rollback: `gcloud run services update-traffic video-processing-service --to-revisions=PREVIOUS_SHA=100%`
- **Tradeoff**: Slightly slower deploys (5-10 min for build + push + deploy) vs. instant manual deploys. Worth it for safety in production.
- **Future**: Add GitHub branch protection rules: require passing tests before merge to `main`.

---

### 6. **Traceable Processing Jobs**

**User Story:**  
As a support engineer, I want each processing job to have a unique ID that appears consistently in logs so that I can trace a user's upload across services when investigating issues.

**Notes for You:**

- **Why it matters**: Without correlation IDs, debugging a failed upload requires grepping through timestamps and filenames across Cloud Run logs, Pub/Sub deliveries, and Firestore. With correlation IDs, you grep one ID and see the full journey.
- **Implementation**: Generate `jobId = job-${videoId}-${timestamp}` when Cloud Run receives Pub/Sub message. Log it with every operation:
  ```json
  {
    "jobId": "job-abc123-1700000000",
    "severity": "INFO",
    "message": "Starting video processing"
  }
  ```
- **Cloud Logging**: Use structured logs (JSON format). Cloud Logging can parse and index `jobId` field, enabling queries like `jobId:"job-abc123"`.
- **Tradeoff**: Adds ~5 bytes per log line; negligible cost vs. massive debugging benefit.
- **Future**: Implement OpenTelemetry for distributed tracing across services (Sprint 2+). jobId can be the trace ID for unified observability.

---

### 7. **Validated Pub/Sub Permissions**

**User Story:**  
As a platform owner, I want service accounts and Pub/Sub permissions hardened and documented so that messages are delivered securely and reliably without hidden IAM surprises.

**Notes for You:**

- **Why it matters**: If IAM is misconfigured, Pub/Sub silently fails to deliver messages (no error thrown). Videos upload but never process. Hard to debug.
- **Current setup**:
  - Pub/Sub subscription uses **push delivery** to Cloud Run endpoint `/process-video`
  - Cloud Run service account needs `roles/run.invoker` to receive Pub/Sub messages
  - Cloud Storage bucket fires Pub/Sub events (configured via Cloud Storage → Pub/Sub notification)
  - Cloud Run service account needs `roles/storage.objectViewer` to read raw videos from GCS
  - Firestore service account needs `roles/datastore.user` to write processed videos metadata
- **SPIKE task**: Audit current IAM bindings and document in `docs/iam-matrix.md`. Check for overly permissive roles (e.g., `Editor` on service accounts—should be granular).
- **Tradeoff**: Tight IAM is more secure but requires more setup. Worth it to prevent accidental data leaks or deleted videos.
- **Future**: Enable Cloud Audit Logs to track who changed permissions (compliance requirement for enterprise customers).

---

### 8. **Operational Quality Gates**

**User Story:**  
As an executive, I want success metrics such as error rate < 2% and repeatable smoke tests so that we can objectively say the core pipeline is stable before investing in AI features.

**Notes for You:**

- **Why it matters**: Investors want proof that the foundation is solid before funding new feature development. "It works on my laptop" isn't credible; "error rate <2% for 48h" is.
- **Success metrics**:
  - **Smoke test pass rate**: 100% (runs after every deploy, must not fail)
  - **Error rate**: <2% (measured from Cloud Run 5xx logs over 48h)
  - **Latency**: p95 processing time <5 min (for typical 100 MB video)
  - **Pub/Sub delivery**: 100% message delivery (no orphaned jobs)
  - **Firestore consistency**: Every processed video has a matching document (query count of docs vs. count of files in bucket)
- **Dashboards**: Use Cloud Monitoring to create a dashboard showing these metrics. Share with investors quarterly.
- **Gating**: Don't move to Sprint 2 (transcription) until all metrics are met for 1 week. This prevents adding complexity to a shaky foundation.
- **Tradeoff**: Delays feature work by ~1 week; prevents 10x more delay later due to production fires.

---

## Technical Architecture Notes

**Current Flow:**

```
User (Next.js)
  → Firebase Auth ✅
  → API Service (Firebase Functions)
    → Generate signed URL ✅
  → GCS bucket (raw-videos) ✅
  → Cloud Storage notification → Pub/Sub topic ✅
  → Pub/Sub subscription (push) → Cloud Run service
    → Download raw video
    → Process (ffmpeg downscale)
    → Upload to GCS (processed-videos) ✅
    → Update Firestore (video metadata) ✅
```

**Sprint 1 Stabilization:**

- Add health checks, logging, error handling ✅
- Document config, IAM, dependencies ⏳
- Implement smoke tests ⏳
- Monitor metrics ⏳

**Sprint 2+ Direction (Transcription):**

- Replace ffmpeg processing with Speech-to-Text v2 API calls
- Handle longer processing times (5-30 min videos)
- Consider Cloud Tasks for reliable async job scheduling vs. Pub/Sub push
- Add transcription storage to Firestore + Cloud Storage

---

## Questions to Self

1. **What happens if a video is 2 GB and Cloud Run times out?**  
   → Current: Pub/Sub retries, may create duplicates. Solution: Implement chunked upload or Cloud Tasks.

2. **How do we monitor Pub/Sub delivery failures?**  
   → Current: We don't. Add Cloud Monitoring alert for Pub/Sub `dead_letter_count` or subscription backlog.

3. **Should we add user-facing progress updates while processing?**  
   → Current: No. Future: Use Firestore real-time listeners on client to show "Processing... 45% complete".

4. **What's the cost of running this pipeline?**  
   → Cloud Run: ~$0.15/hour if always on; ~$0.000001 per request if auto-scaled. GCS storage: $0.02/GB/month. Estimate: $10/month for 100 test videos.
