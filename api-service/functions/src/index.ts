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
import {Firestore, FieldValue} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import {Storage} from "@google-cloud/storage";
import {onCall, onRequest} from "firebase-functions/v2/https";
import cors from "cors";

initializeApp();

const firestore = new Firestore();
const adminAuth = getAuth();

const videoCollectionId = "videos";
const userCollectionId = "users";
const userSettingsCollectionId = "settings";
const userPreferencesDocId = "preferences";
export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

interface TranscriptDoc {
  status?: "pending" | "running" | "failed" | "done";
  gcsPath?: string;
  language?: string;
  model?: string;
  segmentCount?: number;
  durationSeconds?: number;
}

interface NoteDoc {
  status?: "pending" | "running" | "failed" | "done";
  gcsPath?: string;
  promptVersion?: string;
}

interface UserSettingsDoc {
  notesEnabled?: boolean;
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

    const videoSnapshot = await fetchOwnedVideo(videoId, request.auth.uid);

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
 * Returns a signed URL for a generated notes artifact when the caller owns the video.
 */
export const getNotesUrl = onCall({maxInstances: 1}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Authentication required",
    );
  }
  const {videoId, noteId} = request.data ?? {};
  if (!videoId || !noteId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "videoId and noteId are required",
    );
  }
  const videoSnapshot = await fetchOwnedVideo(videoId, request.auth.uid);
  const noteSnapshot = await videoSnapshot.ref.collection("notes").doc(noteId).get();
  if (!noteSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Notes not found");
  }
  const note = noteSnapshot.data() as NoteDoc;
  if (note.status !== "done" || !note.gcsPath) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Notes not ready",
    );
  }
  const gcsParts = parseGcsUri(note.gcsPath);
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
    noteId,
    promptVersion: note.promptVersion ?? "unknown",
  };
});

/**
 * Reads the caller's notes feature flag preference.
 */
export const getNotesFeatureFlag = onCall({maxInstances: 1}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Authentication required",
    );
  }
  const snapshot = await userSettingsRef(request.auth.uid).get();
  const settings = snapshot.data() as UserSettingsDoc | undefined;
  return {notesEnabled: settings?.notesEnabled ?? true};
});

/**
 * Updates the caller's notes feature flag preference.
 */
export const setNotesFeatureFlag = onCall({maxInstances: 1}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Authentication required",
    );
  }
  const {enabled} = request.data ?? {};
  if (typeof enabled !== "boolean") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "enabled boolean is required",
    );
  }
  await userSettingsRef(request.auth.uid).set(
    {
      notesEnabled: enabled,
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
  return {notesEnabled: enabled};
});

function parseGcsUri(uri: string): {bucket: string; path: string} {
  if (!uri.startsWith("gs://")) {
    throw new Error("Invalid GCS URI");
  }
  const [, bucketAndPath] = uri.split("gs://");
  const [bucket, ...pathParts] = bucketAndPath.split("/");
  return {
    bucket,
    path: pathParts.join("/"),
  };
}

/**
 * Retrieves a video document and enforces caller ownership.
 * @param videoId Video identifier.
 * @param uid Authenticated user identifier.
 * @returns Snapshot of the requested video document.
 */
async function fetchOwnedVideo(
  videoId: string,
  uid: string,
): Promise<FirebaseFirestore.DocumentSnapshot> {
  const videoSnapshot = await firestore
    .collection(videoCollectionId)
    .doc(videoId)
    .get();
  if (!videoSnapshot.exists) {
    throw new functions.https.HttpsError("not-found", "Video not found");
  }
  const videoData = videoSnapshot.data() as Video;
  if (videoData.uid !== uid) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "You do not have access to this resource",
    );
  }
  return videoSnapshot;
}

/**
 * Resolves the Firestore document storing a user's preferences.
 * @param uid Authenticated user identifier.
 * @returns Reference to the preferences document.
 */
function userSettingsRef(uid: string) {
  return firestore
    .collection(userCollectionId)
    .doc(uid)
    .collection(userSettingsCollectionId)
    .doc(userPreferencesDocId);
}
