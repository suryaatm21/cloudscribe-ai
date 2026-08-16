/**
 * Runtime configuration contract for the notes service.
 */
export interface IServiceConfig {
  port: number;
  notesBucketName: string;
  promptsBucketName: string;
  vertexProjectId: string;
  vertexRegion: string;
  vertexModel: string;
  vertexSafetyTier: string;
  notesPromptId: string;
  enableNotes: boolean;
  cacheTtlMs: number;
  environment: string;
  serviceName: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

/**
 * Reads a string environment variable with optional fallback.
 * @param key Environment key to read.
 * @param fallback Value returned when the variable is missing.
 * @returns Sanitized string value.
 */
function getEnvVar(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value && value.trim().length > 0) {
    return value.trim();
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required environment variable: ${key}`);
}

/**
 * Reads a numeric environment variable with fallback.
 * @param key Environment key to read.
 * @param fallback Value returned when parsing fails.
 * @returns Parsed numeric value.
 */
function getNumberEnvVar(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

/**
 * Reads a boolean environment variable with fallback.
 * @param key Environment key to read.
 * @param fallback Default boolean when missing.
 * @returns Boolean interpretation of the variable.
 */
function getBooleanEnvVar(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

/**
 * Determines the log level configured for the service.
 * @returns Normalized log level value.
 */
function getLogLevel(): "debug" | "info" | "warn" | "error" {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (!configured) {
    return "info";
  }
  if (["debug", "info", "warn", "error"].includes(configured)) {
    return configured as "debug" | "info" | "warn" | "error";
  }
  return "info";
}

export const serviceConfig: IServiceConfig = {
  port: getNumberEnvVar("PORT", 3000),
  notesBucketName: getEnvVar("NOTES_BUCKET_NAME", "atmuri-yt-notes"),
  promptsBucketName: getEnvVar("PROMPTS_BUCKET_NAME", "atmuri-yt-notes-prompts"),
  vertexProjectId: getEnvVar("VERTEXAI_PROJECT_ID", process.env.GOOGLE_CLOUD_PROJECT),
  vertexRegion: getEnvVar("VERTEXAI_REGION", "us-central1"),
  vertexModel: getEnvVar("VERTEXAI_MODEL", "gemini-1.5-pro"),
  vertexSafetyTier: getEnvVar("VERTEXAI_SAFETY_TIER", "BLOCK_MEDIUM_AND_ABOVE"),
  notesPromptId: getEnvVar("NOTES_PROMPT_ID", "study-notes-v1.0.0"),
  enableNotes: getBooleanEnvVar("ENABLE_NOTES", true),
  cacheTtlMs: getNumberEnvVar("CACHE_TTL_MS", 300_000),
  environment: getEnvVar("NODE_ENV", "production"),
  serviceName: getEnvVar("SERVICE_NAME", "notes-service"),
  logLevel: getLogLevel(),
};
