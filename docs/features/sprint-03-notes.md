# Sprint 3 – AI Notes Service

## Sprint Goal
Produce structured study notes and outlines from stored transcripts via a dedicated notes service using Vertex AI Gemini models.

## Deliverables
- Cloud Run notes service with REST endpoint `POST /notes/:jobId` that fetches transcript, calls Gemini prompt, and writes `Notes` Firestore doc + rendered markdown blob in `notes/` bucket (Acceptance: running service on sample transcript yields notes doc referencing transcriptId).
- Prompt template repository (versioned JSON/YAML) with at least one prompt evaluated in Vertex AI Studio and exported (Acceptance: prompt version ID recorded in Firestore per note).
- Feature flag in API/web client to toggle notes generation per workspace (Acceptance: disabling flag skips notes job creation yet leaves transcript flow unaffected).

## Technical Tasks
- Scaffold Cloud Run Node service with Vertex AI SDK + Secret Manager integration for API keys.
- Implement transcript fetch + schema validation before calling Gemini; handle missing data gracefully.
- Build prompt template loader that reads from versioned folder and injects metadata (course, duration, goals).
- Write Firestore + GCS persistence layer for notes + attachments (e.g., outline, key takeaways).
- Add background job trigger when transcript job hits `done`, posting message to notes service queue/topic.
- SPIKE – Evaluate prompt output cost vs quality across Gemini models; document recommended default.

## Dependencies
- Batch transcription pipeline emitting transcripts + metadata.
- Vertex AI project + model access configured with service account.

## Success Metrics
- 90% of completed transcripts auto-generate notes within 2 minutes of transcript ready.
- Manual review of 3 sample outputs meets formatting checklist (headings, bullets, action items).
- Feature flag allows enabling/disabling notes without redeploy.

## Deferred Complexity
- Multi-variant prompt evaluation + scoring; stick to single prompt path.
- Rich media outputs (slides, flashcards) deferred until core outline stable.
