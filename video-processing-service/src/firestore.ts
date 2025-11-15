import { credential } from "firebase-admin";
import { initializeApp } from "firebase-admin/app";
import {
  Firestore,
  Timestamp,
} from "firebase-admin/firestore";

initializeApp({ credential: credential.applicationDefault() });

const firestore = new Firestore(); // only one firestore instance per GCP app so unnecessary to specify

export function getFirestoreClient(): Firestore {
  return firestore;
}

// The code snippet below is for local development with the Firestore emulator using a local Firestore instance.
// Note: This requires setting an env variable in Cloud Run
/** if (process.env.NODE_ENV !== 'production') {
  firestore.settings({
      host: "localhost:8080", // Default port for Firestore emulator
      ssl: false
  });
} */

const videoCollectionId = "videos";
const transcriptCollectionId = "transcripts";

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed" | "failed"; // solves the bug with Pub/Sub redelivery if Cloud Run instance is still processing the video, we want idempotency and to avoid duplicates
  title?: string;
  description?: string;
}

export type TranscriptStatus = "pending" | "running" | "failed" | "done";

export interface TranscriptDocument {
  id?: string;
  videoId: string;
  status: TranscriptStatus;
  gcsPath?: string;
  segmentCount?: number;
  durationSeconds?: number;
  language: string;
  model: string;
  createdAt?: Timestamp;
  completedAt?: Timestamp;
  error?: string;
  operationName?: string;
  audioGcsUri?: string;
  userId?: string;
}

/**
 * Retrieves a video document from Firestore by its ID.
 * @param {string} videoId - The ID of the video document to retrieve.
 * @returns {Promise<Video>} A promise that resolves to the video data or an empty object if not found.
 */
async function getVideo(videoId: string) {
  const snapshot = await firestore
    .collection(videoCollectionId)
    .doc(videoId)
    .get();

  // we can't call the data of a snapshot that doesn't exist, so we await above check if it exists first
  return (snapshot.data() as Video) ?? {};

  // this promise: lets us asynchronously get the video data from Firestore while the rest of the code continues to execute, promising to return the video data when it's ready
}

/**
 * Updates or creates a video document in Firestore.
 * @param {string} videoId - The ID of the video document to update or create.
 * @param {Video} video - The video data to set in Firestore.
 * @returns {Promise<FirebaseFirestore.WriteResult>} A promise that resolves when the operation is complete.
 */
export function setVideo(videoId: string, video: Video) {
  return firestore
    .collection(videoCollectionId)
    .doc(videoId)
    .set(video, { merge: true }); // merge: true allows us to update only specific fields without overwriting the entire document
}

/**
 * Checks if a video is new by verifying its status in Firestore.
 * @param {string} videoId - The ID of the video document to check.
 * @returns {Promise<boolean>} A promise that resolves to true if the video is new, false otherwise.
 */
export async function isVideoNew(videoId: string) {
  const video = await getVideo(videoId);
  return video?.status === undefined;
}

function transcriptCollection(videoId: string) {
  return firestore
    .collection(videoCollectionId)
    .doc(videoId)
    .collection(transcriptCollectionId);
}

export function transcriptRef(videoId: string, transcriptId: string) {
  return transcriptCollection(videoId).doc(transcriptId);
}

export async function createTranscript(
  videoId: string,
  transcriptId: string,
  payload: Omit<TranscriptDocument, "id" | "videoId">,
) {
  await transcriptRef(videoId, transcriptId).set(
    {
      ...payload,
      videoId,
      createdAt: payload.createdAt ?? Timestamp.now(),
    },
    { merge: true },
  );
}

export async function getTranscript(
  videoId: string,
  transcriptId: string,
): Promise<TranscriptDocument | undefined> {
  const snapshot = await transcriptRef(videoId, transcriptId).get();
  if (!snapshot.exists) {
    return undefined;
  }
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<TranscriptDocument, "id">),
  };
}

export async function updateTranscript(
  videoId: string,
  transcriptId: string,
  mutation: Partial<TranscriptDocument>,
) {
  await transcriptRef(videoId, transcriptId).set(mutation, { merge: true });
}

export async function updateTranscriptStatus(
  videoId: string,
  transcriptId: string,
  status: TranscriptStatus,
  overrides?: Partial<TranscriptDocument>,
) {
  const updatePayload: Partial<TranscriptDocument> = {
    status,
    ...overrides,
  };
  if (status === "done" || status === "failed") {
    updatePayload.completedAt = Timestamp.now();
  }
  await updateTranscript(videoId, transcriptId, updatePayload);
}
