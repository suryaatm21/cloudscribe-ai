# GCP cost and credits assessment

Snapshot date: 19 August 2026. Prices are from public Google Cloud pages that day, not from a quote or a negotiated contract. They change. This is an envelope for planning, not an invoice.

Project: `yt-clone-385f4` (display name `cloudscribe-ai`), region `us-central1`.

This document does **not** apply for any credit, change billing, or create cloud resources. It does **not** decide whether the project or company is eligible for any offer.

## 1. Stated offer (as given)

YC Startup School Google offer, as stated:

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

### What the public Start-tier pages say (for comparison)

Google's published Start-tier pages on 19 August 2026 ([Pre-funded startups](https://cloud.google.com/startup/pre-funded), [Benefits](https://cloud.google.com/startup/benefits)) list the same $2,000, AI Studio free tier, 12 months Workspace Business Plus, and $200 Skills credits, and the same three eligibility bullets.

They also say **credits are valid for 12 months / one year**, not two. Scale-tier credits are the ones described over two years. Third-party Marketplace models are not covered. Acceptance is at Google's discretion.

Treat the YC write-up and the public Start-tier pages as two sources. If they disagree on duration, the offer letter / program dashboard wins; this repo cannot see that.

## 2. Actual billing state (read-only CLI)

Commands used (no writes, no API enablement):

```text
gcloud billing projects describe yt-clone-385f4
gcloud billing accounts list
gcloud billing accounts describe 010854-8E7797-87BB7F
gcloud billing projects list --billing-account=010854-8E7797-87BB7F
gcloud projects describe yt-clone-385f4
```

Also a GET on `https://cloudbilling.googleapis.com/v1/billingAccounts/010854-8E7797-87BB7F`. Credit-shaped REST paths (`/credits` on v1 and v1beta) returned HTML 404.

### What is true

| Fact | Value |
| --- | --- |
| Billing enabled on the project | **Yes** (`billingEnabled: true`) |
| Linked account | `billingAccounts/010854-8E7797-87BB7F` |
| Account display name | `My Billing Account` |
| Account open | Yes |
| Currency | USD |
| Other projects on this account | Only `yt-clone-385f4` |
| Project create time | 2025-03-15T14:14:05Z |
| Authenticated CLI identity | `suryaatmuri57@gmail.com` |

`My Billing Account` is the default name Google assigns. It does not mean “paid,” “trial,” or “has credits.”

### What the CLI cannot see

These are Console-only (Billing → Credits / Reports), or require APIs that are not enabled:

- Whether a **free-trial credit** is or was attached
- Remaining promotional balance, expiry, or SKU restrictions
- Whether **any Google Cloud credits beyond free trial** were ever received (the Start-tier disqualifier)
- Invoice history and SKU-level spend
- Budgets and alerts — `gcloud billing budgets list` wanted `billingbudgets.googleapis.com` enabled; that API was left disabled

So: billing is on and this account will be charged for usage. Whether a $300 trial is still running, already spent, or never existed is **unknown from the CLI**. Whether applying for Start-tier credits would violate “has not received credits beyond free trial” is **not determined here**.

## 3. What is actually running (cost-relevant)

Confirmed 19 August 2026:

| Resource | Notes |
| --- | --- |
| Cloud Run `cloudscribe-ai` | Public web client, 1 vCPU / 512Mi, ingress `all` |
| Cloud Run `video-processing-service` | 1 vCPU / 2Gi, max 1 instance, **ingress `internal`**, min instances unset (scale to zero) |
| Cloud Run `generateuploadurl`, `getuploadurl`, `getvideos` | Firebase Functions 2nd gen |
| GCS `atmuri-yt-raw-videos`, `atmuri-yt-processed-videos` | `US-CENTRAL1` |
| GCS `gcf-sources-*`, `gcf-v2-*` | Functions source / upload buckets |
| Pub/Sub `video-uploads-topic` + push subscription | Upload → `/process-video` |
| Firestore + Firebase Auth | Default database |
| Artifact Registry | Two image repos (web + worker) |
| Cloud Build | Two `main`-branch triggers, `N1_HIGHCPU_8` |

Not provisioned yet: transcripts bucket, audio-work bucket, notes bucket, Speech jobs, Vertex Gemini in-project, RAG corpus, Vector Search index, Cloud Scheduler sweeper.

## 4. Per-service prices (public list, us-central1)

### Speech-to-Text v2 batch — Sprint 2

Source: [Speech-to-Text pricing](https://cloud.google.com/speech-to-text/pricing).

| Mode | List price | One hour of mono audio |
| --- | --- | --- |
| Standard recognition (v2) | $0.016 / minute | **$0.96** |
| **`DYNAMIC_BATCHING`** (v2) | **$0.003 / minute** | **$0.18** |

`DYNAMIC_BATCHING` is a real discount (about 81% vs standard v2). Fulfilment can take up to 24 hours. The Sprint 2 design sets `processingStrategy: 'DYNAMIC_BATCHING'`.

The official **v2** tables do **not** list a 60-minute free tier. That free 60 minutes appears on the **v1** tables. Do not budget a free hour on v2.

Billed per channel, rounded up to 1 second. A stereo file costs 2×. Requests that error are not billed; empty transcripts are.

For this project, Speech is the main **usage-shaped** AI cost once Sprint 2 is on. It is not a standing fee.

### Vertex AI Gemini vs AI Studio — Sprints 3 and 5

Source: [Vertex / Agent Platform generative pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing) (19 August 2026).

| Model (standard, global) | Input / 1M tokens | Output / 1M tokens |
| --- | --- | --- |
| Gemini 2.5 Flash | $0.30 | $2.50 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 |
| Gemini 2.5 Pro | $1.25 | $10.00 |

`gemini-1.5-pro` is retired; do not use it.

Rough token math for a 1-hour lecture (≈15k input tokens of transcript + prompt, ≈3k output tokens of notes) on **2.5 Flash**: about **$0.012 per lecture**. Two hundred chat turns at ≈4k in / 800 out: about **$0.60**. Even modest classroom use stays in single-digit dollars unless someone points the pipeline at Pro or sends full video tokens instead of the transcript.

**Google AI Studio / Gemini API free tier** (the Start-tier perk): same Flash-class models, no per-token charge, rate-limited. Limits move and are shown in AI Studio, not in this repo. Official rate-limit page: [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). Free-tier prompts may be used to improve Google products; Vertex / paid Gemini API generally are not. No VPC-SC, no Cloud IAM on the key, no SLA.

For Sprint 3/5 **development**, AI Studio free tier can cover notes + chat. For anything with other people's lecture audio, prefer Vertex (or paid Gemini API) so prompts are not training fodder. Per-token list prices on the paid Gemini API and Vertex are in the same band for Flash; Vertex is what the Sprint 3 spec calls for, and what $2,000 Cloud credits can actually pay.

### Vertex AI RAG Engine / Vector Search — Sprint 4 (the expensive one)

This line item is **disproportionate**. Managed vector stores here bill for capacity that sits on, not for queries.

**Vector Search 1.0** ([Agent Platform pricing](https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing), Vector Search section):

- Serving: **$0.0938084 / node-hour** for `e2-standard-2` in `us-central1`
- Official example: 2M × 128-dim vectors, 1 node → **~$68 / month**
- Index build/update: **$3.00 / GiB** processed; streaming inserts **$0.45 / GiB**
- Formula they publish: `replicas × shards × hourly rate × 730 hours`
- **Billed while the index is deployed, including idle.**

One leftover test index is ~$68/month. Two replicas or a larger machine type and it doubles or worse. Storage-optimized CUs are **$2.30 / CU-hour / replica** — not a hobby SKU.

**RAG Engine `RagManagedDb`** ([RAG Engine billing](https://cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/rag-engine-billing), [Spanner pricing](https://cloud.google.com/spanner/pricing)):

- Basic tier: dedicated **Spanner Enterprise, 100 processing units (0.1 node), with backup**
- Regional Enterprise compute in `us-central1`: **$1.23 / node-hour**
- 0.1 × $1.23 × 730 ≈ **$90 / month**, before SSD ($0.30/GiB-month class) and backup
- Scaled tier: **starts at 1 node**, autoscales to 10 → **~$900 / month** floor in this region

RAG Engine ingestion/chunking is listed as free; embeddings and the LLM are billed on their own SKUs. Serverless RAG mode still bills whatever vector DB it provisions (default Vector Search 2.0).

**Do not provision Vector Search or `RagManagedDb` “to try it” and leave it.** Tear it down (Vector Search: undeploy the index; RAG: Unprovisioned tier, which deletes data) or the $2,000 drains on a standing clock.

Cheaper Sprint 4 alternatives the spike in the spec should actually run: Firestore vector search on the default DB (free-tier sized), or embeddings in GCS + in-process search, until there is real query volume.

### Cloud Run

Source: [Cloud Run pricing](https://cloud.google.com/run/pricing). Request-based, `us-central1`:

| Resource | Free / month | Then |
| --- | --- | --- |
| vCPU-seconds | 180,000 | $0.000024 / vCPU-s |
| GiB-seconds | 360,000 | $0.0000025 / GiB-s |
| Requests | 2 million | $0.40 / million |

Min instances are 0. A 2-minute 1-vCPU / 2Gi transcode is about $0.003 before free tier. Light and modest use stay inside the free tier unless someone sets `min-instances >= 1` (that would bill 24/7).

### Cloud Storage

Source: [Cloud Storage pricing](https://cloud.google.com/storage/pricing).

- Standard `us-central1`: $0.000027397 / GiB-hour ≈ **$0.020 / GiB-month**
- Always Free (us-central1 / us-east1 / us-west1 combined): **5 GB-months**, 5,000 Class A, 50,000 Class B, 100 GB North America data transfer
- Current footprint (a handful of raw + processed objects plus Functions source) should sit at or under Always Free unless raw uploads grow without lifecycle rules

Internet egress for **public** processed videos is the storage wildcard. `makePublic()` means every watch is GCS egress, not Cloud Run. $0.12/GiB-class after Always Free. Still small at classroom scale; not small if a public link is shared widely.

### Pub/Sub

Source: [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing). First **10 GiB / month** message-delivery throughput free, then $40 / TiB. Notification JSON is tiny. Treat as $0.

### Firestore

Source: [Firestore pricing](https://cloud.google.com/firestore/pricing). Default DB free quota: 1 GiB stored, 50k reads / 20k writes / 20k deletes per day. Beyond that in `us-central1`: $0.03 / 100k reads, $0.09 / 100k writes, ~$0.15 / GiB-month. Metadata for videos/transcripts/notes stays in the free quota at this scale.

### Cloud Build

Source: [Cloud Build pricing](https://cloud.google.com/build/pricing).

- 2,500 free minutes / month apply to **`e2-standard-2` ($0.006/min) only**
- Both triggers set `machineType: N1_HIGHCPU_8`, priced as **e2-highcpu-8: $0.0156 / min**
- Those minutes **do not** consume the e2-standard-2 free pool

A typical pair of `main` builds (worker + Next.js) at ~10–15 minutes each: about **$0.30–$0.50 per push**. Twenty pushes / month: **~$6–10**. This is the largest *current* line item that is not optional, and it is still small.

### Artifact Registry

Source: [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing). First 0.5 GiB free; then ~$0.10 / GiB-month. Two image repos, a few tagged revisions: likely **$0–2 / month**.

### Other small SKUs after Sprint 2

Cloud Scheduler: 3 jobs free, then $0.10 / job / month. One sweeper job is free. Speech + Vertex usage is billed on those products, not on Scheduler.

## 5. Monthly burn scenarios

Assumptions: `us-central1`, `DYNAMIC_BATCHING` on, Gemini 2.5 Flash (or AI Studio free for Gemini), Cloud Run min-instances 0, no Vector Search / RagManagedDb unless stated. Credits expire on the offer clock (12 months on the public Start page; 2 years if the YC letter says so).

### (a) Light development

A few short uploads a week, a couple of hours of test audio a month, notes/chat only while iterating, no managed vector store.

| Line | Estimate |
| --- | --- |
| Cloud Build (`N1_HIGHCPU_8`) | $4–10 |
| Speech-to-Text v2 dynamic (~2 h) | ~$0.40 |
| Cloud Run + Functions | $0 (free tier) |
| GCS + Firestore + Pub/Sub + Artifact Registry | $0–2 |
| Gemini (AI Studio free, or a few Vertex calls) | $0–1 |
| **Total** | **about $5–15 / month** |

$2,000 at $10 / month is 200 months. **The credits expire long before they run out.** If the public 12-month term applies, they last the full year with most of the balance unused.

### (b) Modest real usage, still no managed vector store

~40 lecture-hours of audio / month, notes on each, ~200 grounded chat turns, some public playback, weekly deploys.

| Line | Estimate |
| --- | --- |
| Speech-to-Text v2 dynamic (40 h) | **$7.20** (would be **$38** without `DYNAMIC_BATCHING`) |
| Gemini Flash notes + chat | $1–3 (or $0 on AI Studio free, if rate limits hold) |
| Cloud Build | $5–10 |
| Cloud Run (transcode 40 videos) | still near free tier; maybe $1–5 if jobs are long |
| GCS storage | $0–2 (Always Free 5 GB); more if raw files pile up |
| GCS egress (public watches) | $0–10 depending on sharing |
| Firestore / Pub/Sub / Artifact Registry | $0–2 |
| **Total** | **about $15–35 / month** |

$2,000 lasts **~5–10 years** of this burn, again capped by credit expiry (12 or 24 months).

### (b′) Same modest usage, Sprint 4 defaults left on

| Addition | Standing cost |
| --- | --- |
| Vector Search, 1× `e2-standard-2` | **~$68 / month** idle or busy |
| **or** RAG `RagManagedDb` Basic (100 PU Enterprise) | **~$90 / month** idle or busy |
| RAG Scaled (1 node) | **~$900 / month** |

Modest + Vector Search ≈ **$85–110 / month** → $2,000 lasts **~18–24 months**.
Modest + RagManagedDb Basic ≈ **$105–125 / month** → $2,000 lasts **~16–19 months**.
Modest + Scaled RAG ≈ **$920+ / month** → $2,000 lasts **about two months**.

## 6. What $2,000 would cover

Covered (Google Cloud SKUs): Speech-to-Text, Vertex Gemini, Vector Search, RAG-backed Spanner, Cloud Run, Cloud Storage, Pub/Sub, Firestore, Cloud Build, Artifact Registry, Cloud Scheduler, Firebase (as GCP).

Not covered (per public Start-tier notes): third-party Marketplace models; Workspace is a separate 12-month perk; AI Studio free tier is not drawn from the $2,000.

At light-dev or modest-without-vector-store burn, **$2,000 more than covers the GCP bill for the life of the credit.** The credit is not the scarce resource; **not leaving a vector index deployed** is.

## 7. Biggest cost driver

| Phase | Biggest driver |
| --- | --- |
| Today (Sprint 1 only) | Cloud Build `N1_HIGHCPU_8` (~$5–10/month if `main` is busy) |
| Sprint 2–3, no vector store | Speech-to-Text if volume grows; still Cloud Build if it does not. Speech is $0.18/hour with dynamic batch, $0.96/hour without. |
| Sprint 4+ if a managed vector store is left running | **That store.** It outruns Speech and Gemini combined at this scale. |

## 8. Pricing traps

1. **Vector Search and `RagManagedDb` bill hourly whether or not anyone chats.** This is the trap that can spend the whole $2,000. Undeploy / unprovision when not in use.
2. **RAG Scaled tier is a 1-node Spanner Enterprise instance (~$900/month),** not a serverless upgrade.
3. **`DYNAMIC_BATCHING` off** multiplies Speech by ~5×. The design turns it on; a “just use standard so it is faster” change is a bill.
4. **Official v2 Speech has no listed free 60 minutes.** Budget from minute one.
5. **Normalized transcripts written under `raw/`** retrigger Speech forever. The prefix filter exists to prevent this.
6. **Pub/Sub redelivery can start a second Speech job** if the Firestore claim is not atomic. That is a duplicate bill, not just a duplicate doc.
7. **Cloud Build `N1_HIGHCPU_8` is not on the 2,500-minute free SKU.** Switching the YAML to `e2-standard-2` would actually use the free tier (slower builds).
8. **`min-instances > 0`** on Cloud Run turns a free-tier service into a 24/7 VM.
9. **`makePublic()` video egress** is uncapped if a URL leaks.
10. **Raw bucket has no lifecycle expiry.** Storage grows forever; cheap per GB, easy to forget.
11. **AI Studio free tier is not a data-privacy tier.** Fine for the developer's own test clips; a poor default for student uploads.
12. **Credit clocks.** Public Start-tier text says 12 months. The YC blurb said 2 years. Unused balance dies at whichever date is real.

## 9. How to see what this document cannot

In Cloud Console, project `yt-clone-385f4`:

1. **Billing → Credits** — trial / promo remaining, expiry, “beyond free trial” history
2. **Billing → Reports** — last 30/90 days by SKU (this is the actual burn, not the envelope above)
3. **Billing → Budgets** — none visible via CLI; creating one is the cheapest safety control and is out of scope for this write-up

Judge Start-tier eligibility from those screens plus the company facts. The CLI view is only: billing is enabled, account `010854-8E7797-87BB7F` (`My Billing Account`) is open, and credit balances are not exposed.
