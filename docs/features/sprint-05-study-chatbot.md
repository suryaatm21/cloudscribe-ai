# Sprint 5 – Study Chatbot

**Status:** specified only. Not implemented.

## Contract

Chat retrieves lecture-content chunks (Sprint 4) and answers with citations. A citation must be able to point at **both** a video timestamp **and** an extracted frame when one exists. Transcript-only chunks still cite timestamps. Do not cite a frame that was not stored.

Identity is `videoId`. Downstream stays independent of whether the lecture-content was produced by batch upload or live capture. Design: [`multimodal-lecture-content.md`](multimodal-lecture-content.md).

## Sprint Goal
Expose a grounded Q&A experience in the web client that queries the RAG store and uses Gemini to answer with citations tied to user content.

## Deliverables
- Cloud Run chat service with `POST /chat` endpoint that validates Firebase auth, retrieves context from Firestore `findNearest`, and calls Gemini for grounded responses (Acceptance: sample query returns an answer referencing at least 2 chunks; each citation includes `videoId`, timestamp range, and a frame URI when the chunk has one).
- Conversation persistence model storing prompts, responses, cited chunk IDs (with timestamp + frame refs), and latency metrics (Acceptance: Firestore `Conversations` collection records each turn with userId/workspaceId).
- Web client chat UI (minimal) gated by feature flag showing conversation history and citations (Acceptance: UI displays streaming text or final response within 10s; a citation can deep-link to the watch timestamp and, when present, show the stored frame; hide flag keeps feature off).

## Technical Tasks
- Implement retrieval call with filters (workspaceId + userId) and rank top chunks; include fallback if no context returned.
- Build Gemini request payload enforcing a citation template that can emit timestamp range **and** frame URI (omit frame when `visuals` were empty) + safety settings.
- Add rate limiting + quota enforcement per user to prevent abuse.
- Update upload/job metadata to link lecture-content / notes / retrieval artifacts for quick lookups. Do not key anything on `lectureId`.
- Instrument tracing/logging for questionId across chat + retrieval calls.
- Frame URLs used in citations must not assume public GCS ACLs. Processed videos are already `makePublic()`; frames must not repeat that. There are **no Firestore security rules** in the repo today — citations that render frames raise the cost of that gap. See the privacy finding in [`multimodal-lecture-content.md`](multimodal-lecture-content.md).
- SPIKE – Evaluate WebSocket vs long-polling for response streaming; document choice (MVP may use simple polling).

## Dependencies
- RAG indexing pipeline producing searchable Firestore chunks from lecture-content.
- Notes + lecture-content metadata accessible with workspace scoping. Transcript-only lecture-content is a valid corpus.

## Success Metrics
- Chatbot answers 5 curated questions with correct citations referencing user material (timestamps always; frames when the chunk has them).
- Median response latency <10s including retrieval + generation.
- No unauthorized access between workspaces observed in audit logs.

## Deferred Complexity
- Multi-turn grounding memory beyond last 5 turns.
- Advanced safety filters/moderation; MVP relies on Vertex AI defaults.
