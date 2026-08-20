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

- **Current:** the repo has **no Firestore security rules**. Processed playback objects are `makePublic()`. Owner-only rules and signed video URLs are a planned security pass, not done.
- **Tradeoff:** that gap is already real for video metadata. Extracted lecture frames (specified, not built) are a different risk class than transcripts: images of course material, potentially copyrighted, potentially containing other students’ faces. A leaked frame URL is a still of the lecture.
- **Potential Solutions:** ship owner-only Firestore rules and non-public frame objects **before** storing frames. See the privacy finding in [`docs/features/multimodal-lecture-content.md`](features/multimodal-lecture-content.md).

## Video ID/Processing Strategy

- **Current:** The full filename is used as the video ID, so the watch page can render the video directly.
- **Tradeoff:** Filenames can be long and unwieldy; exposes internal structure.
- **Potential Solution:**
  - Use a short, unique `videoId` (e.g., UUID or Firestore doc ID) and map it to the filename in Firestore. This requires more work but is more robust.
- When we are processing a video, we don't handle that in our web client and still show a thumbnail. 

## Continuous Deployment 

✅ **Complete!** Cloud Build CI/CD is now active.

- Two triggers created: `video-processing-service` and `web-client`
- Both trigger on push to `main` branch
- Automatic build, push to Artifact Registry, and deploy to Cloud Run
- Services deployed:
  - `video-processing-service` → Cloud Run service `video-processing-service`
  - `web-client` → Cloud Run service `cloudscribe-ai`
- Monitor builds: https://console.cloud.google.com/cloud-build/builds?project=yt-clone-385f4 

