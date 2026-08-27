# Speech v2 batch result fixtures

## `speech-v2-batch-results-observed.json`

**Observed real output** — not hand-constructed.

Source (2026-08-24):

`gs://atmuri-yt-transcripts/raw/zUBGbRycgiOhdHgFZtbDycYw1SH3-1787577056297/primary/zUBGbRycgiOhdHgFZtbDycYw1SH3-1787577056297_transcript_6f46350e-0000-2a5c-b47f-c82add6ec714.json`

Notable properties preserved in tests:

- camelCase throughout
- durations are proto3 **string** form (`"0.700s"`), not `{seconds, nanos}` objects
- **no** `metadata` block (prior hand-built fixture incorrectly included one)
- per-word `confidence` exists (parser uses alternative-level confidence)
- `languageCode` is lowercase `"en-us"` even though we request `"en-US"` (parser uses configured language)

## `speech-v2-batch-results-observed-gettysburg.json`

**Observed real output** — not hand-constructed.

Source (2026-08-26):

`gs://atmuri-yt-transcripts/raw/zUBGbRycgiOhdHgFZtbDycYw1SH3-1787788487732/primary/zUBGbRycgiOhdHgFZtbDycYw1SH3-1787788487732_transcript_77caca81-0000-245d-ab7e-2405886b6768.json`

2.6-minute LibriVox Gettysburg Address clip: 22 segments, 328 words. Includes six zero-length word offsets (identical start/end) and words with per-word confidence below 0.5 while segment confidence stays high.

## `transcript-normalized-observed-gettysburg-before-word-timings.json`

**Observed normalized output before word-level preservation** — segment fields only, no `words[]`. Kept as a before/after reference for the normalized schema change.

## `speech-v2-batch-results-synthetic.json`

**Synthetic / defensive** — not observed in production.

Exercises multi-segment payloads, `{seconds, nanos}` duration encoding, and confirms that a `metadata` block (if present) does not break parsing. Do not treat this as ground truth for Google's output shape.
