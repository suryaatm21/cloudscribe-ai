interface IServiceConfig {
  rawVideoBucketName: string;
  processedVideoBucketName: string;
  audioWorkBucketName: string;
  transcriptsBucketName: string;
  transcriptionTopicName: string;
  speechToTextModel: string;
  speechToTextLanguage: string;
  enableTranscription: boolean;
  processingMaxAttempts: number;
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
  enableTranscription: getBooleanEnvVar("ENABLE_TRANSCRIPTION", true),
  processingMaxAttempts: getNumericEnvVar("PROCESSING_MAX_ATTEMPTS", 3),
  projectId: getEnvVar("PROJECT_ID"),
  region: getEnvVar("REGION"),
  serviceName: getEnvVar("SERVICE_NAME"),
  version: getEnvVar("SERVICE_VERSION") ?? process.env.npm_package_version ?? "dev",
  environment: getEnvVar("NODE_ENV") ?? "development",
};

export type { IServiceConfig };

