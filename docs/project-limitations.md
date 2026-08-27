# Project Limitations & Tradeoffs

## Pub/Sub Processing & Acknowledgement

- **Current:** Pub/Sub expects an HTTP ack within 600s (10 min). If Cloud Run takes longer, the HTTP connection closes, but Cloud Run may still write to Firestore and Storage.
- **Tradeoff:** If processing exceeds 10 min, Pub/Sub will retry the message. This can cause duplicate processing and inconsistent Firestore state.
- **Potential Solutions:**
  - Switch to a **pull subscription** so Cloud Run can ack after processing (more control, but more infra to manage).
  - Use a **dead letter topic** for messages that fail repeatedly.
  - Ensure that if Cloud Run fails to process a video, it sets Firestore status to `undefined` so retries are not ignored.

## Video Streaming Scalability

- **Current:** Videos are served from a single GCS bucket in `us-central1`.
- **Limitation:** No adaptive streaming (HLS/DASH), no CDN, so global users may experience slow playback.
- **Potential Solutions:**
  - Use adaptive streaming (HLS/DASH) for better playback on all devices.
  - Integrate with a CDN (Cloud CDN, CloudFront, etc.) for global delivery.
  - Cloud Run has a 60 min max request duration; for very large videos, consider batch processing or chunked uploads.

## Type Safety & Interface Duplication

- **Current:** The `Video` interface is copy-pasted in multiple places (functions.ts, backend, frontend).
- **Tradeoff:** This can lead to type drift and bugs.
- **Potential Solution:**
  - Use a shared types package (e.g., `utils/types/video.ts`) and import it everywhere (backend, frontend, functions) for end-to-end type safety.

## Processed Video Quality, Raw Retention, And OCR

- **Current:** `convertVideo` no longer applies `-vf scale=-1:360`. Sprint 2 dropped the downscale so the processed object (and the FLAC extracted from it) keep source resolution. Raw objects in `atmuri-yt-raw-videos` are also never deleted; `deleteRawVideo` only removes the local temp copy.
- **Tradeoff:** Processed videos and raw originals consume more storage than a 360p pipeline with raw expiry.
- **Constraint (load-bearing for OCR):** original resolution is required for usable OCR on slides, diagrams, and equations. OCR on 360p slides is poor; subscripts and exponents become unreadable. If anyone later reintroduces downscaling to reduce egress, OCR quality degrades **silently** — the visual pipeline will still report success. This coupling is part of the lecture-content design ([`docs/features/multimodal-lecture-content.md`](features/multimodal-lecture-content.md)); keep it visible from the transcode side too.
- **Potential Solutions (watch path only, not OCR):**
  - Add a **separate** watch rendition if product wants 360p playback, and keep a full-resolution object for visual analysis. Do not reuse a downscaled watch file as the OCR source.
  - Add lifecycle expiry on the raw bucket (tracked for the security-hardening pass).

## Firestore Rules And Frame Privacy

- **Current:** owner-only Firestore security rules are deployed from [`api-service/firestore.rules`](../api-service/firestore.rules). Client SDK reads are limited to the signed-in user's own `videos/{videoId}` documents and that video's `transcripts` subcollection; all client writes are denied (Admin SDK writes bypass rules). Processed playback objects are still `makePublic()`. Signed video URLs are a planned follow-up on the same security branch. `atmuri-yt-raw-videos` and `atmuri-yt-processed-videos` do **not** have uniform bucket-level access, which is why `makePublic()` on processed videos works today.
- **Decided (parallel tracks):** frame extraction may proceed while signed video URLs are still in flight. Frames are never publicly readable. Any frames bucket **must** be created with uniform bucket-level access — the same flag used for `atmuri-yt-transcripts` and `atmuri-yt-audio-work` in [`scripts/setup-transcription-infra.sh`](../scripts/setup-transcription-infra.sh) — so per-object ACLs are unavailable and `makePublic()` **fails** rather than silently succeeding. That requirement is a precondition of storing the first frame, not a follow-up. Frames are served only through short-lived signed URLs, following the transcript pattern.
- **Residual risk:** uniform access on future frame buckets solves object privacy for frames. Document-level privacy for videos and transcripts is now enforced by Firestore rules; processed **video files** and the browser API key remain separate items on the security branch.
- **Tradeoff:** extracted lecture frames (specified, not built) are a different risk class than transcripts: images of course material, potentially copyrighted, potentially containing other students’ faces. A leaked frame URL is a still of the lecture. A leaked Firestore path is still a leak of what was stored, even if the JPEG itself is private.
- **Potential Solutions:** keep the frames bucket on uniform access from birth; ship signed video URLs and API-key referrer restrictions on the security branch without blocking step-3 frame storage. See the privacy finding in [`docs/features/multimodal-lecture-content.md`](features/multimodal-lecture-content.md).

## Video ID/Processing Strategy

- **Current:** The full filename is used as the video ID, so the watch page can render the video directly.
- **Tradeoff:** Filenames can be long and unwieldy; exposes internal structure.
- **Potential Solution:**
  - Use a short, unique `videoId` (e.g., UUID or Firestore doc ID) and map it to the filename in Firestore. This requires more work but is more robust.
- When we are processing a video, we don't handle that in our web client and still show a thumbnail.

## Home Page Listing

- **`createdAt` is load-bearing, not decorative.** The home page orders by it, and
  Firestore omits documents that are missing the ordered field entirely, so a video
  without `createdAt` is *invisible* rather than merely unsorted. Two writers keep this
  invariant: the `finalizeUpload` callable sets it at upload time, and
  `setVideoEnsuringCreatedAt` in the worker backfills it if that call was lost. Both
  derive the value from the `{uid}-{epochMillis}` video id, so they agree regardless of
  which one writes first. `scripts/backfill-video-created-at.sh` repaired the documents
  that predated this.
- **Query requires a composite index:** `videos(uid ASC, createdAt DESC)`, declared in
  `api-service/firestore.indexes.json`. Deploy the index before the query, or every
  home page load fails with `FAILED_PRECONDITION`.
- **Pagination is opt-in on the wire.** `getVideos` returns the legacy bare array unless
  the caller passes `paged: true`. Functions and the web client deploy on separate Cloud
  Build triggers, so this keeps an already-deployed browser bundle working during the
  minutes between the two deploys. The legacy branch can be deleted once no old bundle
  is live.
- **Titles are captured after the bytes land**, not when the signed URL is issued.
  Writing metadata at signed-URL time would leave a phantom document behind every
  abandoned upload. Consequence: if the tab closes between the upload completing and
  `finalizeUpload` returning, the video still processes but keeps its filename-derived
  display name.
- **`finalizeUpload` must not write `status`.** The worker's idempotency guard
  (`isVideoNew`) treats a missing status as "not yet processed"; setting a status at
  upload time would make the worker skip transcoding for every upload.

## Continuous Deployment 

✅ **Complete!** Cloud Build CI/CD is now active.

- Three triggers created: `video-processing-service`, `web-client`, and `api-service` (Functions)
- All three trigger on push to `main` branch (`api-service` only when `api-service/**` changes)
- Cloud Run services: automatic Docker build → Artifact Registry → `gcloud run deploy`
- Functions: `firebase deploy --only functions` (predeploy lint + build; rules/indexes excluded)
- Services deployed:
  - `video-processing-service` → Cloud Run service `video-processing-service`
  - `web-client` → Cloud Run service `cloudscribe-ai`
  - `api-service` → Firebase Cloud Functions (gen2)
- Monitor builds: https://console.cloud.google.com/cloud-build/builds?project=yt-clone-385f4 

