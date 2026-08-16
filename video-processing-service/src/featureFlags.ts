import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreClient } from "./firestore";
import { serviceConfig } from "./config";
import { logger } from "./logger";

/**
 * Cached feature flag entry metadata.
 */
interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const globalCache: CacheEntry = { value: true, expiresAt: 0 };
const userCache = new Map<string, CacheEntry>();
const CONFIG_COLLECTION = "config";
const FEATURES_DOC = "features";
const USERS_COLLECTION = "users";
const USER_SETTINGS_SUBCOLLECTION = "settings";
const USER_SETTINGS_DOC = "preferences";

/**
 * Determines whether a cache entry can still be used.
 * @param entry Cache entry instance.
 * @returns True when entry is missing or stale.
 */
function isExpired(entry?: CacheEntry): boolean {
  if (!entry) {
    return true;
  }
  return Date.now() > entry.expiresAt;
}

/**
 * Evaluates the global feature flag for notes generation.
 * @returns Boolean indicating whether notes may run.
 */
export async function isNotesFeatureGloballyEnabled(): Promise<boolean> {
  if (!serviceConfig.enableNotes) {
    return false;
  }
  if (!isExpired(globalCache)) {
    return globalCache.value;
  }
  const firestore = getFirestoreClient();
  const snapshot = await firestore.collection(CONFIG_COLLECTION).doc(FEATURES_DOC).get();
  const value = (snapshot.data()?.notesEnabled as boolean | undefined) ?? true;
  globalCache.value = value;
  globalCache.expiresAt = Date.now() + 300_000;
  logger.debug("Refreshed global notes flag", { value });
  return value;
}

/**
 * Evaluates the per-user override for notes generation.
 * @param userId User identifier extracted from the transcript.
 * @returns Boolean indicating whether notes may run for the user.
 */
export async function isUserNotesFeatureEnabled(userId?: string): Promise<boolean> {
  if (!userId) {
    return true;
  }
  const cached = userCache.get(userId);
  if (cached && !isExpired(cached)) {
    return cached.value;
  }
  const firestore = getFirestoreClient();
  const snapshot = await firestore
    .collection(USERS_COLLECTION)
    .doc(userId)
    .collection(USER_SETTINGS_SUBCOLLECTION)
    .doc(USER_SETTINGS_DOC)
    .get();
  const value = (snapshot.data()?.notesEnabled as boolean | undefined) ?? true;
  userCache.set(userId, {
    value,
    expiresAt: Date.now() + 300_000,
  });
  logger.debug("Refreshed user notes flag", { userId, value });
  return value;
}

/**
 * Determines whether notes generation should be triggered.
 * @param userId User identifier to evaluate.
 * @returns True when both global and user-level flags allow notes.
 */
export async function shouldGenerateNotes(userId?: string): Promise<boolean> {
  if (!(await isNotesFeatureGloballyEnabled())) {
    return false;
  }
  return isUserNotesFeatureEnabled(userId);
}
