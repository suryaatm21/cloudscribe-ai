interface IServiceConfig {
  rawVideoBucketName: string;
  processedVideoBucketName: string;
  audioWorkBucketName: string;
  transcriptsBucketName: string;
  transcriptionTopicName: string;
  speechToTextModel: string;
  speechToTextLanguage: string;
  speechLocation: string;
  rawTranscriptPrefix: string;
  normalizedTranscriptPrefix: string;
  enableTranscription: boolean;
  processingMaxAttempts: number;
  reconcileStaleAfterMs: number;
  projectId?: string;
  region?: string;
  serviceName?: string;
  version: string;
  environment: string;
}

function getEnvVar(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === null || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function getNumericEnvVar(key: string, fallback: number): number {
  const rawValue = getEnvVar(key);
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

function getBooleanEnvVar(key: string, fallback: boolean): boolean {
  const rawValue = getEnvVar(key);
  if (!rawValue) {
    return fallback;
  }
  return ["1", "true", "yes"].includes(rawValue.toLowerCase());
}

function normalizePrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

/**
 * Speech writes under `{raw}/...` and a GCS notification is filtered on that
 * prefix. Normalized output must not match that filter, or `/transcript-ready`
 * would re-trigger itself in a billed loop. Path-prefix overlap (`raw` vs
 * `raw/extra`) is as dangerous as equality.
 */
export function assertTranscriptOutputPrefixes(
  rawPrefix: string,
  normalizedPrefix: string,
): void {
  if (!rawPrefix || !normalizedPrefix) {
    throw new Error(
      "RAW_TRANSCRIPT_PREFIX and NORMALIZED_TRANSCRIPT_PREFIX must be non-empty",
    );
  }
  if (rawPrefix.includes("\0") || normalizedPrefix.includes("\0")) {
    throw new Error("Transcript prefixes must not contain null bytes");
  }
  if (rawPrefix === normalizedPrefix) {
    throw new Error(
      "RAW_TRANSCRIPT_PREFIX and NORMALIZED_TRANSCRIPT_PREFIX must be distinct",
    );
  }
  const rawPath = `${rawPrefix}/`;
  const normalizedPath = `${normalizedPrefix}/`;
  if (
    rawPath.startsWith(normalizedPath) ||
    normalizedPath.startsWith(rawPath)
  ) {
    throw new Error(
      `Transcript prefixes overlap (raw=${rawPrefix}, normalized=${normalizedPrefix}); ` +
        "this would create a billed notification feedback loop",
    );
  }
}

/**
 * Invalid prefixes must not take down transcoding. Fail at import only when
 * transcription is actually enabled; otherwise log loudly and keep serving.
 */
function validateTranscriptPrefixesOrWarn(
  rawPrefix: string,
  normalizedPrefix: string,
  transcriptionEnabled: boolean,
): void {
  try {
    assertTranscriptOutputPrefixes(rawPrefix, normalizedPrefix);
  } catch (error) {
    if (transcriptionEnabled) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Transcription prefix configuration is invalid (${message}). ` +
        "Video processing will continue because ENABLE_TRANSCRIPTION is false; " +
        "enabling transcription will refuse to start until this is fixed.",
    );
  }
}

const rawTranscriptPrefix = normalizePrefix(
  getEnvVar("RAW_TRANSCRIPT_PREFIX") ?? "raw",
);
const normalizedTranscriptPrefix = normalizePrefix(
  getEnvVar("NORMALIZED_TRANSCRIPT_PREFIX") ?? "normalized",
);
const enableTranscription = getBooleanEnvVar("ENABLE_TRANSCRIPTION", false);
validateTranscriptPrefixesOrWarn(
  rawTranscriptPrefix,
  normalizedTranscriptPrefix,
  enableTranscription,
);

export const serviceConfig: IServiceConfig = {
  rawVideoBucketName: getEnvVar("RAW_VIDEO_BUCKET_NAME") ?? "atmuri-yt-raw-videos",
  processedVideoBucketName:
    getEnvVar("PROCESSED_VIDEO_BUCKET_NAME") ?? "atmuri-yt-processed-videos",
  audioWorkBucketName:
    getEnvVar("AUDIO_WORK_BUCKET_NAME") ?? "atmuri-yt-audio-work",
  transcriptsBucketName:
    getEnvVar("TRANSCRIPTS_BUCKET_NAME") ?? "atmuri-yt-transcripts",
  transcriptionTopicName:
    getEnvVar("TRANSCRIPTION_TOPIC_NAME") ?? "transcription-jobs",
  speechToTextModel: getEnvVar("SPEECH_TO_TEXT_MODEL") ?? "long",
  speechToTextLanguage: getEnvVar("SPEECH_TO_TEXT_LANGUAGE") ?? "en-US",
  speechLocation:
    getEnvVar("SPEECH_LOCATION") ?? getEnvVar("REGION") ?? "us-central1",
  rawTranscriptPrefix,
  normalizedTranscriptPrefix,
  enableTranscription,
  processingMaxAttempts: getNumericEnvVar("PROCESSING_MAX_ATTEMPTS", 3),
  reconcileStaleAfterMs: getNumericEnvVar(
    "RECONCILE_STALE_AFTER_MS",
    30 * 60 * 1000,
  ),
  projectId:
    getEnvVar("PROJECT_ID") ??
    getEnvVar("GOOGLE_CLOUD_PROJECT") ??
    getEnvVar("GCP_PROJECT"),
  region: getEnvVar("REGION"),
  serviceName: getEnvVar("SERVICE_NAME"),
  version: getEnvVar("SERVICE_VERSION") ?? process.env.npm_package_version ?? "dev",
  environment: getEnvVar("NODE_ENV") ?? "development",
};

export type { IServiceConfig };
