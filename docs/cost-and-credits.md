# GCP cost (pay-as-you-go)

Snapshot: 19 August 2026. Inventory is from read-only `gcloud` against project `yt-clone-385f4`. List prices are from public Google Cloud pages that day, not a quote. This is a planning envelope, not an invoice. It does not change billing, delete resources, enable APIs, or apply for credits.

**Operating assumption: promotional GCP credits on this project are expired.** Every SKU is out of pocket. Cost sensitivity is high. A possible later offset is the YC Startup School Google Cloud Start Tier ($2,000); this document does not assume it lands, and it does not judge eligibility.

Project: `yt-clone-385f4` (display name `cloudscribe-ai`), region `us-central1`. Billing account `010854-8E7797-87BB7F` (`My Billing Account`). Authenticated CLI identity: `suryaatmuri57@gmail.com`.

## 1. What is true from the CLI

| Fact | Value |
| --- | --- |
| Billing enabled | Yes |
| Linked account | `billingAccounts/010854-8E7797-87BB7F`, open, USD |
| Other projects on this account | Only `yt-clone-385f4` |
| Project created | 2025-03-15T14:14:05Z |
| Cloud Billing Budget API | **Disabled** (`billingbudgets.googleapis.com`). `gcloud billing budgets list` cannot run without enabling it; it was left disabled. |
| Billing export to BigQuery | **None** (no datasets in the project) |
| Vertex AI indexes / index endpoints | **Zero** |
| Cloud SQL / GCE / Scheduler / Speech / Secret Manager APIs | Not enabled (so those products are not running) |

`My Billing Account` is Google's default display name. It does not mean “trial” or “has credits.”

## 2. What the CLI cannot see (Console-only)

Do not guess these. Open Cloud Console → Billing for project `yt-clone-385f4`:

| Item | Why CLI cannot read it |
| --- | --- |
| Remaining promo / trial credits, expiry, SKU restrictions | REST `/credits` on Cloud Billing v1 and v1beta returns HTML 404. No credit object is exposed. |
| Invoice history and SKU-level spend (last 30/90 days) | Needs Console Reports, or a BigQuery billing export that does not exist. Cloud Cost Insights API 404s. |
| Whether **any Google Cloud credits beyond free trial** were ever received | Start-tier disqualifier; Console → Billing → Credits. |
| Logging ingest volume vs the 50 GiB free allotment | Monitoring time-series CLI is not available in this SDK install; Console → Logging / Billing Reports. |
| Firebase Hosting stored bytes / transfer for site `yt-clone-385f4.web.app` | `firebase hosting:sites:list` shows the site; usage is Console-only. |
| Whether a budget already exists | Budget API disabled. |

So: this account **will be charged** for usage. The **actual** last-month invoice is Console-only. Everything below is measured inventory × public list price.

## 3. What is billing money right now

### Standing cost (billed while idle)

The only measured standing charge today is **Artifact Registry storage**.

| Repository | Billed size (`sizeBytes`) | Notes |
| --- | --- | --- |
| `video-processing-service` | **2.878 GiB** (3,090,212,354 bytes) | ffmpeg worker images; no cleanup policy |
| `yt-web-client-repo` | **1.723 GiB** (1,850,631,535 bytes) | Next.js images; no cleanup policy |
| `gcf-artifacts` | 0 | Functions images; cleanup policy deletes anything older than 1 day |
| `web-client` | 0 | Empty leftover repo (`cleanupPolicyDryRun: true`) |
| **Total** | **4.601 GiB** | First **0.5 GiB / billing-account / month** is free ([Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing)) |

Billable: 4.101 GiB × **$0.10 / GiB-month** (`$0.000136986 / GiB-hour`) ≈ **$0.41 / month**, 24/7, even if nobody visits the app and nobody pushes code.

That is the idle bill. Everything else currently running is request-shaped or inside Always Free.

### Artifact Registry image counts (stale tags)

`gcloud artifacts docker images list --include-tags` (19 August 2026):

**`video-processing-service` (18 listed digests):**

| Tag / package | Status |
| --- | --- |
| `video-processing-service:latest` + `bd64d91…` | **Live** (deployed 19 Aug 2026, ~653 MB virtual) |
| `video-processing-service:a7c1be…` | Stale (14 Nov 2025) |
| `video-processing-service:6882cb…` | Stale (13 Nov 2025) |
| `video-processing-service:4e9f221…` | Stale (14 Nov 2025) |
| `processor:latest` | **Dead package** from 18 Mar 2025 (~626 MB layer). Nothing deploys this name anymore. |
| Remaining digests | Untagged manifests / config blobs left by old builds |

**Four stale named tags** plus a pile of untagged digests. Layer sharing means billed size (2.878 GiB) is less than summing virtual sizes, but it is still ~2 GiB more than “keep only `latest`.”

**`yt-web-client-repo` (10 listed digests):**

| Tag / package | Status |
| --- | --- |
| `yt-web-client:latest` + `bd64d91…` | **Live** (~769 MB virtual) |
| `web-client:latest` | Dead package name from 10 Nov 2025 (~752 MB layer) |
| Remaining | Untagged old `yt-web-client` layers (~726 MB class) |

**One stale named tag** (`web-client:latest`) plus untagged history.

If only the two live images were kept, billed storage would likely drop to ~1.3–1.5 GiB (still a bit over the 0.5 GiB free tier because the two images do not share layers across repos) → about **$0.08–0.10 / month**. The extra **~$0.30 / month** is old images sitting there for no benefit.

### GCS (not costing money yet; grows forever)

| Bucket | Bytes | Objects | Lifecycle |
| --- | --- | --- | --- |
| `atmuri-yt-raw-videos` | **80,063,281** (76.35 MiB) | 5 | **None** |
| `atmuri-yt-processed-videos` | **4,641,122** (4.43 MiB) | 5 | **None** |
| `gcf-sources-262816123746-us-central1` | 198,929 | Functions source | n/a |
| `gcf-v2-sources-262816123746-us-central1` | 299,560 | Functions source (versioning on) | n/a |
| `gcf-v2-uploads-…` | 0 | empty | n/a |

Always Free in `us-central1` (aggregated with `us-east1` / `us-west1`): **5 GB-months**, 5,000 Class A, 50,000 Class B, 100 GB NA transfer ([Cloud Storage pricing](https://cloud.google.com/storage/pricing)). Current footprint ≈ **81 MiB** → **$0**.

Standard storage list price in this region is about **$0.020 / GiB-month**. Raw uploads are never deleted. One object (`zUBGbRycgiOhdHgFZtbDycYw1SH3-1762753390224.mp4`, **59.4 MiB**) has **no processed counterpart** — a failed or abandoned transcode occupying most of the raw bucket.

Public processed playback is the storage wildcard: `makePublic()` means every watch is GCS internet egress (~$0.12 / GiB after Always Free). Small at classroom scale; not small if a URL leaks.

### Cloud Run — min instances are 0 on every service

No `autoscaling.knative.dev/minScale` annotation on any service (unset = 0). Confirmed 19 August 2026:

| Service | CPU / mem | maxScale | minScale | Ingress |
| --- | --- | --- | --- | --- |
| `cloudscribe-ai` | 1 / 512Mi | 20 | **0** | all |
| `video-processing-service` | 1 / 2Gi | 1 | **0** | internal |
| `generateuploadurl` (Functions gen2) | 1 / 256Mi | 1 | **0** | HTTP |
| `getuploadurl` (Functions gen2) | 1 / 256Mi | 1 | **0** | HTTP |
| `getvideos` (Functions gen2) | 1 / 256Mi | 1 | **0** | HTTP |

`createUser` is Functions **gen1** (Auth `onCreate`), 256 MiB, no min instances — also scale-to-zero.

`startup-cpu-boost: true` bills a short CPU burst at cold start only; it is not a 24/7 charge.

Request-based Cloud Run in `us-central1` ([Cloud Run pricing](https://cloud.google.com/run/pricing)): 180k vCPU-seconds, 360k GiB-seconds, 2M requests free / month. Idle cost: **$0**. A 2-minute 1 vCPU / 2Gi transcode is ~$0.003 before free tier.

**Do not set `min-instances >= 1`.** That is the switch that turns this into a 24/7 VM.

### Cloud Build — paid machine, not the free SKU

Both triggers (`video-processing-service`, `web-client`) fire on push to `main` and both YAML files set `machineType: N1_HIGHCPU_8`.

[Cloud Build pricing](https://cloud.google.com/build/pricing) (us-central1):

| Machine | Rate | Free minutes |
| --- | --- | --- |
| `e2-standard-2` (default / Quick Start) | $0.006 / min | **2,500 / month / billing account** |
| `N1_HIGHCPU_8` (priced as `e2-highcpu-8`) | **$0.0156 / min** | **None** |

Queue time is not billed. Measured **billed** durations for the 19 August 2026 successful pair (`COMMIT_SHA=bd64d91`):

| Trigger | Start → finish | Billed minutes | Cost at $0.0156 |
| --- | --- | --- | --- |
| `video-processing-service` | 3 min 53 s | 3.88 | **$0.061** |
| `web-client` | 6 min 15 s | 6.25 | **$0.098** |
| **Pair (one merge to `main`)** | | **10.13** | **$0.16** |

History: those two successes today, then a cluster of Nov 2025 builds (several failures still billed). Months with **no `main` push cost $0** in Cloud Build. Months with work do not.

| Cadence | N1_HIGHCPU_8 | Same minutes on `e2-standard-2` |
| --- | --- | --- |
| 1 merge (today) | $0.16 | $0 (inside 2,500 free min) |
| 8 merges / month (solo, active week) | **~$1.28** | **$0** |
| 20 merges / month (busy sprint) | **~$3.20** | **$0** (200 min ≪ 2,500) |

Switching YAML to the default `e2-standard-2` (omit `machineType`, or set it explicitly) saves **100% of Cloud Build spend** at this cadence. Builds will be slower. The worker timeout is currently **600s**; if a 2-vCPU ffmpeg image build exceeds that, bump `timeout` when changing the machine. The web client timeout is already 900s.

There is also `.github/workflows/deploy-video-processing.yml`, which rebuilds and pushes the **same** worker image on `main`. If that workflow is still enabled, a `main` push can produce **two** Artifact Registry writes for one change (Cloud Build + GitHub Actions). GitHub minutes are not a GCP SKU; the extra image **is**.

### Firestore, Pub/Sub, Logging — nothing non-trivial

| Product | What exists | Cost now |
| --- | --- | --- |
| Firestore `(default)` | Native, Standard edition, `us-central1`, **free-tier database**, PITR **off**, 1-hour version retention, **no composite/vector indexes** | $0 at this scale. Free quota: 1 GiB stored, 50k reads / 20k writes / 20k deletes per day ([Firestore pricing](https://cloud.google.com/firestore/pricing)). |
| Pub/Sub | `video-uploads-topic` + push sub `video-processing-subscription` (ack 600s). Orphan topic `failed-messages` with **no subscription**. | First 10 GiB/month delivery free. Notification JSON is tiny. **$0**. |
| Cloud Logging | `_Default` retention **30 days**; `_Required` (audit) **400 days**, locked, not billed. No custom sinks. | First **50 GiB / project / month** ingest free; retention beyond 30 days on `_Default` is $0.01/GiB-month. Volume is Console-only; at current traffic this is almost certainly **$0**. |

### Other leftovers (not a standing bill, still worth deleting)

| Thing | Cost today | Why clean it |
| --- | --- | --- |
| Failed Function `on_request_example` (Python gen2, Cloud Run service missing since Jul 2025) | $0 | Template debris. |
| Empty Artifact Registry repo `web-client` | $0 | Confusion; unused. |
| Pub/Sub topic `failed-messages` | $0 | No subscription. |
| Firebase Hosting site `yt-clone-385f4.web.app` | Unknown (Console); Spark/Blaze free tier usually covers an empty site | Confirm it is unused; the live app is Cloud Run, not Hosting. |
| Duplicate upload Functions `generateUploadUrl` (callable) + `getUploadUrl` (HTTP) | $0 idle; both are used (web client vs smoke tests) | Not waste. Do not delete. |

### No budget, no alert

`billingbudgets.googleapis.com` is disabled. There is **no CLI-visible budget**. The cheapest safety control is a Console budget at **$5** and **$10** with email to `suryaatmuri57@gmail.com`. Creating it requires enabling that API or using the Billing console — out of scope for this write-up (and this session does not enable APIs).

## 4. Realistic monthly burn

### NOW (Sprint 1 only, nothing new deployed)

| Line | Idle (no `main` pushes, no uploads) | Light active (≈8 `main` pushes, a few test uploads) |
| --- | --- | --- |
| Artifact Registry (current 4.6 GiB) | **$0.41** | $0.41, creeping up if images are not pruned |
| Cloud Build `N1_HIGHCPU_8` | $0 | **~$1.30** |
| Cloud Run + Functions | $0 | $0 (free tier) |
| GCS + Firestore + Pub/Sub + Logging | $0 | $0 |
| **Total** | **about $0.40–0.50 / month** | **about $1.50–2.50 / month** |

The 19 August pair of builds already spent **~$0.16** out of pocket. That is real money, not credits.

After the cheap wins in §6 (prune images + `e2-standard-2`): idle **~$0.08–0.10**, active **~$0.10**.

### AFTER Sprint 2 deploys (Speech-to-Text v2 batch, still no Vertex RAG)

Sprint 2 is built in git and **not** deployed. `speech.googleapis.com` is not enabled. Scheduler API is not enabled. No transcript/audio buckets exist yet.

Sprint 2 does not add a 24/7 instance if min-instances stay 0 and Scheduler stays at one job (first 3 Cloud Scheduler jobs are free).

| Line | Light test (≈2 hours audio / month) | Modest class (≈40 lecture-hours) |
| --- | --- | --- |
| Standing (AR, after cleanup) | $0.10 | $0.10 |
| Cloud Build (if still `N1_HIGHCPU_8`, 8 merges) | $1.30 | $1.30 |
| Speech-to-Text v2 **`DYNAMIC_BATCHING`** | **$0.36** ($0.003/min) | **$7.20** |
| Same audio **without** dynamic batch | $1.92 | $38.40 |
| Cloud Run transcode | ~free tier | maybe $1–5 if jobs are long |
| New GCS (flac + transcripts) | $0 while under 5 GB | $0 until raw+audio pile up |
| **Total (dynamic batch, keep N1_HIGHCPU_8)** | **about $2–4 / month** | **about $10–15 / month** |
| **Total (dynamic batch + cheap wins)** | **about $0.50–1 / month** | **about $8–13 / month** |

v2 tables do **not** list a 60-minute free tier. That free hour is a **v1** line. Budget Speech from second one.

Gemini notes / chat (Sprint 3/5) at Flash-class list prices stay in single-digit dollars at classroom scale. They are usage, not standing. AI Studio free tier can cover **your own** test prompts; it is not a privacy tier for other people's lecture audio.

### What must not be turned on

| If you provision this and leave it | Standing cost (us-central1, idle or busy) |
| --- | --- |
| Vertex AI Vector Search, 1× `e2-standard-2` | **$0.0938084 / node-hour × 730 ≈ $68 / month** ([Agent Platform / Vector Search pricing](https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing); Google's own example is $68 for 2M×128-dim, 1 node) |
| RAG Engine `RagManagedDb` **Basic** (Spanner Enterprise 100 PU = 0.1 node, with backup) | **0.1 × $1.23 / node-hour × 730 ≈ $90 / month** before SSD/backup ([RAG Engine billing](https://cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/rag-engine-billing), [Spanner pricing](https://cloud.google.com/spanner/pricing)) |
| RAG Engine **Scaled** (starts at 1 node, to 10) | **≈ $900 / month** floor |
| Cloud SQL for pgvector, smallest `db-f1-micro` | **$0.0105 / hour ≈ $7.70 / month** compute + disk; Google's own test-instance example is **$9.37 / month** ([Cloud SQL pricing](https://cloud.google.com/sql/pricing)). No SLA on shared-core. |

On pay-as-you-go, those are the lines that turn a ~$1 hobby bill into a rent payment.

## 5. Sprint 4 — zero-standing-cost RAG (recommendation)

The expensive planned component is the vector store, not the embeddings. Embedding generation is per-token. Vector Search and RAG Engine's managed DB bill **hourly whether or not anyone chats.**

### Recommendation

**Use Firestore vector search (`findNearest`) on the default database that already exists.** Generate embeddings per-use with Vertex / Gemini Embedding, store them on chunk documents, create one **flat** vector index. Do not provision Vector Search, RAG Engine `RagManagedDb`, or Cloud SQL.

This is exact k-nearest neighbour, not a managed ANN service. At a few hundred lecture transcripts that is the right trade: **no new product, no idle meter, slightly more application code.**

### Why Firestore vector search is real and cheap here

Official docs (19 August 2026): [Search with vector embeddings](https://cloud.google.com/firestore/docs/vector-search).

| Constraint | Value | Implication for CloudScribe |
| --- | --- | --- |
| Index type | **`flat` only** (exhaustive / exact KNN, not ANN) | Better recall than Vector Search ANN at this size; latency and index-read cost grow with corpus size. |
| Max dimensions | **2048** | `gemini-embedding-001` defaults to **3072** and **will not fit**. Request `output_dimensionality` **768 or 1536** (recommended MRL sizes) and **L2-normalize** truncated `gemini-embedding-001` vectors. Or use `text-embedding-005` (native 768). |
| Result cap | **1000** documents (Standard edition) | Irrelevant for RAG top-k = 5–10. |
| Client libraries | Python, Node.js, Go, Java | Worker and Functions are Node — supported. |
| Listeners | No realtime snapshot listeners on vector queries | Fine; chat is request/response. |
| Index | Required: `gcloud firestore indexes composite create` with `vector-config='{"dimension":"768","flat":"{}"}'` | One-time. Pre-filters (e.g. `uid ==`) go on the same composite index. |
| Pricing | Ordinary Firestore: storage + reads/writes. kNN is billed **1 document-read per 100 vector index entries scanned**, plus 1 read per returned document. No hourly node. | 4,000 chunks ≈ 40 index-read ops + 5 result reads ≈ **45 reads / query**. Free quota is 50k reads/day → thousands of chat turns before a bill. Storage of 768-d float32 vectors is a few KB each; hundreds of lectures stay inside the **1 GiB** free database. |

Embeddings ([Vertex / Agent Platform generative pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)):

| Model | List price | Fit |
| --- | --- | --- |
| Gemini Embedding (`gemini-embedding-001`) | **$0.15 / 1M input tokens** online ($0.12 batch); output free | Best quality; **must** truncate to ≤2048 dims for Firestore. |
| Embeddings for Text excluding Gemini (e.g. `text-embedding-005`) | **$0.025 / 1M** online | Cheaper, native 768, fits the index with no truncation. |

Rough embed cost: 200 hour-long transcripts ≈ 3M tokens → **~$0.45** one-time on Gemini Embedding, **~$0.08** on `text-embedding-005`. Query embeddings are ~100 tokens: fractions of a cent.

### Alternatives considered

| Option | Standing cost | Verdict |
| --- | --- | --- |
| **Firestore `findNearest` (recommended)** | $0 idle | Exact KNN, already in-stack, bills per read. |
| In-process brute force (vectors in Firestore/GCS, cosine in Cloud Run) | $0 idle | Also valid at a few thousand chunks. More code (load, cache, cold start). Use as a fallback if you do not want a vector index. |
| Vertex AI Vector Search | **~$68 / month** idle | ANN quality at huge scale we do not have. |
| RAG Engine Basic / Scaled | **~$90 / ~$900 / month** idle | Spanner Enterprise underneath. Do not “try it.” |
| pgvector on Cloud SQL | **~$8–10 / month** idle for `db-f1-micro` | Disqualified: instance runs 24/7. `sqladmin.googleapis.com` is not even enabled. |
| AlloyDB / Memorystore / Vertex Matching Engine 2.0 resource-based | Standing compute | Same class of problem. |

### Honest tradeoff

You give up a managed RAG product (ingestion UI, built-in chunking, ANN at billion scale, RAG Engine's parser graph). You write chunking, embedding writes, `findNearest`, and the retrieve-then-Gemini prompt yourself.

You do **not** give up recall at this corpus size. Firestore's flat index is **exact** KNN; Vector Search is **approximate**. The real limits are linear scan cost as the corpus grows, the 1000-hit cap, the 2048-dimension ceiling (so default 3072 Gemini embeddings are unusable without truncation), and the day you have millions of chunks — at which point paying $68/month for Vector Search might finally make sense.

Until then, **$0 idle beats 99% recall-at-scale you will not use.**

Suggested shape when Sprint 4 is built: collection `chunks` with `uid`, `videoId`, `text`, `embedding` (768-d). Index on `uid` + vector field. Chat: embed the question → `findNearest` limit 8 → Gemini with citations. No new GCP product.

## 6. Cheap wins (do these; this session did not)

None of these were applied. They are safe, high-leverage, and mostly one-time.

1. **Delete stale Artifact Registry images** (or add a cleanup policy). Recovers ~$0.30/month immediately; stops unbounded growth. See §8 for the repo-side change.
2. **Switch Cloud Build `machineType` to `e2-standard-2`.** Saves **$0.16 per merge**, 100% of CI compute at solo cadence. Bump the worker `timeout` if needed.
3. **Disable the duplicate GitHub Actions worker deploy** so `main` does not push the same image twice.
4. **GCS lifecycle on the raw bucket** (delete or Archive after N days, or delete raw once processed). Not a bill today; it is the unbounded line.
5. **Console budget** at $5 / $10. API is disabled; create it in Billing → Budgets.
6. **Delete debris:** failed `on_request_example`, empty `web-client` AR repo, unused `failed-messages` topic, confirm Hosting site is empty.

## 7. Possible later offset: YC Startup School Start Tier

Stated offer (as given; this repo cannot see an offer letter):

| Item | Stated terms |
| --- | --- |
| Google Cloud Start Tier credits | $2,000, valid 2 years |
| Gemini | Free-tier Google AI Studio access |
| Workspace | 12 months Google Workspace Business Plus |
| Skills | $200 Google Skills credits |

Stated eligibility:

- Digital-native tech startup with a working MVP, a clear business model, and plans to seek VC funding soon
- Founded within the last 24 months
- **Has not received Google Cloud credits beyond free trial**

Public Start-tier pages on 19 August 2026 ([Pre-funded startups](https://cloud.google.com/startup/pre-funded), [Benefits](https://cloud.google.com/startup/benefits)) list the same $2,000, AI Studio free tier, Workspace, and Skills credits, and the same three bullets. They also say credits are valid **12 months / one year**, not two. Scale-tier is the two-year product. Third-party Marketplace models are not covered. Acceptance is at Google's discretion.

Treat the YC write-up and the public pages as two sources. If they disagree on duration, the offer letter / program dashboard wins.

This document **does not decide eligibility.** Promo credits on this billing account are expired; Start Tier, if granted, would be a future offset on the same SKUs, not a reason to turn on Vector Search.

At the burn in §4, $2,000 lasts far longer than the credit clock. The way to waste it (or cash) is still a standing vector index.

## 8. Code / config changes (not made here)

These files live on `main` or on the Sprint 2 branch. This branch only updates this document.

| File | Change | Expected saving |
| --- | --- | --- |
| `video-processing-service/cloudbuild.yaml` | Remove `options.machineType: N1_HIGHCPU_8` (default is `e2-standard-2`), or set `E2_STANDARD_2` if the schema requires an explicit value. Raise `timeout` from `600s` to `1200s` so a slower 2-vCPU ffmpeg build cannot kill the job. | **$0.061 / worker build**; ~$0.50–$1.00 / month at 8–16 worker builds. Uses the 2,500 free minutes. |
| `yt-web-client/cloudbuild.yaml` | Same `machineType` change. Timeout already `900s`; watch the first default-machine build and raise if needed. | **$0.098 / web build**; rest of the pair. |
| `.github/workflows/deploy-video-processing.yml` | Delete or disable (`if: false` / remove `on.push`). Cloud Build trigger `video-processing-service` already deploys on `main`. Dual-running this workflow double-writes Artifact Registry. | Avoids a second ~600 MB+ image per worker change; prevents extra AR GB-month and a racey double deploy. |
| Artifact Registry cleanup (cloud config, not a git file today) | Add a **live** cleanup policy on `video-processing-service` and `yt-web-client-repo`: keep `latest` + last 2 tagged SHAs; delete untagged and tags older than 14 days. Do **not** leave `cleanupPolicyDryRun: true` (that is what `web-client` has). Optionally delete the dead `processor` and `web-client` packages now. | **~$0.30 / month now**, and stops $0.10/GiB-month growth on every merge. |
| GCS lifecycle (new JSON, same pattern as `utils/gcs-cors.json`) | On `atmuri-yt-raw-videos`: delete objects after 30 days, **or** delete after successful transcode in the worker. On processed: optional Nearline/Archive after 90 days if originals are disposable. | $0 today; avoids unbounded Standard storage. 59 MiB orphan raw object is the proof this matters. |
| Sprint 2 (when that branch deploys) | Keep `processingStrategy: 'DYNAMIC_BATCHING'`. Do not enable Speech standard for “it should be faster.” Prefix-filter transcript notifications so `normalized/` cannot retrigger. One Scheduler sweeper only. | 5× Speech multiplier avoided ($0.18/h vs $0.96/h). |
| Sprint 4 (future) | Firestore `findNearest` + 768-d embeddings. **Do not** add Vector Search, RAG Engine, or Cloud SQL to any Terraform/gcloud setup script. | Avoids **$68–900 / month** standing. |

## 9. Pricing traps (pay-as-you-go edition)

1. **Credits are gone.** There is no buffer. A leftover Vector Search index is a $68/month subscription you did not mean to buy.
2. **RAG Scaled is a 1-node Spanner Enterprise instance (~$900/month)**, not a serverless upgrade.
3. **`N1_HIGHCPU_8` is not on the 2,500-minute free SKU.** It is the largest *current* usage-shaped line once you start merging again.
4. **Artifact Registry has no cleanup on the two app repos.** Every merge is a GB-month that never evaporates.
5. **`DYNAMIC_BATCHING` off** multiplies Speech by ~5×.
6. **Official v2 Speech has no listed free 60 minutes.**
7. **Normalized transcripts under `raw/`** retrigger Speech forever.
8. **`min-instances > 0`** on Cloud Run is a 24/7 VM. All five services are 0 today; keep them there.
9. **`makePublic()` egress** is uncapped if a processed URL leaks.
10. **Raw bucket has no lifecycle.** Cheap per GB, unbounded.
11. **AI Studio free tier is not a data-privacy tier.**
12. **Default Gemini embeddings are 3072-d.** Firestore vector index max is 2048. Truncate (768/1536) or pick `text-embedding-005`.
13. **Dual CI** (Cloud Build + GitHub Actions) doubles image storage for the worker.

## 10. How to see the invoice this document cannot

In Cloud Console, project `yt-clone-385f4`:

1. **Billing → Credits** — confirm expiry (assumed: none remaining).
2. **Billing → Reports** — last 30/90 days by SKU. That is the actual burn.
3. **Billing → Budgets** — create $5 and $10 alerts.
4. **Artifact Registry** — confirm billed size after a cleanup policy.
5. **Cloud Run → each service → Revisions / min instances** — confirm still 0 after future deploys.
