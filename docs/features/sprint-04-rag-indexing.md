# Sprint 4 – RAG Indexing Pipeline

## Sprint Goal
Stand up a nightly + on-demand pipeline that normalizes transcripts/documents and loads them into a managed Vertex AI retrieval store for later chat grounding.

## Deliverables
- Text chunker + metadata enricher that outputs Vertex AI RAG-compliant JSONL to `retrieval-artifacts/` bucket (Acceptance: running against two transcripts produces chunks with source URIs + timestamps).
- Cloud Run indexer service or Cloud Build job that ingests JSONL into Vertex AI RAG Engine (Acceptance: ingestion job reports success and records datastore ID + batchId in Firestore `RetrievalArtifacts`).
- Scheduler (Cloud Scheduler/Workflow) triggering nightly reindex and on-demand API endpoint to backfill specific mediaId (Acceptance: request logs show schedule + manual trigger updating `lastIndexedAt`).

## Technical Tasks
- Define chunking strategy (token-based) with configurable size/overlap; implement library reused by batch + live later.
- Build metadata schema (userId, workspaceId, mediaId, transcriptSegmentRange, noteVersionId) and validation.
- Wire ingestion job to Vertex AI RAG Engine/Search APIs with retries + exponential backoff.
- Update Firestore documents to track indexing state per mediaId.
- Add observability: structured logs + metric for chunks/sec and ingestion success.
- SPIKE – Compare Vertex AI RAG Engine vs Vertex AI Search for latency/cost; document recommendation.

## Dependencies
- Notes artifacts stored + transcript metadata normalized.
- Vertex AI project has RAG Engine/Search datastore provisioned.

## Success Metrics
- Two sample transcripts searchable via Vertex console within 15 minutes of ingestion.
- Indexing failures alert via Cloud Monitoring within 5 minutes.
- 100% of eligible transcripts show `indexed=true` after nightly job.

## Deferred Complexity
- Multi-tenant workspace isolation beyond metadata filters (MVP uses filtering by workspaceId only).
- Semantic enrichment (entity extraction, embeddings outside Vertex AI pipeline) postponed.
