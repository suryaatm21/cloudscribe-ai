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
| Per-word `confidence` | Present on each word | Preserved on each normalized `words[]` entry; segment confidence remains from alternative level |
| `words[]` on segments | Present in raw Speech output | Preserved in normalized payload (required for citation UX; raw objects expire after 7 days) |
| camelCase | Throughout | Expected |

Test fixtures: observed short clip at `video-processing-service/src/__tests__/fixtures/speech-v2-batch-results-observed.json`; observed Gettysburg clip at `speech-v2-batch-results-observed-gettysburg.json` (22 segments, 328 words); synthetic defensive coverage at `speech-v2-batch-results-synthetic.json` (multi-segment, `{seconds,nanos}` durations).

### Normalized payload word timings

Each segment retains existing fields (`text`, `startTime`, `endTime`, `confidence`) and adds optional `words[]`:

```json
{
  "text": "Four score and seven years ago…",
  "startTime": 36,
  "endTime": 48.5,
  "confidence": 0.9484636,
  "words": [
    { "word": "Four", "startTime": 36, "endTime": 36.5, "confidence": 0.65948474 },
    { "word": "score", "startTime": 36.5, "endTime": 36.7, "confidence": 0.6206035 }
  ]
}
```

**Zero-length offsets:** Speech sometimes emits identical start/end on a word (observed 6/328 on the Gettysburg clip, e.g. `"is"` at 2.5s). These are preserved as-is; consumers should treat them as instantaneous markers, not malformed data.

**Backfill constraint:** Raw Speech JSON under `raw/` is deleted after 7 days (lifecycle rule). Per-word data can only be backfilled from raw objects still within that window; after expiry the word timings are unrecoverable. Only two real transcripts existed at time of writing, so practical backfill need is near zero.

**Payload size:** With word timings, the Gettysburg normalized payload is ~50 KiB (22 segments, 328 words). A 90-minute lecture (~12k words) scales to roughly **1.8 MiB** JSON. That remains reasonable for a single GCS object and a one-shot browser fetch, but is large enough that citation UI should not re-fetch on every seek; cache the payload client-side.
