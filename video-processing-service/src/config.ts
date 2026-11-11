export const SPEECH_PROCESSING_STRATEGY_VALUES = [
  "STANDARD",
  "DYNAMIC_BATCHING",
] as const;

export type SpeechProcessingStrategy =
  (typeof SPEECH_PROCESSING_STRATEGY_VALUES)[number];

export type SpeechApiProcessingStrategy =
  | "PROCESSING_STRATEGY_UNSPECIFIED"
  | "DYNAMIC_BATCHING";

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
  /**
   * LAUNCH BLOCKER. Default STANDARD is ~5× DYNAMIC_BATCHING
   * ($0.016/min vs $0.003/min). Switch to DYNAMIC_BATCHING before
   * production lecture audio. See parseSpeechProcessingStrategy.
   */
  speechProcessingStrategy: SpeechProcessingStrategy;
  processingMaxAttempts: number;
  reconcileStaleAfterMs: number;
  /**
   * How long a video may stay `processing` before the sweeper fails it. Never
   * below `MIN_TRANSCODE_STALE_AFTER_MS`; see `parseTranscodeStaleAfterMs`.
   */
  transcodeStaleAfterMs: number;
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
 * LAUNCH BLOCKER — `SPEECH_PROCESSING_STRATEGY`
 *
 * Accepted values (exact, case-sensitive):
 * - `STANDARD` (default): Speech v2 `PROCESSING_STRATEGY_UNSPECIFIED`.
 *   Processed as soon as received. ~$0.016/min. Test runs finish in minutes.
 *   This is 5× the DYNAMIC_BATCHING price ($0.016 vs $0.003 per minute).
 * - `DYNAMIC_BATCHING`: fulfilled within 24 hours at the discounted rate.
 *   Required for production launch; unusable while iterating on tests.
 *
 * Unrecognized values throw at process start so we never send garbage to
 * the Speech API. Cloud Build deploys this from `_SPEECH_PROCESSING_STRATEGY`.
 */
export function parseSpeechProcessingStrategy(
  raw: string | undefined,
): SpeechProcessingStrategy {
  if (raw === undefined || raw.trim().length === 0) {
    return "STANDARD";
  }
  const value = raw.trim();
  if (value === "STANDARD" || value === "DYNAMIC_BATCHING") {
    return value;
  }
  throw new Error(
    `Unrecognized SPEECH_PROCESSING_STRATEGY=${JSON.stringify(raw)}. ` +
      "Accepted values: STANDARD (default; processes immediately at ~$0.016/min) " +
      "or DYNAMIC_BATCHING (~$0.003/min, fulfilled within 24 hours). " +
      "STANDARD is 5× the batch price and must be switched to DYNAMIC_BATCHING " +
      "before production launch.",
  );
}

export function speechApiProcessingStrategy(
  strategy: SpeechProcessingStrategy,
): SpeechApiProcessingStrategy {
  return strategy === "DYNAMIC_BATCHING"
    ? "DYNAMIC_BATCHING"
    : "PROCESSING_STRATEGY_UNSPECIFIED";
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

/**
 * Floor for `TRANSCODE_STALE_AFTER_MS`: the Cloud Run request timeout (3600 s)
 * plus a one-hour margin.
 *
 * Why a floor is enough to keep the sweeper from failing a live transcode: a
 * transcode (all `processingMaxAttempts` attempts included) runs inside a single
 * `/process-video` request, and Cloud Run ends that request at 3600 s. A claim
 * older than the timeout therefore has no live request behind it, so any bound
 * above the timeout only ever fails abandoned claims. That is why there is no
 * separate transcode deadline or claim heartbeat. If the service timeout is ever
 * raised, raise this floor with it.
 */
export const MIN_TRANSCODE_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * Parses `TRANSCODE_STALE_AFTER_MS`. Unset means the 2 h default (equal to the
 * floor). A set value that is not a number, or is below the floor, throws at
 * process start: a too-small bound would let the 15-minute sweep fail
 * transcodes that are still running.
 */
export function parseTranscodeStaleAfterMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return MIN_TRANSCODE_STALE_AFTER_MS;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < MIN_TRANSCODE_STALE_AFTER_MS) {
    throw new Error(
      `Invalid TRANSCODE_STALE_AFTER_MS=${JSON.stringify(raw)}. ` +
        `It must be a number of milliseconds of at least ${MIN_TRANSCODE_STALE_AFTER_MS} ` +
        "(2 hours): the Cloud Run request timeout is 3600 s, and a smaller value " +
        "would let the sweeper fail videos that are still transcoding.",
    );
  }
  return parsed;
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
const speechProcessingStrategy = parseSpeechProcessingStrategy(
  getEnvVar("SPEECH_PROCESSING_STRATEGY"),
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
  speechProcessingStrategy,
  processingMaxAttempts: getNumericEnvVar("PROCESSING_MAX_ATTEMPTS", 3),
  reconcileStaleAfterMs: getNumericEnvVar(
    "RECONCILE_STALE_AFTER_MS",
    30 * 60 * 1000,
  ),
  transcodeStaleAfterMs: parseTranscodeStaleAfterMs(
    getEnvVar("TRANSCODE_STALE_AFTER_MS"),
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
