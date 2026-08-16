import { credential } from "firebase-admin";
import { initializeApp } from "firebase-admin/app";
import { Firestore, Timestamp } from "firebase-admin/firestore";

const app = initializeApp({ credential: credential.applicationDefault() });
const firestore = new Firestore(app);

const VIDEO_COLLECTION = "videos";
const NOTES_SUBCOLLECTION = "notes";
const CONFIG_COLLECTION = "config";
const FEATURES_DOC = "features";
const USERS_COLLECTION = "users";
const USER_SETTINGS_SUBCOLLECTION = "settings";
const USER_SETTINGS_DOC = "preferences";

export type NoteStatus = "pending" | "running" | "done" | "failed";

/**
 * Firestore representation of a generated notes artifact.
 */
export interface NoteDocument {
  id?: string;
  videoId: string;
  transcriptId: string;
  noteId: string;
  status: NoteStatus;
  promptVersion: string;
  gcsPath?: string;
  userId: string;
  error?: string;
  createdAt?: Timestamp;
  completedAt?: Timestamp;
}

/**
 * Shape of the global feature flag configuration document.
 */
export interface FeatureFlagDocument {
  notesEnabled?: boolean;
}

/**
 * User-specific feature flag overrides.
 */
export interface UserSettingsDocument {
  notesEnabled?: boolean;
}

/**
 * Resolves the notes sub-collection for a given video.
 * @param videoId Target video identifier.
 * @returns Firestore collection reference.
 */
function notesCollection(videoId: string) {
  return firestore.collection(VIDEO_COLLECTION).doc(videoId).collection(NOTES_SUBCOLLECTION);
}

/**
 * Resolves a specific note document reference.
 * @param videoId Video identifier.
 * @param noteId Note identifier.
 * @returns Firestore document reference.
 */
function noteRef(videoId: string, noteId: string) {
  return notesCollection(videoId).doc(noteId);
}

/**
 * Creates or updates a note document with the provided payload.
 * @param videoId Video identifier.
 * @param noteId Note identifier.
 * @param payload Partial note document fields to persist.
 */
export async function createOrUpdateNote(
  videoId: string,
  noteId: string,
  payload: Partial<NoteDocument>,
) {
  const document: Partial<NoteDocument> = {
    ...payload,
    videoId,
    noteId,
    createdAt: payload.createdAt ?? Timestamp.now(),
  };
  await noteRef(videoId, noteId).set(document, { merge: true });
}

/**
 * Updates the status field of an existing note document.
 * @param videoId Video identifier.
 * @param noteId Note identifier.
 * @param status Target status value.
 * @param overrides Additional metadata to merge.
 */
export async function updateNoteStatus(
  videoId: string,
  noteId: string,
  status: NoteStatus,
  overrides?: Partial<NoteDocument>,
) {
  const updatePayload: Partial<NoteDocument> = {
    status,
    ...overrides,
  };
  if (status === "done" || status === "failed") {
    updatePayload.completedAt = Timestamp.now();
  }
  await noteRef(videoId, noteId).set(updatePayload, { merge: true });
}

/**
 * Retrieves a single note document if it exists.
 * @param videoId Video identifier.
 * @param noteId Note identifier.
 * @returns Note document or undefined when missing.
 */
export async function getNote(videoId: string, noteId: string): Promise<NoteDocument | undefined> {
  const snapshot = await noteRef(videoId, noteId).get();
  if (!snapshot.exists) {
    return undefined;
  }
  return { id: snapshot.id, ...(snapshot.data() as NoteDocument) };
}

/**
 * Loads the global feature flag document.
 * @returns Global feature flag configuration, if present.
 */
export async function getGlobalFeatureFlags(): Promise<FeatureFlagDocument | undefined> {
  const snapshot = await firestore.collection(CONFIG_COLLECTION).doc(FEATURES_DOC).get();
  if (!snapshot.exists) {
    return undefined;
  }
  return snapshot.data() as FeatureFlagDocument;
}

/**
 * Reads the per-user settings document controlling feature flags.
 * @param userId User identifier.
 * @returns User settings payload or undefined when absent.
 */
export async function getUserSettings(userId: string): Promise<UserSettingsDocument | undefined> {
  if (!userId) {
    return undefined;
  }
  const snapshot = await firestore
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(USER_SETTINGS_SUBCOLLECTION)
    .doc(USER_SETTINGS_DOC)
    .get();
  if (!snapshot.exists) {
    return undefined;
  }
  return snapshot.data() as UserSettingsDocument;
}
