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

## Video ID Strategy

- **Current:** The full filename is used as the video ID, so the watch page can render the video directly.
- **Tradeoff:** Filenames can be long and unwieldy; exposes internal structure.
- **Potential Solution:**
  - Use a short, unique `videoId` (e.g., UUID or Firestore doc ID) and map it to the filename in Firestore. This requires more work but is more robust.
