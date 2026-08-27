/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from "firebase-functions/v1";
import {initializeApp} from "firebase-admin/app";
import {FieldPath, Firestore, Timestamp} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import {Storage} from "@google-cloud/storage";
import {onCall, onRequest} from "firebase-functions/v2/https";
import cors from "cors";

initializeApp();

const firestore = new Firestore();
const adminAuth = getAuth();

const videoCollectionId = "videos";
const MAX_TITLE_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
const transcriptsBucketName =
  process.env.TRANSCRIPTS_BUCKET_NAME ?? "atmuri-yt-transcripts";
// Must match video-processing-service NORMALIZED_TRANSCRIPT_PREFIX.
const normalizedTranscriptPrefix = (
  process.env.NORMALIZED_TRANSCRIPT_PREFIX ?? "normalized"
).replace(/^\/+|\/+$/g, "");

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed" | "failed";
  title?: string;
  description?: string;
  /**
   * Upload time, and the home page sort key. Every video document must have
   * this: `orderBy("createdAt")` silently omits documents missing the field,
   * so a video without it is invisible rather than merely unsorted.
   * Written by `finalizeUpload`, with the worker backfilling it if the client
   * never got to finalize.
   */
  createdAt?: Timestamp;
}

interface TranscriptDoc {
  status?:
    | "pending"
    | "running"
    | "failed"
    | "done"
    | "needs_review"
    | "no_audio_detected";
  source?: "batch" | "live";
  gcsPath?: string;
  language?: string;
  model?: string;
  segmentCount?: number;
  durationSeconds?: number;
}

export const createUser = functions.auth.user().onCreate((user) => {
  const userInfo = {
    uid: user.uid,
    email: user.email,
    photoUrl: user.photoURL,
  };

  firestore.collection("users").doc(user.uid).set(userInfo);
  logger.info(`User Created: ${JSON.stringify(userInfo)}`);
  return;
});

const storage = new Storage();
const rawVideoBucketName =
  process.env.RAW_VIDEO_BUCKET_NAME ?? "atmuri-yt-raw-videos";

// Set up CORS middleware with appropriate options
const corsHandler = cors({
  origin: true, // Reflects the request origin
  methods: ["GET", "POST"],
  credentials: true,
  maxAge: 3600,
});

// Keep the callable function for direct Firebase SDK use
export const generateUploadUrl = onCall(
  {maxInstances: 1},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The function must be called while authenticated.",
      );
    }
    const auth = request.auth;
    const data = request.data;
    const bucket = storage.bucket(rawVideoBucketName);

    const videoId = `${auth.uid}-${Date.now()}`;
    const fileName = `${videoId}.${data.fileExtension}`;
    const [url] = await bucket.file(fileName).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    // videoId is returned so the client can call finalizeUpload without
    // re-deriving it from fileName.
    return {url, fileName, videoId};
  },
);

/**
 * Records the caller-supplied title and the upload time once the bytes have
 * actually landed in GCS.
 *
 * Deliberately called *after* the upload rather than folded into
 * generateUploadUrl: writing metadata at signed-URL time would leave a
 * permanent phantom document behind every abandoned upload, which is exactly
 * the orphan-metadata class we had to clean up by hand. Nothing is written
 * until there are bytes to describe.
 *
 * Merges rather than overwrites, so it does not race the worker: whichever of
 * the two writes lands second only fills in the fields the other left alone.
 * @param {object} request Callable request with videoId and optional title.
 * @return {Promise<object>} The stored videoId and title.
 */
export const finalizeUpload = onCall({maxInstances: 1}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The function must be called while authenticated.",
    );
  }

  const uid = request.auth.uid;
  const {videoId, title} = request.data ?? {};
  const uploadedAtMillis = parseOwnedVideoId(videoId, uid);
  const cleanTitle = normalizeTitle(title);

  // Owning the id is not the same as having uploaded anything. Without this
  // check a caller could mint metadata for a video that does not exist, which
  // would sit at the top of their listing as a permanently "Queued" card
  // linking to an unplayable watch page. Failing here is also the safe
  // direction: the client treats a finalize failure as non-fatal, so a real
  // upload loses only its title, never the video.
  await assertRawObjectExists(videoId as string);

  await firestore
    .collection(videoCollectionId)
    .doc(videoId as string)
    .set(
      {
        uid,
        id: videoId,
        // Deliberately does NOT write `status`. The worker's idempotency guard
        // treats a missing status as "not yet processed", so setting one here
        // would make it skip transcoding for every upload.
        createdAt: Timestamp.fromMillis(uploadedAtMillis),
        ...(cleanTitle ? {title: cleanTitle} : {}),
      },
      {merge: true},
    );

  logger.info("Finalized upload metadata", {videoId, hasTitle: !!cleanTitle});
  return {videoId, title: cleanTitle ?? null};
});

/**
 * Validates that the caller owns this videoId and returns its embedded upload
 * time in epoch millis.
 *
 * Uploads are named `{uid}-{epochMillis}`, so ownership is the uid prefix.
 * Checking the prefix explicitly (rather than splitting on "-") keeps
 * hyphenated uids correct and stops a caller from writing metadata onto
 * someone else's video.
 *
 * The embedded timestamp is used as `createdAt` rather than the wall clock so
 * that the worker and this callable derive the identical value and neither
 * needs to care which of them writes first.
 * @param {unknown} videoId Candidate video identifier from the request.
 * @param {string} uid Authenticated caller uid.
 * @return {number} Upload time in epoch millis.
 */
function parseOwnedVideoId(videoId: unknown, uid: string): number {
  if (typeof videoId !== "string" || !videoId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "videoId is required",
    );
  }
  const prefix = `${uid}-`;
  if (!videoId.startsWith(prefix)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "You do not own this video",
    );
  }
  const suffix = videoId.slice(prefix.length);
  if (!/^\d{10,}$/.test(suffix)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Malformed videoId",
    );
  }
  const millis = Number(suffix);
  // Reject implausible timestamps so a hand-made id cannot pin a video to the
  // top of the list forever.
  if (
    !Number.isSafeInteger(millis) ||
    millis < Date.UTC(2015, 0, 1) ||
    millis > Date.now() + 24 * 60 * 60 * 1000
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Malformed videoId",
    );
  }
  return millis;
}

/**
 * Confirms a raw upload actually landed for this videoId.
 *
 * The uploaded object is `{videoId}.{ext}` and the extension is chosen by the
 * client, so this matches on the `{videoId}.` prefix rather than a known name.
 * @param {string} videoId Caller-owned video identifier.
 */
async function assertRawObjectExists(videoId: string): Promise<void> {
  const [files] = await storage.bucket(rawVideoBucketName).getFiles({
    prefix: `${videoId}.`,
    maxResults: 1,
  });
  if (files.length === 0) {
    throw new functions.https.HttpsError(
      "not-found",
      "No uploaded video found for this id",
    );
  }
}

/**
 * Trims a user-supplied title and drops control characters that would corrupt
 * log lines or render as gibberish. Returns undefined for absent or
 * whitespace-only input so the caller can fall back to the filename.
 * @param {unknown} title Raw title from the request.
 * @return {string | undefined} Display-safe title, or undefined.
 */
function normalizeTitle(title: unknown): string | undefined {
  if (typeof title !== "string") {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const stripped = title.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!stripped) {
    return undefined;
  }
  if (stripped.length > MAX_TITLE_LENGTH) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Title must be ${MAX_TITLE_LENGTH} characters or fewer`,
    );
  }
  return stripped;
}

// Add an HTTP endpoint for REST API access
export const getUploadUrl = onRequest(
  {maxInstances: 1},
  (request, response) => {
    // Apply CORS middleware
    corsHandler(request, response, async () => {
      try {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          response.status(401).send({error: "Missing bearer token"});
          return;
        }

        const idToken = authHeader.split("Bearer ")[1];
        let decodedToken;
        try {
          decodedToken = await adminAuth.verifyIdToken(idToken);
        } catch (verifyError) {
          logger.error("Invalid ID token for upload URL request", verifyError);
          response.status(401).send({error: "Invalid token"});
          return;
        }

        const fileExtension =
          (request.query.extension as string) ||
          request.body?.fileExtension ||
          "mp4";

        const videoId = `${decodedToken.uid}-${Date.now()}`;
        const fileName = `${videoId}.${fileExtension}`;
        const bucket = storage.bucket(rawVideoBucketName);

        const [url] = await bucket.file(fileName).getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

        response.status(200).send({url, fileName, videoId});
      } catch (error) {
        console.error("Error generating upload URL:", error);
        response.status(500).send({error: "Failed to generate upload URL"});
      }
    });
  },
);

/**
 * Returns one page of the caller's videos, newest first.
 *
 * Requires the composite index videos(uid ASC, createdAt DESC); see
 * firestore.indexes.json. Deploy the index before this query goes live or
 * every call fails with FAILED_PRECONDITION.
 *
 * Pagination is opt-in via `paged: true`. Functions and the web client deploy
 * on separate Cloud Build triggers, so for a few minutes after a release the
 * already-deployed browser bundle may be calling this. That older bundle does
 * `data.map(...)` on the response, and would render an empty page against the
 * paginated object. Callers that do not opt in therefore keep the exact
 * previous behaviour. Remove the legacy branch once no old bundle is live.
 * @param {object} request Callable request with optional limit and cursor.
 * @return {Promise<object>} Page of videos, or a bare array for old clients.
 */
export const getVideos = onCall({maxInstances: 1}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The function must be called while authenticated.",
    );
  }

  if (request.data?.paged !== true) {
    const legacySnapshot = await firestore
      .collection(videoCollectionId)
      .where("uid", "==", request.auth.uid)
      .limit(10)
      .get();
    return legacySnapshot.docs.map((doc) => doc.data());
  }

  const pageSize = clampPageSize(request.data?.limit);

  let query = firestore
    .collection(videoCollectionId)
    .where("uid", "==", request.auth.uid)
    .orderBy("createdAt", "desc")
    // createdAt is millisecond-precision, so two videos uploaded in the same
    // millisecond would otherwise have an arbitrary order and could repeat or
    // vanish across page boundaries. The document id breaks the tie.
    .orderBy(FieldPath.documentId(), "desc");

  const cursor = decodeCursor(request.data?.cursor);
  if (cursor) {
    query = query.startAfter(
      Timestamp.fromMillis(cursor.createdAtMillis),
      cursor.id,
    );
  }

  // Over-fetch by one to learn whether another page exists without paying for
  // a separate count query.
  const snapshot = await query.limit(pageSize + 1).get();
  const hasMore = snapshot.docs.length > pageSize;
  const pageDocs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

  const videos = pageDocs.map((doc) => ({
    ...(doc.data() as Video),
    id: doc.id,
  }));

  const lastDoc = pageDocs[pageDocs.length - 1];
  const nextCursor =
    hasMore && lastDoc ?
      encodeCursor(lastDoc.id, lastDoc.get("createdAt")) :
      null;

  return {videos, nextCursor, hasMore};
});

interface VideoCursor {
  createdAtMillis: number;
  id: string;
}

/**
 * Clamps a caller-supplied page size into a sane range so a client cannot ask
 * for the entire collection in one call.
 * @param {unknown} value Requested page size.
 * @return {number} Page size to use.
 */
function clampPageSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

/**
 * Encodes the sort position of the last returned document. Opaque to the
 * client so the cursor format stays free to change.
 * @param {string} id Document id of the last returned video.
 * @param {unknown} createdAt The document's createdAt value.
 * @return {string | null} Base64url cursor, or null if unorderable.
 */
function encodeCursor(id: string, createdAt: unknown): string | null {
  const millis =
    createdAt instanceof Timestamp ? createdAt.toMillis() : undefined;
  if (millis === undefined) {
    return null;
  }
  return Buffer.from(JSON.stringify({t: millis, i: id})).toString("base64url");
}

/**
 * Decodes a cursor produced by encodeCursor. A malformed cursor is rejected
 * rather than ignored, because silently restarting from page one looks like an
 * infinite list to a "load more" button.
 * @param {unknown} value Cursor from the request.
 * @return {VideoCursor | undefined} Parsed cursor, or undefined if absent.
 */
function decodeCursor(value: unknown): VideoCursor | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Invalid cursor");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed?.t !== "number" ||
      !Number.isFinite(parsed.t) ||
      typeof parsed?.i !== "string" ||
      !parsed.i
    ) {
      throw new Error("cursor shape");
    }
    return {createdAtMillis: parsed.t, id: parsed.i};
  } catch {
    throw new functions.https.HttpsError("invalid-argument", "Invalid cursor");
  }
}

/**
 * Returns a short-lived signed URL for a caller-owned transcript object.
 * @param {object} request Callable request with videoId and transcriptId.
 * @return {Promise<object>} Signed URL and transcript metadata.
 */
export const getTranscriptUrl = onCall(
  {maxInstances: 1},
  async (request) => {
    if (!request.auth) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Authentication required",
      );
    }

    const {videoId, transcriptId = "primary"} = request.data ?? {};
    if (!videoId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "videoId is required",
      );
    }

    const videoSnapshot = await firestore
      .collection(videoCollectionId)
      .doc(videoId)
      .get();

    if (!videoSnapshot.exists) {
      throw new functions.https.HttpsError("not-found", "Video not found");
    }

    const videoData = videoSnapshot.data() as Video;
    if (videoData.uid !== request.auth.uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You do not have access to this transcript",
      );
    }

    const transcriptSnapshot = await videoSnapshot.ref
      .collection("transcripts")
      .doc(transcriptId)
      .get();

    if (!transcriptSnapshot.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Transcript metadata not found",
      );
    }

    const transcript = transcriptSnapshot.data() as TranscriptDoc;
    if (transcript.status === "no_audio_detected") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "No speech detected in this video",
      );
    }
    if (transcript.status !== "done" || !transcript.gcsPath) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Transcript not ready",
      );
    }

    const gcsParts = parseGcsUri(transcript.gcsPath);
    assertOwnedTranscriptUri(gcsParts, videoId);
    const [url] = await storage
      .bucket(gcsParts.bucket)
      .file(gcsParts.path)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000,
      });

    return {
      url,
      transcriptId,
      segmentCount: transcript.segmentCount ?? 0,
      durationSeconds: transcript.durationSeconds ?? 0,
      language: transcript.language,
      model: transcript.model,
    };
  },
);

/**
 * Parses a gs:// URI into bucket and object path.
 * @param {string} uri Absolute GCS URI.
 * @return {{bucket: string, path: string}} Bucket and path.
 */
function parseGcsUri(uri: string): {bucket: string; path: string} {
  if (!uri.startsWith("gs://")) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid GCS URI",
    );
  }
  const withoutScheme = uri.slice("gs://".length);
  const slash = withoutScheme.indexOf("/");
  if (slash <= 0 || slash === withoutScheme.length - 1) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid GCS URI",
    );
  }
  const bucket = withoutScheme.slice(0, slash);
  const objectPath = withoutScheme.slice(slash + 1);
  if (!bucket || !objectPath) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid GCS URI",
    );
  }
  return {bucket, path: objectPath};
}

/**
 * Ensures the signed object is in the transcripts bucket under this video.
 * Path prefix comes from NORMALIZED_TRANSCRIPT_PREFIX so it cannot drift
 * from the video-processing-service write path.
 * @param {{bucket: string, path: string}} parsed Parsed GCS URI.
 * @param {string} videoId Caller-owned video identifier.
 */
function assertOwnedTranscriptUri(
  parsed: {bucket: string; path: string},
  videoId: string,
): void {
  if (parsed.bucket !== transcriptsBucketName) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Transcript is not in the configured bucket",
    );
  }
  const allowedPrefix =
    `${normalizedTranscriptPrefix}/${videoId}/`;
  if (!parsed.path.startsWith(allowedPrefix)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Transcript path is not scoped to this video",
    );
  }
}
