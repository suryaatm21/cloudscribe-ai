# Sprint 6 – Live Transcription

Live transcription (browser microphone → live captions → live notes) is a **committed product capability**, not a stretch goal. It is difficult; that is accepted. Design decisions now must leave room for it instead of rediscovering the constraints in a later sprint.

This document records the direction. It does **not** implement live behavior. Sprint 2 remains batch-only.

## Transport

Google Speech-to-Text v2 live recognition is `streamingRecognize`: a **bidirectional gRPC stream**. Browsers cannot speak gRPC.

The service is a relay:

```
microphone → WebSocket → CloudScribe service → gRPC streamingRecognize → Google
                 ← interim + final results ←
```

Interim captions and finals travel back on the same WebSocket. Auth tokens are issued before the socket opens; the relay never exposes a Google credential to the browser.

## Tension with the current runtime

Every other component here is **stateless and scales to zero**. Live is **long-lived and stateful**.

Cloud Run supports WebSockets, but:

- A connection **pins a request for the whole session**. An hour-long lecture is an hour-long billed request.
- Concurrency caps how many simultaneous live sessions one revision can hold.
- **Any deploy terminates live sessions mid-sentence.**

**Prototype the runtime before committing to it.** Alternatives worth evaluating: a dedicated always-on service, GKE, or a managed WebSocket layer. Do not assume Cloud Run is the live home because it is the batch home.

## Live notes is harder than live transcription

Transcription **appends**. Summarization does not.

Two approaches, both imperfect:

| Approach | Behavior | Cost / UX |
| --- | --- | --- |
| Re-summarize a growing window | Notes visibly rewrite themselves as the lecture continues | A model call per window |
| Append-only per-chunk bullets | Notes are stable on screen | Cheap; lower quality than one pass over the finished transcript |

Pick at implementation time with a prototype. Do not pretend live notes is “the same Gemini call on a stream.”

## Invariant to protect

**The transcript document is the contract.** Nothing downstream of the transcript (notes, indexing, chat) may depend on how the transcript was produced.

Live becomes **another producer**, not a parallel pipeline. A live session writes the same Firestore transcript shape (and, when a final artifact exists, the same normalized GCS object) that batch writes today.

The `source` field (`batch` | `live`) on the transcript document is the first step: batch-only fields (`audioGcsUri`, `operationName`) are optional so a live session can omit them. Do not add a second notes path, a second indexer, or a second chat corpus keyed on transport.

## Cost

Streaming is billed at the **standard** Speech rate with **no batch discount**: roughly **$0.96 per hour** of audio versus **$0.18** batched (`DYNAMIC_BATCHING`), about **5×**. Live is a premium path. Do not use it as the default for uploaded lecture files.

## Sprint Goal

Deliver a streaming transcription path from browser mic ➜ WebSocket relay ➜ Speech-to-Text v2 `streamingRecognize` with interim captions and a final transcript document that feeds the existing notes/RAG path.

## Deliverables

- Live transcription relay (WebSocket ➜ gRPC) emitting partial + final results (Acceptance: demo session shows interim captions updating within 2s; final transcript stored in Firestore + GCS in the same schema as batch).
- Web client live lecture UI with start/stop, connection state, and captions (Acceptance: UI reconnects on transient failure and stores session metadata tied to the user).
- Post-session commit of the final transcript into the standard pipeline, triggering notes + indexing (Acceptance: completion enqueues notes + RAG jobs within 1 minute using the existing transcript contract).

## Technical Tasks

- Implement audio chunk encoding + buffering (e.g. Opus) client-side and server-side decoding for Speech-to-Text streaming.
- Prototype runtime (Cloud Run vs always-on vs GKE vs managed WebSocket) under a one-hour session, a deploy mid-session, and two concurrent sessions. Record the result before locking the host.
- Add diarization + speaker labeling toggles (default off) with fallback for unsupported languages.
- Build state machine for live session lifecycle (connecting, streaming, closing, failed) with metrics.
- Ensure auth + quota by issuing scoped tokens before opening the socket.
- Integrate partial transcript cache with periodic flush to Firestore for resilience.
- Prototype live-notes strategy (windowed re-summarize vs append-only bullets) and document the choice.
- SPIKE – Validate bandwidth + latency per browser (Chrome, Edge) and document recommended settings.

## Dependencies

- Chatbot + RAG pipelines operational (live transcripts feed the **same** storage/indexing paths).
- Speech-to-Text v2 streaming quotas enabled and service accounts granted.
- Transcript document `source` discriminator already on batch writes (done in the Sprint 2 enabled-path work).

## Success Metrics

- Live session of 5 minutes maintains <300ms average server latency and <1% packet loss (observed via logs/metrics).
- Interim captions visible to the user within 2 seconds of speech for 95% of utterances.
- Final transcript available for notes generation automatically without manual intervention, indistinguishable downstream from a batch transcript.

## Deferred Complexity

- Multi-speaker diarization with accuracy guarantees; MVP provides optional diarization without UI surfacing.
- Real-time collaborative editing of notes; limit to read-only captions during the sprint.
- Choosing the production live runtime before the prototype exists.
