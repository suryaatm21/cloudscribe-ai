# Sprint 1 – Pipeline Stabilization

## Sprint Goal
Restore confidence in the current upload ➜ Pub/Sub ➜ video-processing path so a sample media file flows through without manual fixes.

## Deliverables
- Health-checked Cloud Run deploy of `video-processing-service` with logging + error alerts (Acceptance: deploy succeeds from `deploy.sh`, health endpoint returns 200, alert fires on 5xx >2% for 15m).
- Documented end-to-end smoke script for upload ➜ transcription trigger (Acceptance: README section with steps that produce a Pub/Sub message and verified log ID).
- Updated `.env.example` / secrets matrix for every service (Acceptance: configuration doc lists required vars, default placeholders, and owners).

## Technical Tasks
- Audit existing Cloud Run service, Pub/Sub topics, and Firestore schemas; capture mismatches in docs.
- Patch `deploy.sh` + GitHub workflow to pin artifact tags to git SHA and run `npm test` pre-deploy.
- Implement minimal health endpoint + structured logging (jobId) in `video-processing-service`.
- Create smoke-test script (bash or npm) that uploads sample file via signed URL helper.
- Update `.env.example` files across services with Speech-to-Text + bucket vars; sync docs/project-limitations.md.
- SPIKE – Validate Pub/Sub IAM bindings for service account vs current topics; note gaps.

## Dependencies
- Dev GCP project + service accounts provisioned.
- Access to existing buckets and Pub/Sub topics.

## Success Metrics
- Smoke test completes end-to-end twice without intervention.
- Error rate on Cloud Run stays below 2% for 48h after redeploy.
- All services can boot locally using only documented env vars.

## Deferred Complexity
- Multi-region deploys and blue/green rollouts (keep single region for MVP).
- Deep observability (Cloud Trace instrumentation) postponed until transcription sprint.
