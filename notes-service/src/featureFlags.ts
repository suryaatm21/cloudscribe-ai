import { serviceConfig } from "./config";
import { getGlobalFeatureFlags, getUserSettings } from "./firestore";
import { logger } from "./logger";

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const globalCache: CacheEntry = {
  value: true,
  expiresAt: 0,
};

const userCache = new Map<string, CacheEntry>();

/**
 * Determines whether a cached flag entry is stale.
 * @param entry Cached value.
 * @returns True when the cache should be refreshed.
 */
function isExpired(entry?: CacheEntry): boolean {
  if (!entry) {
    return true;
  }
  return Date.now() > entry.expiresAt;
}

/**
 * Evaluates the global notes feature switch.
 * @returns True when notes generation is globally enabled.
 */
export async function isNotesFeatureGloballyEnabled(): Promise<boolean> {
  if (!serviceConfig.enableNotes) {
    return false;
  }
  if (!isExpired(globalCache)) {
    return globalCache.value;
  }
  const flags = await getGlobalFeatureFlags();
  const value = flags?.notesEnabled ?? true;
  globalCache.value = value;
  globalCache.expiresAt = Date.now() + serviceConfig.cacheTtlMs;
  logger.debug("Refreshed global notes flag", { value });
  return value;
}

/**
 * Resolves a user's feature flag override.
 * @param userId User identifier whose override should be evaluated.
 * @returns True when the user opted in, defaults to true.
 */
export async function isUserNotesFeatureEnabled(userId?: string): Promise<boolean> {
  if (!userId) {
    return true;
  }
  const cached = userCache.get(userId);
  if (cached && !isExpired(cached)) {
    return cached.value;
  }
  const settings = await getUserSettings(userId);
  const value = settings?.notesEnabled ?? true;
  userCache.set(userId, {
    value,
    expiresAt: Date.now() + serviceConfig.cacheTtlMs,
  });
  logger.debug("Refreshed user notes flag", { userId, value });
  return value;
}

/**
 * Determines whether notes jobs should run for the provided user.
 * @param userId User identifier associated with the job.
 * @returns True when both global and user flags permit execution.
 */
export async function shouldGenerateNotes(userId?: string): Promise<boolean> {
  if (!(await isNotesFeatureGloballyEnabled())) {
    return false;
  }
  return isUserNotesFeatureEnabled(userId);
}
