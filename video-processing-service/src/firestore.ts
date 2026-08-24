import { credential } from "firebase-admin";
import { initializeApp } from "firebase-admin/app";
import { Firestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "./logger";

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

/**
 * Transcript job lifecycle.
 *
 * pending → running: only `/transcribe-audio` may claim, and only from pending.
 * running → done: GCS notification or sweeper after Speech writes output.
 * running → no_audio_detected: Speech returned a well-formed result with
 *   zero usable speech segments (silent screen recording, etc.), OR the
 *   source had no audio stream (detected during extraction before Speech).
 *   Terminal, not an error — there is no transcript artifact to sign.
 * running → failed: Speech (or our pre-RPC validation) definitely never
 *   started, or Speech completed with a recorded error / unparseable output.
 * running → needs_review: Speech RPC may already have been accepted (timeout,
 *   or failure while persisting operationName). Terminal for automatic retries
 *   so we never start a second billed job; a human or the sweeper adjudicates.
 * failed, needs_review, done, and no_audio_detected are terminal for
 * `/transcribe-audio`.
 */
export type TranscriptStatus =
  | "pending"
  | "running"
  | "failed"
  | "done"
  | "needs_review"
  | "no_audio_detected";

/**
 * How the transcript was produced. Downstream notes/indexing/chat must not
 * branch on this — live is another producer of the same document. `batch`
 * is the only producer today; `live` is reserved for Sprint 6.
 */
export type TranscriptSource = "batch" | "live";

/**
 * Sweeper candidates. Terminal statuses (done, failed, no_audio_detected)
 * are excluded so they are never re-claimed or re-processed.
 */
export const RECONCILE_TRANSCRIPT_STATUSES: TranscriptStatus[] = [
  "running",
  "needs_review",
];

export interface TranscriptDocument {
  id?: string;
  videoId: string;
  status: TranscriptStatus;
  /**
   * Producer discriminator. Always `batch` today. Batch-only fields below
   * stay optional so a future live session can omit them.
   */
  source: TranscriptSource;
  gcsPath?: string;
  segmentCount?: number;
  durationSeconds?: number;
  language: string;
  model: string;
  createdAt?: Timestamp;
  completedAt?: Timestamp;
  claimedAt?: Timestamp;
  error?: string;
  /** Batch Speech LRO name. Meaningless for a live streaming session. */
  operationName?: string;
  /** Batch FLAC object. Meaningless for a live streaming session. */
  audioGcsUri?: string;
  userId?: string;
}

export type TranscriptClaimResult =
  | { kind: "missing" }
  | { kind: "already-done" }
  | { kind: "terminal-failed" }
  | { kind: "terminal-no-audio" }
  | { kind: "needs-review" }
  | { kind: "reuse-operation"; operationName: string }
  | { kind: "claim-in-progress" }
  | { kind: "claimed" };

/**
 * Pure decision for the atomic Speech-job claim.
 * Only `pending` may transition to `running`. `failed`, `needs_review`,
 * `done`, and `no_audio_detected` are terminal for automatic retries.
 */
export function evaluateTranscriptClaim(
  transcript: TranscriptDocument | undefined,
): TranscriptClaimResult {
  if (!transcript) {
    return { kind: "missing" };
  }
  if (transcript.status === "done") {
    return { kind: "already-done" };
  }
  if (transcript.status === "failed") {
    return { kind: "terminal-failed" };
  }
  if (transcript.status === "no_audio_detected") {
    return { kind: "terminal-no-audio" };
  }
  if (transcript.status === "needs_review") {
    return { kind: "needs-review" };
  }
  if (transcript.status === "running") {
    if (transcript.operationName) {
      return {
        kind: "reuse-operation",
        operationName: transcript.operationName,
      };
    }
    return { kind: "claim-in-progress" };
  }
  if (transcript.status === "pending") {
    return { kind: "claimed" };
  }
  return { kind: "claim-in-progress" };
}

export function wasTranscriptClaimed(
  transcript: TranscriptDocument | undefined,
): boolean {
  if (!transcript) {
    return false;
  }
  return (
    transcript.status === "running" ||
    transcript.status === "needs_review" ||
    transcript.status === "failed" ||
    transcript.status === "done" ||
    transcript.status === "no_audio_detected"
  );
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

/**
 * Same-status is not a transition. The race we guard is the sweeper writing
 * `done` after `/transcript-ready` already finished the same document: that
 * must return false so reconcile does not report a `recovered` that never
 * happened. Last-write-wins is kept for in-flight transitions. We also
 * refuse to regress a finished transcript (`done` or `no_audio_detected`).
 */
function isFinishedTranscriptStatus(status: TranscriptStatus): boolean {
  return status === "done" || status === "no_audio_detected";
}

export function shouldApplyTranscriptStatusTransition(
  current: TranscriptStatus | undefined,
  next: TranscriptStatus,
): boolean {
  if (current === next) {
    return false;
  }
  if (current !== undefined && isFinishedTranscriptStatus(current)) {
    return false;
  }
  return true;
}

export function buildTranscriptStatusUpdate(
  status: TranscriptStatus,
  overrides?: Partial<TranscriptDocument>,
): Record<string, unknown> {
  const updatePayload: Record<string, unknown> = {
    status,
    ...overrides,
  };
  if (
    status === "done" ||
    status === "failed" ||
    status === "no_audio_detected"
  ) {
    updatePayload.completedAt = Timestamp.now();
  }
  if (
    (status === "done" || status === "no_audio_detected") &&
    overrides?.error === undefined
  ) {
    updatePayload.error = FieldValue.delete();
  }
  return updatePayload;
}

export async function updateTranscriptStatus(
  videoId: string,
  transcriptId: string,
  status: TranscriptStatus,
  overrides?: Partial<TranscriptDocument>,
): Promise<boolean> {
  const ref = transcriptRef(videoId, transcriptId);
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists
      ? (snapshot.data() as TranscriptDocument).status
      : undefined;
    if (!shouldApplyTranscriptStatusTransition(current, status)) {
      logger.warn("Refusing to regress a finished transcript", {
        component: "firestore",
        videoId,
        transcriptId,
        currentStatus: current,
        attemptedStatus: status,
      });
      return false;
    }
    tx.set(ref, buildTranscriptStatusUpdate(status, overrides), { merge: true });
    return true;
  });
}

/**
 * Reserves a transcript for Speech-to-Text in a transaction so a concurrent
 * delivery cannot start a second billable job. Only `pending` is claimable.
 */
export async function claimTranscriptJob(
  videoId: string,
  transcriptId: string,
): Promise<TranscriptClaimResult> {
  const ref = transcriptRef(videoId, transcriptId);
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const transcript = snapshot.exists
      ? ({
          id: snapshot.id,
          ...(snapshot.data() as Omit<TranscriptDocument, "id">),
        } as TranscriptDocument)
      : undefined;
    const decision = evaluateTranscriptClaim(transcript);
    if (decision.kind === "claimed") {
      tx.set(
        ref,
        {
          status: "running",
          claimedAt: Timestamp.now(),
        },
        { merge: true },
      );
    }
    return decision;
  });
}

export async function listTranscriptsForReconcile(): Promise<
  TranscriptDocument[]
> {
  const snapshot = await firestore
    .collectionGroup(transcriptCollectionId)
    .where("status", "in", RECONCILE_TRANSCRIPT_STATUSES)
    .get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<TranscriptDocument, "id">),
  }));
}

export function timestampToMillis(
  value?: Timestamp | { toMillis?: () => number; seconds?: number },
): number | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  return undefined;
}
