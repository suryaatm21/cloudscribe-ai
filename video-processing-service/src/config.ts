interface IServiceConfig {
  rawVideoBucketName: string;
  processedVideoBucketName: string;
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

export const serviceConfig: IServiceConfig = {
  rawVideoBucketName: getEnvVar("RAW_VIDEO_BUCKET_NAME") ?? "atmuri-yt-raw-videos",
  processedVideoBucketName:
    getEnvVar("PROCESSED_VIDEO_BUCKET_NAME") ?? "atmuri-yt-processed-videos",
  processingMaxAttempts: getNumericEnvVar("PROCESSING_MAX_ATTEMPTS", 3),
  projectId: getEnvVar("PROJECT_ID"),
  region: getEnvVar("REGION"),
  serviceName: getEnvVar("SERVICE_NAME"),
  version: getEnvVar("SERVICE_VERSION") ?? process.env.npm_package_version ?? "dev",
  environment: getEnvVar("NODE_ENV") ?? "development",
};

export type { IServiceConfig };

