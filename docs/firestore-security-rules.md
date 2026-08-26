# Firestore Security Rules

## Ownership model

| Path | Owner field | Written by |
| --- | --- | --- |
| `videos/{videoId}` | `uid` | `video-processing-service` (Admin SDK) |
| `videos/{videoId}/transcripts/{transcriptId}` | `userId` (optional on early failure docs) | `video-processing-service` (Admin SDK) |
| `users/{uid}` | document id | `createUser` Cloud Function (Admin SDK) |

Video ids follow `{uid}-{epoch_ms}` (see `uidFromVideoId` in the worker).

## Client vs Admin access

**Admin SDK (bypasses rules):**

- `video-processing-service` — create/update videos and transcripts
- Cloud Functions — `createUser`, `getVideos`, `generateUploadUrl`, `getUploadUrl`, `getTranscriptUrl`

**Client SDK (subject to rules):**

- `yt-web-client/app/watch/page.tsx` — `onSnapshot` on `videos/{videoId}` and a query on `videos/{videoId}/transcripts` with `orderBy("createdAt", "desc")`, `limit(1)`
- No client writes

## Rule design notes

- Default deny for all paths.
- Transcript reads use a parent-video `get()` so the watch-page query (no `userId` filter) is allowed for owners without requiring a composite index on `userId`.
- All writes denied for clients; pipeline and Functions use Admin SDK.

## Deploy

From `api-service/`:

```bash
firebase deploy --only firestore:rules --project yt-clone-385f4
```

## Emulator tests

Rules unit tests require Java (Firestore emulator). If Java is unavailable, validate by reasoning through access paths and verify live after deploy. See `docs/smoke-test-guide.md` for end-to-end pipeline checks.

## Remaining exposure (out of scope for this change)

- Processed videos remain world-readable via GCS `makePublic()`.
- `getVideos` returns the latest 10 videos to any authenticated caller (function-level auth only).
- Browser API key has no referrer restrictions.
