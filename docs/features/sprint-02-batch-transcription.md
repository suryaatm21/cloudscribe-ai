# Sprint 2 – Batch Transcription v2

## Sprint Goal
Enable automated Speech-to-Text v2 processing for uploaded media so transcripts and timing metadata persist alongside the job record.

## Deliverables
- Speech-to-Text v2 batch worker that consumes Pub/Sub events and writes transcript JSON + segment timings to `transcripts/` bucket and Firestore (Acceptance: processing a 2 min sample produces aligned segments accessible via Firestore query).
- Retryable job orchestration with status updates (`pending`, `running`, `failed`, `done`) surfaced in Firestore (Acceptance: manual status flip triggers UI update within 5s via listener or polling stub).
- Updated API endpoint to fetch transcript payload for a mediaId (Acceptance: authenticated request returns normalized transcript schema, 403 for unauthorized user).

## Architecture Overview
```
GCS (raw)
  ➜ Pub/Sub storage trigger
    ➜ Cloud Run video-processing-service
      ➜ ffmpeg convert (original bitrate)
      ➜ extractAudio() ➜ gs://atmuri-yt-audio-work
      ➜ create transcript doc (videos/{videoId}/transcripts/{primary})
      ➜ publish transcription-jobs message
    ➜ /transcribe-audio endpoint
      ➜ Speech-to-Text longRunningRecognize
      ➜ poll operation → upload transcript JSON to gs://atmuri-yt-transcripts/{videoId}/transcript.json
      ➜ update Firestore status + metadata
  ➜ Firebase Function getTranscriptUrl()
    ➜ signed transcript URL (auth + ownership enforced)
  ➜ Next.js watch page
      ➜ Firestore listeners for videos + transcripts
      ➜ Calls getTranscriptUrl when transcript.status == done
      ➜ Renders timestamped segments beneath video player
```

## User Stories
- As a student, I can watch my uploaded video in its original resolution and read the aligned transcript below the player (`/watch?id={videoId}`).
- As a support engineer, I can trace each transcription job via structured logs containing `jobId`, `transcriptId`, and Speech-to-Text operation ids.
- As an SRE, I can re-run the smoke test and have it validate both processed video artifacts and emitted transcript JSON.
- As an API consumer, I can request an authenticated transcript URL (15-minute signed URL) and receive 403 if I do not own the video.

## Technical Tasks
- Extend `video-processing-service` to call Speech-to-Text v2 async API with configurable model + language.
- Implement GCS URI + output bucket wiring, including CMEK placeholder support.
- Add Firestore `Transcripts` collection + indexes for `userId+mediaId` lookups.
- Update Pub/Sub handler to ack/nack with exponential backoff and dead-letter topic binding.
- Write integration test using small audio fixture run locally against mock or stubbed Speech-to-Text.
- SPIKE – Measure cost/latency differences between `long` vs `short` Speech-to-Text v2 models for target languages.

## Technical Decisions & Tradeoffs
- **Asynchronous transcription via Pub/Sub**: Cloud Run notifies a dedicated `/transcribe-audio` endpoint which can retry failures and push messages to a dead-letter topic. This keeps the original `/process-video` ack path fast while tolerating 5–30 minute jobs.
- **Hybrid storage**: Firestore keeps transcript metadata (status, GCS path, word counts) while the heavy JSON lives in `gs://atmuri-yt-transcripts`. This avoids Firestore document limits yet preserves indexed queries via `firestore.indexes.json`.
- **Signed transcript delivery**: The Firebase callable `getTranscriptUrl` enforces auth + ownership before minting a 15-minute URL. The web client never touches buckets directly, reducing surface area.
- **Feature flag**: `ENABLE_TRANSCRIPTION` gates the new pipeline so we can hot-disable the feature without redeploying.
- **ffmpeg adaptive stance**: Sprint 2 keeps the original bitrate (no forced 360p). Multi-bitrate packaging is deferred until a future sprint once transcripts are stable.

## Dependencies
- Sprint 1 smoke path + env documentation completed.
- Service accounts have Speech-to-Text v2 permissions and bucket access.

## Success Metrics
- Upload ➜ transcript flow completes within 10 minutes for <5 min files.
- Transcript accuracy validated on sample to >90% WER target (qualitative check).
- Firestore job status reflects ground truth within 30s of Speech-to-Text completion.

## Deferred Complexity
- Multi-language auto-detection; MVP requires user to select language.
- Speaker diarization; focus on single speaker transcripts first.

## Monitoring & Ops
- Structured logging includes `operationName`, `transcriptId`, and segment counts at completion.
- `scripts/setup-transcription-infra.sh` provisions Speech-to-Text API, transcription buckets, Pub/Sub topics, and IAM bindings. Run it per environment to stay consistent.
- Smoke test (`scripts/smoke-test.sh`) now validates processed videos **and** transcripts (Firestore status + GCS artifact).
- Metrics (coverage, latency, cost estimates) should be stored locally under the gitignored `metrics/` directory for retrospectives.
