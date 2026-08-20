# Sprint 3 – AI Notes Service

**Status:** specified only. Not implemented. Transcription, which notes will eventually consume, is deployed and gated off; no Speech call has been made.

## Contract

Notes consume the **lecture-content model**, not the raw transcript document. Identity is `videoId`. Design: [`multimodal-lecture-content.md`](multimodal-lecture-content.md).

**Transcript-only is the first milestone and one of two permanent fallbacks.** The first notes implementation reads lecture-content segments that have `text` and empty `visuals` (or a transcript mapped into that shape). When visual analysis fails or has not been built yet, notes still run. Visual failure must not strand a lecture that has speech.

The mirror fallback is **visual-only**: transcription `no_audio_detected` plus usable visuals. Notes then generate from OCR text and visual descriptions alone. That path is not the first ship — it waits for keyframes/OCR/assembly — but the notes service must not treat empty `text` as a job failure once that payload exists. Quality from visuals alone is unproven and will vary (a slide deck should work well; a silent whiteboard derivation much less so).

The genuinely empty lecture (no speech **and** no usable visuals) is the only true dead end. Do not generate notes for it, and do not surface it as a notes or pipeline error.

Do not wait for keyframes, OCR, or timeline assembly before shipping that first notes path. Building notes against transcript-only lecture-content is how we learn whether audio-only notes are already adequate for some lectures, and what is missing when they are not. Visual enrichment — and visual-only notes — come later (implementation order in the design doc: schema → notes-from-transcript → keyframes → OCR → assembly with both fallbacks → retrieval).

Trigger: `lecture-content-ready` once that event exists. Until then, a transcript `done` status is the stand-in that creates a transcript-only lecture-content document (or an equivalent notes job). `no_audio_detected` is **not** a stand-in for notes; without assembled visuals there is nothing to note. Do not add a second notes pipeline keyed on `source`.

## Sprint Goal

Produce structured study notes and outlines from lecture-content via a dedicated notes service using Vertex AI Gemini models. First ship: transcript-only content. Later: the same service on visually enriched segments, including visual-only payloads (empty `text`).

## Deliverables

- Cloud Run notes service with REST endpoint `POST /notes/:jobId` that fetches **lecture-content** (transcript-only is valid; visual-only is valid once that payload exists), calls a Gemini prompt, and writes a `Notes` Firestore doc + rendered markdown blob in a `notes/` bucket (Acceptance: running service on sample lecture-content yields a notes doc referencing `videoId`; a visual-less payload still succeeds; a text-less visual payload does not fail the job).
- Prompt template repository (versioned JSON/YAML) with at least one prompt evaluated in Vertex AI Studio and exported (Acceptance: prompt version ID recorded in Firestore per note). Prompts may later accept OCR text and visual descriptions; the first template must work with `text` alone. A later template must work with OCR + descriptions and empty `text`.
- Feature flag in API/web client to toggle notes generation per workspace (Acceptance: disabling flag skips notes job creation yet leaves transcription and lecture-content assembly unaffected).

## Technical Tasks

- Scaffold Cloud Run Node service with Vertex AI SDK + Secret Manager integration for API keys.
- Fetch lecture-content + schema validation before calling Gemini; handle missing `visuals`, empty OCR, empty `text` (visual-only), and degraded transcript-only payloads without failing the job. Skip the model call on a genuinely empty lecture.
- Build prompt template loader that reads from a versioned folder and injects metadata (course, duration, goals).
- Write Firestore + GCS persistence layer for notes + attachments (e.g. outline, key takeaways). Persist `notesStatus` on the per-stage claim model (same `pending` / `running` / `done` / `failed` / `needs_review` pattern as transcription).
- Subscribe to `lecture-content-ready` (and, for the first milestone, transcript `done` if that event is not built yet). Do not subscribe to transcript `no_audio_detected` as a notes trigger.
- SPIKE – Evaluate prompt output cost vs quality across Gemini models; document recommended default. Visual tokens in the prompt are a later cost; do not assume they are free.

## Dependencies

- Lecture-content schema (step 1 of the multimodal design). For the first milestone, a transcript-only projection is enough.
- Batch transcription pipeline emitting normalized transcripts. That pipeline is **gated off** today; notes cannot be validated against a real Speech v2 file until transcription has actually run.
- Vertex AI project + model access configured with a service account.

## Success Metrics

- 90% of lecture-content documents with a usable modality (transcription `done`, or `no_audio_detected` plus usable visuals) auto-generate notes within 2 minutes of `lecture-content-ready` (or the transcript-only stand-in for the first milestone).
- Manual review of 3 sample outputs meets a formatting checklist (headings, bullets, action items). At least one sample should be transcript-only so that fallback is exercised. Once visuals exist, add a visual-only sample; do not treat its quality as a ship gate for the first (transcript-only) milestone.
- Feature flag allows enabling/disabling notes without redeploy.
- A simulated visual-analysis failure still produces notes (degraded, transcript-only).
- A simulated empty lecture (no speech, no usable visuals) does not call Gemini and does not surface as a notes error.

## Deferred Complexity

- Multi-variant prompt evaluation + scoring; stick to a single prompt path.
- Rich media outputs (slides, flashcards) deferred until the core outline is stable.
- Waiting for OCR/keyframes before the first notes ship — that is explicitly **not** the plan.
