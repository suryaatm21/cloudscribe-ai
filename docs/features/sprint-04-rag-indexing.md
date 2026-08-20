# Sprint 4 – RAG Indexing Pipeline

**Status:** specified only. Not implemented. The Firestore `findNearest` + `text-embedding-005` @ 768-d decision below is locked.

## Locked decision

**Do not provision Vertex AI RAG Engine, Vector Search, or Cloud SQL.** Standing cost on those products ($68–$900/month idle) was ruled out.

The index is **Firestore `findNearest`** (exact KNN, `flat` index, no hourly node) with **`text-embedding-005` at 768 dimensions**.

`gemini-embedding-001` defaults to **3072 dimensions**, which **exceeds Firestore's 2048-dimension limit**. If that model is ever used, request `output_dimensionality` 768 or 1536 and L2-normalize truncated vectors. Prefer `text-embedding-005` (native 768, cheaper) unless quality measurements say otherwise.

Cost envelope and alternatives: [`docs/cost-and-credits.md`](../cost-and-credits.md) §5.

## Sprint Goal

Stand up a nightly + on-demand pipeline that chunks **lecture-content** (transcript text, OCR, visual descriptions, timestamps, and frame references), embeds the text fields with `text-embedding-005` (768-d), and writes vectors onto Firestore chunk documents so chat can retrieve with `findNearest`.

Native image embeddings are **deferred** until visual similarity search is justified. Until then, OCR text and multimodal descriptions are embedded as text alongside spoken `text`.

Lecture-content contract: [`multimodal-lecture-content.md`](multimodal-lecture-content.md). Notes (Sprint 3) are a consumer of the same model; indexing must tolerate transcript-only lecture-content (empty `visuals`) because that is both the first milestone and the visual-failure fallback.

## Deliverables

- Text chunker + metadata enricher that writes chunk documents (`uid`, `videoId`, `text`, `embedding`, plus `startTime`, `endTime`, optional `ocrText`, `visualDescription`, `frameUris`) (Acceptance: running against two lecture-content documents produces chunks with source URIs, timestamps, and frame references when visuals exist; transcript-only documents still index).
- Worker or Cloud Function that embeds chunks and writes them to Firestore, then ensures the composite vector index exists (Acceptance: `findNearest` against a test query returns the expected chunks). Persist `indexingStatus` with the same claim pattern as transcription (`needs_review` when an embed write may have occurred).
- Scheduler (Cloud Scheduler/Workflow) triggering nightly reindex and an on-demand API to backfill a specific `videoId` (Acceptance: request logs show schedule + manual trigger updating `lastIndexedAt`).

## Technical Tasks

- Define chunking strategy (token-based) with configurable size/overlap; implement a library reused by batch + live later. A chunk’s retrieval text is the concatenation of spoken `text`, `ocrText`, and visual `description` for that time range; metadata keeps them distinguishable for citations.
- Build metadata schema (`userId`, `videoId`, `startTime`, `endTime`, `frameUris`, `noteVersionId`) and validation. Do not introduce `lectureId`.
- Call Vertex embedding (`text-embedding-005`, 768-d) with retries; store `embedding` as a Firestore vector field. Do **not** add an image-embedding field in this sprint.
- Create one composite index: `uid` equality + vector config `{"dimension":"768","flat":"{}"}`.
- Update Firestore documents to track `indexingStatus` per `videoId`.
- Add observability: structured logs + metric for chunks/sec and write success.
- Do **not** add Vector Search, RAG Engine, or Cloud SQL to any setup script.

## Dependencies

- Lecture-content artifacts (transcript-only is eligible; visuals optional). Notes metadata when present.
- Firestore default database already in the project (no new GCP product).

## Success Metrics

- Two sample lecture-content documents retrievable via `findNearest` within 15 minutes of ingestion, including one transcript-only document.
- Indexing failures alert via Cloud Monitoring within 5 minutes.
- 100% of eligible `videoId`s show `indexingStatus=done` after the nightly job.

## Deferred Complexity

- Multi-tenant workspace isolation beyond metadata filters (MVP filters by `uid`).
- Switching to `gemini-embedding-001` (must truncate to ≤2048-d; default 3072 will not index).
- ANN at millions of chunks (the day Firestore linear scan is too slow, revisit Vector Search).
- Native image embeddings / visual similarity search. Text embeddings of OCR + descriptions are the visual signal until that is justified.
