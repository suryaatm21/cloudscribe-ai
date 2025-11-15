import { getFirestoreClient } from "./firestore";
import { getStorageClient } from "./storage";
import { serviceConfig } from "./config";

type DependencyStatus = "pass" | "fail";
type OverallStatus = "ok" | "degraded" | "unhealthy";

interface IDependencyCheckResult {
  status: DependencyStatus;
  details?: string;
  latencyMs: number;
}

export interface IHealthResponse {
  status: OverallStatus;
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  environment: string;
  dependencies: {
    firestore: IDependencyCheckResult;
    rawVideoBucket: IDependencyCheckResult;
    processedVideoBucket: IDependencyCheckResult;
  };
}

const serviceStartTime = Date.now();

async function checkFirestore(): Promise<IDependencyCheckResult> {
  const start = Date.now();
  try {
    const client = getFirestoreClient();
    await client.collection("videos").limit(1).get();
    return { status: "pass", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "fail",
      details: error instanceof Error ? error.message : "Unknown Firestore error",
      latencyMs: Date.now() - start,
    };
  }
}

async function checkBucket(bucketName: string): Promise<IDependencyCheckResult> {
  const start = Date.now();
  try {
    const client = getStorageClient();
    const [exists] = await client.bucket(bucketName).exists();
    if (!exists) {
      return {
        status: "fail",
        details: `Bucket ${bucketName} does not exist`,
        latencyMs: Date.now() - start,
      };
    }
    return { status: "pass", latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: "fail",
      details: error instanceof Error ? error.message : `Unknown error checking bucket ${bucketName}`,
      latencyMs: Date.now() - start,
    };
  }
}

function deriveOverallStatus(checks: IDependencyCheckResult[]): OverallStatus {
  const totalChecks = checks.length;
  const failedChecks = checks.filter((check) => check.status === "fail").length;

  if (failedChecks === 0) {
    return "ok";
  }

  if (failedChecks === totalChecks) {
    return "unhealthy";
  }

  return "degraded";
}

export async function buildHealthResponse(): Promise<IHealthResponse> {
  const [firestoreStatus, rawBucketStatus, processedBucketStatus] = await Promise.all([
    checkFirestore(),
    checkBucket(serviceConfig.rawVideoBucketName),
    checkBucket(serviceConfig.processedVideoBucketName),
  ]);

  const dependencies = {
    firestore: firestoreStatus,
    rawVideoBucket: rawBucketStatus,
    processedVideoBucket: processedBucketStatus,
  };

  const status = deriveOverallStatus(Object.values(dependencies));

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - serviceStartTime) / 1000),
    version: serviceConfig.version,
    environment: serviceConfig.environment,
    dependencies,
  };
}

