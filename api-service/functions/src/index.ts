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
import {Firestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import {Storage} from "@google-cloud/storage";
import {onCall, onRequest} from "firebase-functions/v2/https";
import cors from "cors";

initializeApp();

const firestore = new Firestore();
const adminAuth = getAuth();

const videoCollectionId = "videos";
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
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

interface TranscriptDoc {
  status?: "pending" | "running" | "failed" | "done" | "needs_review";
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

    const fileName = `${auth.uid}-${Date.now()}.${data.fileExtension}`;
    const [url] = await bucket.file(fileName).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return {url, fileName};
  },
);

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

        const fileName = `${decodedToken.uid}-${Date.now()}.${fileExtension}`;
        const bucket = storage.bucket(rawVideoBucketName);

        const [url] = await bucket.file(fileName).getSignedUrl({
          version: "v4",
          action: "write",
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        });

        response.status(200).send({url, fileName});
      } catch (error) {
        console.error("Error generating upload URL:", error);
        response.status(500).send({error: "Failed to generate upload URL"});
      }
    });
  },
);

// TODO fix: naive endpoint to getVideos because no pagination / hardcoded
// limit, and not checking if there are even videos
export const getVideos = onCall({maxInstances: 1}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "The function must be called while authenticated.",
    );
  }
  const querySnapshot = await firestore
    .collection(videoCollectionId)
    .limit(10)
    .get();
  return querySnapshot.docs.map((doc) => doc.data());
});

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
