# AGENTS.md

Guidance for AI agents working in this repository. These are constraints and traps
learned by hitting them, not general advice. Read `README.md` for what the project is.

## Working with the supervisor

The repo owner leads product decisions and system design and verifies that behavior
matches intent. Agents lead implementation.

**Include checkpoints for human verification.** As changes are made, give the owner a
way to test the product behavior and see it with their own eyes. Say what to open, what
to do, and what they should expect to see. Programmatic verification and a written
report do not substitute for this.

End work with a high-level briefing: what was done, current status, what is blocking,
what needs a decision. Lead with the outcome, keep technical depth supplemental, and
illustrate designs and failure modes with a concrete worked example.

## Deploy traps

**Use `--update-env-vars`, never `--set-env-vars`.** `--set-env-vars` replaces the
service's entire environment. `video-processing-service` carries a dozen variables; a
deploy using `set` silently drops every one it does not name.

**Flipping a Cloud Build substitution does not change the running revision.** Updating
`_ENABLE_TRANSCRIPTION` affects future builds only. Enabling anything requires the
substitution change *and* a new build.

**`gcloud builds triggers update github ... --update-substitutions` does not work** on
the SDK in use. Export the trigger config, edit it, re-import with `--trigger-config`.

**Cloud Build runs on the default `E2_STANDARD_2` (2 vCPU)** so it stays inside the free
build-minute tier. Timeouts are sized for that, not for 8 vCPU. Do not lower them.

## Transcription invariants

`ENABLE_TRANSCRIPTION` defaults **false**. Three entry points can start paid work and
all three are gated: `/process-video` (publishes jobs), `/transcribe-audio` (the only
caller of `batchRecognize`), and `/reconcile-transcripts` (the sweeper). The sweeper was
missed on the first pass and Cloud Scheduler hits it every 15 minutes — if a new entry
point is added, gate it.

**Pub/Sub push only treats 2xx as an ack.** A permanently-unprocessable message must
return 200 after logging, or it retries to the dead-letter limit. Reserve non-2xx for
genuinely transient failures.

**`no_audio_detected` has two routes and both mean *complete*, not failed.** A file with
no audio stream (caught by an `ffprobe` pre-check) and a file whose audio contains no
speech (caught by the parser) are both valid lectures with nothing to quote. Do not
collapse either into `failed`.

**Duplicate billing is prevented by an atomic Firestore claim.** Only `pending` may
become `running`. `failed` and `needs_review` are terminal and never auto-retry.
`needs_review` exists for the case where Speech may have accepted a job but we could not
record it — that ambiguity is unresolvable from our side, so it waits for a human.

**Google's Speech service agent needs `roles/storage.objectCreator` on the transcripts
bucket.** It is an implicit identity that does not exist until the Speech API has been
used, which is why three IAM reviews missed it.

**The `raw/` and `normalized/` prefixes must never overlap.** The completion notification
watches `raw/`, and `/transcript-ready` writes to `normalized/` in the same bucket. If
they overlap, every write retriggers the notification in a billed loop. Startup
validation enforces this.

## Storage and security

**Create every new bucket with uniform bucket-level access.** It makes per-object ACLs
unavailable, so `makePublic()` fails rather than silently succeeding. `atmuri-yt-raw-videos`
and `atmuri-yt-processed-videos` do *not* have it, which is why processed videos are
world-readable today — that is a known exposure, not a pattern to copy.

**Firestore rules exist and are deny-by-default.** The Admin SDK (worker and all Cloud
Functions) bypasses them entirely; only the web client's direct reads are subject to
them. Transcript reads authorize via a `get()` on the parent video rather than the
transcript's own `userId`, so that `orderBy` queries without a `userId` filter still
succeed.

**De-hardcode the Firebase API key before restricting it.** `api-service/generate-smoke-test-token.js`
uses that key for a server-side call, and Node sends no `Referer` header. Adding referrer
restrictions first returns 403 and presents as an auth bug rather than a key restriction.

**Least-privilege IAM is deferred, not forgotten.** `262816123746-compute@developer.gserviceaccount.com`
holds project-wide `roles/editor` and is currently the runtime identity for every Cloud Run
service, every Cloud Function, and the Cloud Build service account for the Functions deploy
trigger (`api-service/cloudbuild.yaml`). That breadth has repeatedly masked missing narrow
grants: the Speech service agent's missing `storage.objects.create` on the transcripts bucket
took a live run to surface, and the Functions identity's transcripts-bucket access looked fine
only because Editor covered it. The Functions CI deploy added in PR #21 now depends on that
grant. **Target state:** a dedicated build service account with explicit deploy roles, and
separate runtime identities per service. **Why not now:** too much currently depends on the
broad grant; changing it risks breaking working deploys. Sequence this after the current
security items (signed video URLs, API-key restrictions, uniform access on legacy buckets).

Starting point if `roles/editor` is removed (verify against live bindings before applying):

- **Functions deploy SA** (currently the compute SA): `roles/cloudfunctions.admin`,
  `roles/artifactregistry.writer`, `roles/storage.objectAdmin` (GCF source and artifact
  buckets), `roles/cloudbuild.builds.editor`, `roles/iam.serviceAccountUser`, and
  `roles/firebase.admin` for `firebase deploy --only functions`.
- **Function/runtime SA** (per service in the target state): `roles/speech.client`,
  `roles/datastore.user`, and bucket-scoped `roles/storage.objectAdmin` on
  `atmuri-yt-raw-videos`, `atmuri-yt-processed-videos`, `atmuri-yt-transcripts`, and
  `atmuri-yt-audio-work`. Today the compute SA also carries `roles/run.admin`,
  `roles/iam.serviceAccountTokenCreator`, and the broad Editor grant; narrow those away as
  identities split.

## Couplings that are easy to break

**Videos transcode at original resolution on purpose.** The 360p downscale was removed,
and OCR quality for planned visual processing depends on it. Reintroducing downscaling to
save egress would silently degrade slide and equation readability with no error anywhere.

**The transcript document is the downstream contract**, evolving into a time-aligned
lecture-content model. Nothing downstream of it — notes, retrieval, chat — may depend on
how the transcript was produced. That is what keeps live capture from forking the pipeline.

**Retrieval is locked to Firestore `findNearest`** with `text-embedding-005` at 768
dimensions. Vertex Vector Search and RAG Engine bill hourly whether idle or not and were
ruled out on cost. Note `gemini-embedding-001` defaults to 3072 dimensions, which exceeds
Firestore's 2048 limit.

**`SPEECH_PROCESSING_STRATEGY` defaults to `STANDARD`** for fast test iteration.
`STANDARD` costs roughly 5x `DYNAMIC_BATCHING` per minute of audio. Switching before
serving real traffic is a launch-blocking decision.

## Test fixtures

Label fixtures as **observed** or **synthetic**. A hand-built Speech fixture once
included a `metadata` block Google does not send, so tests asserted a shape that does not
occur. Observed fixtures are evidence; synthetic ones are hypotheses, and a reader must
be able to tell which is which.

## Conventions

New branches use the `cursor/` prefix. Conventional commits. Verify behavior in the
running product before opening a PR — code review is structurally blind to integration
behavior and can pass a change that silently does nothing.
