# Sprint 2 – Batch Transcription v2

## Sprint Goal
Enable automated Speech-to-Text v2 processing for uploaded media so transcripts and timing metadata persist alongside the job record.

## Deliverables
- Speech-to-Text v2 batch worker that consumes Pub/Sub events and writes transcript JSON + segment timings to `transcripts/` bucket and Firestore (Acceptance: processing a 2 min sample produces aligned segments accessible via Firestore query).
- Retryable job orchestration with status updates (`pending`, `running`, `failed`, `done`) surfaced in Firestore (Acceptance: manual status flip triggers UI update within 5s via listener or polling stub).
- Updated API endpoint to fetch transcript payload for a mediaId (Acceptance: authenticated request returns normalized transcript schema, 403 for unauthorized user).

## Technical Tasks
- Extend `video-processing-service` to call Speech-to-Text v2 async API with configurable model + language.
- Implement GCS URI + output bucket wiring, including CMEK placeholder support.
- Add Firestore `Transcripts` collection + indexes for `userId+mediaId` lookups.
- Update Pub/Sub handler to ack/nack with exponential backoff and dead-letter topic binding.
- Write integration test using small audio fixture run locally against mock or stubbed Speech-to-Text.
- SPIKE – Measure cost/latency differences between `long` vs `short` Speech-to-Text v2 models for target languages.

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

## Observed Speech v2 GCS result shape

**Status: observed in production (2026-08-24)** — no longer assumed from documentation alone.

First real `batchRecognize` output file written by Google to the transcripts bucket:

`gs://atmuri-yt-transcripts/raw/zUBGbRycgiOhdHgFZtbDycYw1SH3-1787577056297/primary/zUBGbRycgiOhdHgFZtbDycYw1SH3-1787577056297_transcript_6f46350e-0000-2a5c-b47f-c82add6ec714.json`

Exact payload (220 bytes, single-line JSON):

```json
{"results":[{"alternatives":[{"transcript":"hmm","confidence":0.16799638,"words":[{"startOffset":"0.700s","endOffset":"2.200s","word":"hmm","confidence":0.16799638}]}],"resultEndOffset":"3.610s","languageCode":"en-us"}]}
```

Properties confirmed on real output:

| Property | Observed value | Parser behavior |
| --- | --- | --- |
| Top-level `metadata` | **Absent** | Not required; prior test fixture incorrectly included `totalBilledDuration` |
| Duration encoding | Proto3 strings (`"0.700s"`) | Parsed via `durationToSeconds` |
| `languageCode` | Lowercase `"en-us"` (request was `"en-US"`) | Ignored; normalized payload uses configured language |
| Per-word `confidence` | Present on each word | Ignored; segment confidence from alternative level |
| camelCase | Throughout | Expected |

Test fixtures: observed copy at `video-processing-service/src/__tests__/fixtures/speech-v2-batch-results-observed.json`; synthetic defensive coverage at `speech-v2-batch-results-synthetic.json` (multi-segment, `{seconds,nanos}` durations).
