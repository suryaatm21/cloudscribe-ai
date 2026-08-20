# Sprint 4 – RAG Indexing Pipeline

## Locked decision

**Do not provision Vertex AI RAG Engine, Vector Search, or Cloud SQL.** Standing cost on those products ($68–$900/month idle) was ruled out.

The index is **Firestore `findNearest`** (exact KNN, `flat` index, no hourly node) with **`text-embedding-005` at 768 dimensions**.

`gemini-embedding-001` defaults to **3072 dimensions**, which **exceeds Firestore's 2048-dimension limit**. If that model is ever used, request `output_dimensionality` 768 or 1536 and L2-normalize truncated vectors. Prefer `text-embedding-005` (native 768, cheaper) unless quality measurements say otherwise.

Cost envelope and alternatives: [`docs/cost-and-credits.md`](../cost-and-credits.md) §5.

## Sprint Goal

Stand up a nightly + on-demand pipeline that chunks transcripts/notes, embeds them with `text-embedding-005` (768-d), and writes vectors onto Firestore chunk documents so chat can retrieve with `findNearest`.

## Deliverables

- Text chunker + metadata enricher that writes chunk documents (`uid`, `videoId`, `text`, `embedding`) (Acceptance: running against two transcripts produces chunks with source URIs + timestamps).
- Worker or Cloud Function that embeds chunks and writes them to Firestore, then ensures the composite vector index exists (Acceptance: `findNearest` against a test query returns the expected chunks).
- Scheduler (Cloud Scheduler/Workflow) triggering nightly reindex and an on-demand API to backfill a specific `videoId` (Acceptance: request logs show schedule + manual trigger updating `lastIndexedAt`).

## Technical Tasks

- Define chunking strategy (token-based) with configurable size/overlap; implement a library reused by batch + live later.
- Build metadata schema (`userId`, `videoId`, `transcriptSegmentRange`, `noteVersionId`) and validation.
- Call Vertex embedding (`text-embedding-005`, 768-d) with retries; store `embedding` as a Firestore vector field.
- Create one composite index: `uid` equality + vector config `{"dimension":"768","flat":"{}"}`.
- Update Firestore documents to track indexing state per `videoId`.
- Add observability: structured logs + metric for chunks/sec and write success.
- Do **not** add Vector Search, RAG Engine, or Cloud SQL to any setup script.

## Dependencies

- Notes artifacts stored + transcript metadata normalized.
- Firestore default database already in the project (no new GCP product).

## Success Metrics

- Two sample transcripts retrievable via `findNearest` within 15 minutes of ingestion.
- Indexing failures alert via Cloud Monitoring within 5 minutes.
- 100% of eligible transcripts show `indexed=true` after nightly job.

## Deferred Complexity

- Multi-tenant workspace isolation beyond metadata filters (MVP filters by `uid`).
- Switching to `gemini-embedding-001` (must truncate to ≤2048-d; default 3072 will not index).
- ANN at millions of chunks (the day Firestore linear scan is too slow, revisit Vector Search).
