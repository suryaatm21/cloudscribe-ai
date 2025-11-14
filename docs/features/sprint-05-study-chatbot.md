# Sprint 5 – Study Chatbot

## Sprint Goal
Expose a grounded Q&A experience in the web client that queries the RAG store and uses Gemini to answer with citations tied to user content.

## Deliverables
- Cloud Run chat service with `POST /chat` endpoint that validates Firebase auth, retrieves context from RAG, and calls Gemini for grounded responses (Acceptance: sample query returns answer referencing at least 2 chunks with citations).
- Conversation persistence model storing prompts, responses, cited chunk IDs, and latency metrics (Acceptance: Firestore `Conversations` collection records each turn with userId/workspaceId).
- Web client chat UI (minimal) gated by feature flag showing conversation history and citations (Acceptance: UI displays streaming text or final response within 10s, hide flag keeps feature off).

## Technical Tasks
- Implement retrieval call with filters (workspaceId + userId) and rank top chunks; include fallback if no context returned.
- Build Gemini request payload enforcing citation template + safety settings.
- Add rate limiting + quota enforcement per user to prevent abuse.
- Update upload/job metadata to link transcripts/notes/retrieval artifacts for quick lookups.
- Instrument tracing/logging for questionId across chat + RAG calls.
- SPIKE – Evaluate WebSocket vs long-polling for response streaming; document choice (MVP may use simple polling).

## Dependencies
- RAG indexing pipeline producing searchable datastore.
- Notes + transcript metadata accessible with workspace scoping.

## Success Metrics
- Chatbot answers 5 curated questions with correct citations referencing user material.
- Median response latency <10s including retrieval + generation.
- No unauthorized access between workspaces observed in audit logs.

## Deferred Complexity
- Multi-turn grounding memory beyond last 5 turns.
- Advanced safety filters/moderation; MVP relies on Vertex AI defaults.
