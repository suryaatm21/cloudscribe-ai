# Sprint 6 – Live Transcription

Live capture is a **committed product direction**, not a stretch goal. It is **explicitly deferred**. Design and build visual handling on the batch path first; revisit live sessions afterward. This document records the direction. It does **not** implement live behavior. Sprint 2 remains batch-only and gated off (no Speech call has been made).

Parent contract: the **lecture-content model**, not the transcript document alone. [`multimodal-lecture-content.md`](multimodal-lecture-content.md). Implementation order step 7.

## Visual source (decided): screen capture, not a phone

The visual source for live sessions is **screen capture of a lecture on the student’s own screen** (`getDisplayMedia`). It is **not** a phone camera pointed at a projector.

A phone aimed at a projector fails on visual noise — keystone distortion, glare, heads in frame, autofocus hunting, motion blur. OCR degrades worst exactly where precision matters: a subscript or exponent is only a few pixels on a phone frame of a projected slide.

Screen capture gives essentially PDF-quality input, so optical noise is not its problem. Its problems are different:

- Browsers require an **explicit user gesture** and will not grant persistent capture.
- Sharing an **entire screen** rather than a single tab would ingest notifications and unrelated windows — a privacy exposure to design against. Prefer **tab capture**.
- Support is effectively **desktop-only**.

### What that scopes

Live capture only earns its complexity for a **synchronous remote lecture**: a live Zoom / Teams / Meet class that cannot be re-downloaded.

For an already-recorded video the student should **upload the file** and use the better batch path (original-resolution transcode, async Speech, scene detection, hash dedup, OCR).

**In-person lectures fall outside the visual story.** Those students get **audio-only** live capture (browser microphone), or they record and upload afterward.

### Tab-audio upside

Tab capture can take **tab audio** alongside video. That is cleaner lecture audio than a room microphone, so the live path may actually have **better transcription input** than the batch path (which transcribes whatever landed in the uploaded file).

The live WebSocket ➜ `streamingRecognize` relay still exists for audio (see Transport). Visual frames from the same `getDisplayMedia` stream are a later producer of the same lecture-content `visuals` array. How those frames are uploaded during or after the session is **not specified**; do not assume they ride the Speech gRPC stream. Visual-only assembly (a silent tab-share is a valid lecture if visuals land) does not fill that transport gap.

## Invariant to protect

**The lecture-content model is the contract.** All downstream consumers (notes, indexing, chat) depend on that model and remain independent of the audio or visual producer that created each artifact.

Live becomes **another producer**, not a parallel pipeline. A live session writes the same lecture-content shape (and the same transcript shape for the audio modality) that batch writes. The `source` field (`batch` | `live`) is the discriminator; batch-only fields (`audioGcsUri`, `operationName`) stay optional so a live session can omit them.

Identity stays `videoId`. Do not add a `lectureId`, a second notes path, a second indexer, or a second chat corpus keyed on transport.

The previous invariant (“the transcript document is the contract”) is superseded. The transcript remains the authoritative **audio** representation inside the model. A live session with no detectable speech is still a valid lecture if it has usable visual content (same visual-only rule as batch). How live frames are uploaded is still unspecified.

## Transport

Google Speech-to-Text v2 live recognition is `streamingRecognize`: a **bidirectional gRPC stream**. Browsers cannot speak gRPC.

The service is a relay:

```
tab audio or microphone → WebSocket → CloudScribe service → gRPC streamingRecognize → Google
                              ← interim + final results ←
```

Interim captions and finals travel back on the same WebSocket. Auth tokens are issued before the socket opens; the relay never exposes a Google credential to the browser.

For the scoped remote-lecture path, prefer **tab audio** from `getDisplayMedia` over the room microphone. The microphone path remains for audio-only in-person sessions. Frame upload is not part of this relay; it remains an open question in [`multimodal-lecture-content.md`](multimodal-lecture-content.md).

## Tension with the current runtime

Every other component here is **stateless and scales to zero**. Live is **long-lived and stateful**.

Cloud Run supports WebSockets, but:

- A connection **pins a request for the whole session**. An hour-long lecture is an hour-long billed request.
- Concurrency caps how many simultaneous live sessions one revision can hold.
- **Any deploy terminates live sessions mid-sentence.**

**Prototype the runtime before committing to it.** Alternatives worth evaluating: a dedicated always-on service, GKE, or a managed WebSocket layer. Do not assume Cloud Run is the live home because it is the batch home. This prototype is part of the deferred Sprint 6 work, not a reason to start Sprint 6 now.

## Live notes is harder than live transcription

Transcription **appends**. Summarization does not.

Two approaches, both imperfect:

| Approach | Behavior | Cost / UX |
| --- | --- | --- |
| Re-summarize a growing window | Notes visibly rewrite themselves as the lecture continues | A model call per window |
| Append-only per-chunk bullets | Notes are stable on screen | Cheap; lower quality than one pass over the finished lecture-content |

Pick at implementation time with a prototype. Do not pretend live notes is “the same Gemini call on a stream.” Live notes consume the same lecture-content model as batch notes: transcript-only fallback if live visual capture fails (user denied screen share, tab capture dropped), visual-only fallback if speech is absent and frames are usable, and an empty-lecture terminal if both are missing.

## Cost

Streaming is billed at the **standard** Speech rate with **no batch discount**: roughly **$0.96 per hour** of audio versus **$0.18** batched (`DYNAMIC_BATCHING`), about **5×**. Live is a premium path. Do not use it as the default for uploaded lecture files.

Visual cost on the live path is extra (frame upload, OCR, descriptions) and is the same class of estimate as batch visual (~cents to tens of cents per lecture on Flash-class descriptions). Verify against current prices when this sprint is scheduled. See the cost finding in [`multimodal-lecture-content.md`](multimodal-lecture-content.md).

## Sprint Goal

Deliver a streaming capture path from browser (tab audio + screen frames for remote lectures; microphone for in-person audio-only) ➜ WebSocket relay ➜ Speech-to-Text v2 `streamingRecognize`, with interim captions and a final lecture-content document that feeds the existing notes/retrieval path.

This sprint is **specified only** and **deferred** until steps 1–6 of the multimodal design exist (schema, notes-from-transcript, keyframes, OCR, assembly, enriched retrieval).

## Deliverables

- Live transcription relay (WebSocket ➜ gRPC) emitting partial + final results (Acceptance: demo session shows interim captions updating within 2s; final transcript stored in Firestore + GCS in the same schema as batch, `source: "live"`).
- Screen capture via `getDisplayMedia` for the remote-lecture path (Acceptance: tab share produces stored frames with timestamps; denying screen share still completes an audio-only lecture-content document; a silent tab-share with usable frames still completes visual-only lecture-content rather than failing).
- Web client live lecture UI with start/stop, connection state, captions, and an explicit screen-share gesture (Acceptance: UI reconnects on transient failure; does not request persistent capture; prefers tab share over entire screen).
- Post-session commit of the final lecture-content document into the standard pipeline, triggering notes + indexing (Acceptance: completion enqueues notes + retrieval jobs within 1 minute using the lecture-content contract, not a live-only fork).

## Technical Tasks

- Implement audio chunk encoding + buffering (e.g. Opus) client-side and server-side decoding for Speech-to-Text streaming. Prefer tab audio when the remote-lecture path is active.
- Prototype runtime (Cloud Run vs always-on vs GKE vs managed WebSocket) under a one-hour session, a deploy mid-session, and two concurrent sessions. Record the result before locking the host.
- Add diarization + speaker labeling toggles (default off) with fallback for unsupported languages.
- Build state machine for live session lifecycle (connecting, streaming, closing, failed) with metrics, using the same claim/`needs_review` pattern when a streaming RPC may already have started.
- Ensure auth + quota by issuing scoped tokens before opening the socket.
- Integrate partial transcript cache with periodic flush to Firestore for resilience.
- Prototype live-notes strategy (windowed re-summarize vs append-only bullets) and document the choice.
- SPIKE – Validate bandwidth + latency per desktop browser (Chrome, Edge) and document recommended settings. Mobile/phone-camera capture is **out of scope** for visuals.
- Do **not** build a projector-phone visual path.

## Dependencies

- Batch visual handling (keyframes, OCR, descriptions, transcript-only **and** visual-only assembly fallbacks) already in place so live is “another producer,” not the first visual pipeline.
- Chatbot + retrieval pipelines operational (live lecture-content feeds the **same** storage/indexing paths).
- Speech-to-Text v2 streaming quotas enabled and service accounts granted.
- Transcript document `source` discriminator already on batch writes (done in the Sprint 2 enabled-path work).

## Success Metrics

- Live session of 5 minutes maintains <300ms average server latency and <1% packet loss (observed via logs/metrics).
- Interim captions visible to the user within 2 seconds of speech for 95% of utterances.
- Final lecture-content available for notes generation automatically, indistinguishable downstream from a batch document except for `source: "live"`.
- A session that never received screen-share permission still produces transcript-only lecture-content rather than failing the lecture.
- A session that received screen share but no usable speech still produces visual-only lecture-content rather than failing the lecture, once frame transport exists.

## Deferred Complexity

- Starting this sprint before batch visual handling exists.
- Phone-camera / in-person visual capture.
- Multi-speaker diarization with accuracy guarantees; MVP provides optional diarization without UI surfacing.
- Real-time collaborative editing of notes; limit to read-only captions during the sprint.
- Choosing the production live runtime before the prototype exists.
- Persistent or entire-screen capture.
