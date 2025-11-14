# Sprint 6 – Live Transcription

## Sprint Goal
Deliver a streaming transcription path from browser mic ➜ WebSocket service ➜ Speech-to-Text v2 streaming API with interim captions and final artifacts feeding notes/RAG.

## Deliverables
- Live transcription service on Cloud Run (WebSocket or gRPC) bridging client audio chunks to Speech-to-Text v2 streaming API, emitting partial + final results (Acceptance: demo session shows interim captions updating within 2s, final transcript stored in Firestore + GCS).
- Web client live lecture UI with start/stop controls, connection state, and caption display (Acceptance: UI reconnects on transient failure and stores session metadata tied to user/workspace).
- Post-session hook that commits final transcript to standard pipeline, triggering notes + indexing flows (Acceptance: completion of live session automatically enqueues notes + RAG jobs within 1 minute).

## Technical Tasks
- Implement audio chunk encoding + buffering (e.g., Opus) client-side and server-side decoding for Speech-to-Text streaming.
- Add diarization + speaker labeling toggles (default off) with fallback for unsupported languages.
- Build state machine for live session lifecycle (connecting, streaming, closing, failed) with metrics.
- Ensure auth + quota by issuing scoped tokens before opening socket.
- Integrate partial transcript cache (Redis or in-memory) with periodic flush to Firestore for resilience.
- SPIKE – Validate bandwidth + latency requirements per browser (Chrome, Edge) and document recommended settings.

## Dependencies
- Chatbot + RAG pipelines operational (live transcripts feed same storage/indexing paths).
- Speech-to-Text v2 streaming quotas enabled and service accounts whitelisted.

## Success Metrics
- Live session of 5 minutes maintains <300ms average server latency and <1% packet loss (observed via logs/metrics).
- Interim captions visible to user within 2 seconds of speech for 95% of utterances.
- Final transcript available for notes generation automatically without manual intervention.

## Deferred Complexity
- Multi-speaker diarization with accuracy guarantees; MVP provides optional diarization without UI surfacing.
- Real-time collaborative editing of notes; limit to read-only captions during sprint.
