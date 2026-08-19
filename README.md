# CloudScribe AI

CloudScribe AI is a GCP-native pipeline that turns lecture and other video content into transcripts, AI study notes, a RAG index, and a grounded study chatbot.

It began as a YouTube-style video hosting clone. That lineage is why some names still say `yt` — `yt-web-client`, the `atmuri-yt-*` buckets, and GCP project `yt-clone-385f4` (display name `cloudscribe-ai`). Those names are historical, not a product claim.

**What works today:** a signed-URL upload path, Pub/Sub-triggered transcoding, processed playback, and Firebase auth. That is Sprint 1, and it is deployed.

**What it is aiming to be:** the same upload path, plus batch Speech-to-Text, generated notes, a retrieval index over the user's own material, and a citation-backed study chat. Sprint 2 (event-driven Speech-to-Text v2) is rebuilt and waiting to be provisioned and deployed. Sprints 3–6 exist as specs only.

This is not a public video host, and it is not finished.

## Current architecture (deployed)

Three services, plus Firebase Auth / Firestore / Cloud Storage / Pub/Sub:

1. **`yt-web-client`** — Next.js UI for sign-in, upload, and watch. Deployed as Cloud Run service `cloudscribe-ai` (public ingress).
2. **`api-service`** — Firebase Functions (2nd gen, also Cloud Run) that mint signed upload URLs and list videos.
3. **`video-processing-service`** — Express worker on Cloud Run. Ingress is **`--ingress=internal`**. It is not on the public internet. Hitting its `.run.app` URL from a browser or an external uptime checker returns a Google-frontend 404 by design.

```mermaid
flowchart TD
  User[User] --> WebClient["yt-web-client"]
  WebClient --> Functions["api-service Functions"]
  Functions -->|"signed upload URL"| RawBucket["atmuri-yt-raw-videos"]
  WebClient -->|"PUT object"| RawBucket
  RawBucket -->|OBJECT_FINALIZE| UploadTopic[video-uploads-topic]
  UploadTopic -->|OIDC push| ProcessVideo["POST /process-video"]
  ProcessVideo --> ProcessedBucket["atmuri-yt-processed-videos"]
  ProcessVideo --> Firestore[Firestore]
  WebClient --> Firestore
  WebClient -->|"public GCS object today"| ProcessedBucket
```

The worker URL `https://video-processing-service-rfrkdig5jq-uc.a.run.app` is real, but only reachable from inside the project (Pub/Sub push, Cloud Scheduler, other GCP services). It is not a public health check. See [Known limitations](#known-limitations) and [`docs/monitoring-setup.md`](docs/monitoring-setup.md).

## Target architecture (Sprint 2 onward)

Sprint 2 does **not** add a fourth running service. Transcription is rebuilt inside `video-processing-service` as an event-driven Speech-to-Text v2 pipeline: `batchRecognize` writes JSON under a `raw/` prefix, a prefix-filtered bucket notification completes the job, and a scheduler sweeper records failures. `DYNAMIC_BATCHING` is the intended billing mode (discounted, fulfilled within 24 hours). There is no synchronous polling; Pub/Sub's ack deadline is 600s and cannot cover a long Speech job.

Sprint 3 adds a dedicated **notes service**. Sprints 4–6 add indexing, chat, and live transcription; those services are specified, not built.

```mermaid
flowchart TD
  RawBucket["atmuri-yt-raw-videos"] -->|OBJECT_FINALIZE| UploadTopic[video-uploads-topic]
  UploadTopic -->|push| ProcessVideo["POST /process-video"]
  ProcessVideo --> ProcessedBucket["atmuri-yt-processed-videos"]
  ProcessVideo --> AudioBucket["atmuri-yt-audio-work FLAC"]
  ProcessVideo --> ClaimDoc["Firestore transcript: pending"]
  ProcessVideo --> JobsTopic[transcription-jobs]
  JobsTopic -->|push| TranscribeAudio["POST /transcribe-audio"]
  TranscribeAudio -->|"batchRecognize, return 200"| SpeechV2["Speech-to-Text v2"]
  SpeechV2 -->|writes result| RawPrefix["atmuri-yt-transcripts raw/"]
  RawPrefix -->|"OBJECT_FINALIZE, prefix raw/"| ReadyTopic[transcripts-ready]
  ReadyTopic -->|push| TranscriptReady["POST /transcript-ready"]
  TranscriptReady --> NormPrefix["atmuri-yt-transcripts normalized/"]
  TranscriptReady --> DoneDoc["Firestore transcript: done"]
  Scheduler[Cloud Scheduler] -->|OIDC| Reconcile["POST /reconcile-transcripts"]
  Reconcile -.->|stale running jobs| SpeechV2
  DoneDoc -.->|Sprint 3, not built| NotesSvc["notes service / Gemini"]
  NotesSvc -.-> NotesBucket["notes/ bucket"]
```

Two design constraints that matter for cost and correctness:

- Normalized transcript output must **not** be written under the notification-watched `raw/` prefix, or Speech completion retriggers itself in a billed loop.
- Event-driven completion only observes success. Failed Speech jobs write no object, so `/reconcile-transcripts` is required.

## Services

| Service | Role | Status |
| --- | --- | --- |
| `yt-web-client` | Next.js UI. Cloud Run service name `cloudscribe-ai`. | Deployed |
| `api-service` | Firebase Functions: signed upload URLs, video listing. Sprint 2 adds a scoped `getTranscriptUrl`. | Deployed; transcript callable pending Sprint 2 deploy |
| `video-processing-service` | Transcode worker today; transcription worker after Sprint 2. Internal ingress. | Sprint 1 deployed; Sprint 2 code rebuilt, not deployed |
| Notes service | Cloud Run worker: transcript → Gemini → notes in GCS + Firestore | Specified only (Sprint 3) |

Later specified services (not started): RAG indexer (Sprint 4), study chatbot (Sprint 5), live transcription (Sprint 6).

## Roadmap

Specs live under [`docs/features/`](docs/features/). Status below is operational, not aspirational.

| Sprint | Intent | Status |
| --- | --- | --- |
| **1** | Stabilize upload → Pub/Sub → transcode → Firestore | **Done and deployed.** Smoke path, health endpoint (internal), Cloud Build triggers, env docs. See [`docs/features/SPRINT-01-COMPLETION.md`](docs/features/SPRINT-01-COMPLETION.md). |
| **2** | Batch Speech-to-Text v2, transcript GCS + Firestore, fetch API + watch UI | **Rebuilt, pending deploy.** Event-driven v2 design (not the older polling PR). Infra script and `ENABLE_TRANSCRIPTION` flag must land before a merge-to-main auto-deploy can succeed. |
| **3** | Notes service on Vertex AI Gemini | **Specified only.** [`docs/features/sprint-03-notes.md`](docs/features/sprint-03-notes.md) |
| **4** | Chunk + index into Vertex AI RAG Engine | **Specified only.** [`docs/features/sprint-04-rag-indexing.md`](docs/features/sprint-04-rag-indexing.md) — this sprint is the main cost risk; see [`docs/cost-and-credits.md`](docs/cost-and-credits.md). |
| **5** | Grounded study chatbot with citations | **Specified only.** [`docs/features/sprint-05-study-chatbot.md`](docs/features/sprint-05-study-chatbot.md) |
| **6** | Browser-mic live transcription into the same notes/RAG path | **Specified only.** [`docs/features/sprint-06-live-transcription.md`](docs/features/sprint-06-live-transcription.md) |

An architecture write-up from the `sprint1` branch (`docs/features/02-cloudscribe-architecture-evolution.md`) described a separate transcription Cloud Run service. The Sprint 2 rebuild superseded that: transcription stays in `video-processing-service`.

## Run locally

You need Node.js 22 (Functions engine), npm, `ffmpeg` on `PATH` (the worker shells out through `fluent-ffmpeg`), and Application Default Credentials for anything that talks to GCS/Firestore. Copy each service's `.env.example` and fill it in. Full variable lists: [`docs/environment-configuration.md`](docs/environment-configuration.md).

The practical loop used so far is **local web client + deployed Functions + deployed (internal) worker**. The worker is triggered by GCS → Pub/Sub, not by opening its URL.

### Web client

```bash
cd yt-web-client
cp .env.example .env.local   # then set the NEXT_PUBLIC_* values
npm install
npm run dev
```

UI: [http://localhost:3000](http://localhost:3000).

`NEXT_PUBLIC_VIDEO_PROCESSOR_URL` is leftover from when `/health` was treated as public. Leave it unset. The processor is internal-only.

### API (Firebase Functions)

```bash
cd api-service/functions
cp .env.example .env
npm install
npm run build
```

Emulators: `npm run serve` (builds, then `firebase emulators:start --only functions`). Signed-URL issuance against real GCS still needs credentials and bucket IAM.

Deploy to the shared project (this is what the smoke test currently assumes):

```bash
cd api-service
firebase deploy --only functions
```

### Video processing worker

```bash
cd video-processing-service
cp .env.example .env
npm install
npm test
npm start
```

Local `npm start` runs Express via `ts-node`. It will not receive production Pub/Sub pushes unless you point a subscription at it, which you should not do against the shared project. For the real path, upload through the client or [`scripts/smoke-test.sh`](scripts/smoke-test.sh) and watch Cloud Run logs.

End-to-end smoke (deployed Functions + worker): [`docs/smoke-test-guide.md`](docs/smoke-test-guide.md).

## Deploy

Two Cloud Build triggers fire on **push to `main`** only (`^main$`):

| Trigger | Config | Cloud Run service |
| --- | --- | --- |
| `video-processing-service` | [`video-processing-service/cloudbuild.yaml`](video-processing-service/cloudbuild.yaml) | `video-processing-service`, `--ingress=internal`, 2Gi / 1 CPU, max 1 instance |
| `web-client` | [`yt-web-client/cloudbuild.yaml`](yt-web-client/cloudbuild.yaml) | `cloudscribe-ai`, public |

Each build: Docker image for `linux/amd64` → Artifact Registry → `gcloud run deploy`. Builds use `N1_HIGHCPU_8` (not the e2-standard-2 free-minute SKU). Details: [`docs/cloud-build-setup.md`](docs/cloud-build-setup.md).

Functions are **not** on those triggers. Deploy them from `api-service` with `firebase deploy --only functions`.

Sprint 2 must not ride a naive merge to `main`. `ENABLE_TRANSCRIPTION` defaults on in the new code, and the transcription buckets/topics/subscriptions do not exist yet. Intended sequence: merge with the flag off on Cloud Run, run the infra script, deploy Functions, then flip the flag.

Manual scripts (`video-processing-service/deploy.sh`, `yt-web-client/deploy.sh`) still exist; Cloud Build is the path that actually ships `main`.

## Known limitations

Documented tradeoffs: [`docs/project-limitations.md`](docs/project-limitations.md). The important ones:

- **`/health` is not externally reachable.** Ingress is internal. Cloud Run's own startup probe (TCP on 8080) is what keeps the revision up. External Monitoring uptime checks against the `.run.app` host will look like an outage. [`docs/monitoring-setup.md`](docs/monitoring-setup.md) used to recommend that; it now flags the contradiction.
- **Pub/Sub ack is 600s.** A transcode that runs longer can be redelivered. Firestore status gating reduces duplicates; it does not eliminate the race.
- **Processed videos are public GCS objects** (`makePublic()`). Playback works; object ACLs do not. Signed video URLs and owner-only Firestore rules are a planned security pass, not done.
- **`allUsers` can still invoke the worker** in addition to the Pub/Sub service account. Combined with internal ingress this is less exposed than a public URL, but it is not least-privilege.
- **Raw uploads are never deleted** in GCS (`deleteRawVideo` removes the local temp file only).
- **No HLS/DASH, no CDN.** One `us-central1` bucket, one rendition.
- **Video id is the object filename.** Fine for the clone; brittle for hyphenated UIDs and dotted names (Sprint 2 keeps main's safer filename parsing).
- **`Video` TypeScript types are copy-pasted** across client, Functions, and worker.
- **Sprint 2 still needs buckets, push subscriptions, DLQ subscriptions, a prefix-filtered notification, and a scheduler job** before the flag can turn on.

## Cost

Rough envelope, current billing facts, and the Sprint 4 standing-cost trap: [`docs/cost-and-credits.md`](docs/cost-and-credits.md).

## Reference docs

- [`docs/environment-configuration.md`](docs/environment-configuration.md) — env vars, APIs, service accounts
- [`docs/pubsub-architecture.md`](docs/pubsub-architecture.md) — upload → process path
- [`docs/pubsub-iam-audit.md`](docs/pubsub-iam-audit.md) — topic/subscription IAM
- [`docs/monitoring-setup.md`](docs/monitoring-setup.md) — log-based alerts; do not use external `/health` uptime checks
- [`docs/cloud-build-setup.md`](docs/cloud-build-setup.md) — triggers
- [`docs/smoke-test-guide.md`](docs/smoke-test-guide.md) — upload smoke test
- [`docs/cost-and-credits.md`](docs/cost-and-credits.md) — GCP cost and credit-offer notes
- [`docs/project-limitations.md`](docs/project-limitations.md) — tradeoffs
