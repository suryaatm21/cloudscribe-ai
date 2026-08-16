import { serviceConfig } from "./config";

/**
 * Contract describing the health endpoint response.
 */
export interface HealthReport {
  status: "ok" | "degraded";
  timestamp: string;
  details: Record<string, string>;
}

/**
 * Builds a shallow health report summarizing core dependencies.
 * @returns Health payload consumed by the /health endpoint.
 */
export async function buildHealthReport(): Promise<HealthReport> {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    details: {
      notesBucket: serviceConfig.notesBucketName,
      promptsBucket: serviceConfig.promptsBucketName,
      vertexModel: serviceConfig.vertexModel,
    },
  };
}
