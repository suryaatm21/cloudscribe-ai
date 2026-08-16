import { Storage } from "@google-cloud/storage";
import { logger } from "./logger";
import { serviceConfig } from "./config";

/**
 * Shape of the transcript JSON stored in GCS.
 */
export interface TranscriptPayload {
  videoId: string;
  language: string;
  model: string;
  durationSeconds: number;
  segments: { text: string; startTime: number; endTime: number }[];
  createdAt: string;
}

const storage = new Storage();

/**
 * Downloads a file from GCS into memory.
 * @param bucketName Bucket containing the file.
 * @param objectPath Object path within the bucket.
 * @returns File contents as a buffer.
 */
async function readBuffer(bucketName: string, objectPath: string): Promise<Buffer> {
  const file = storage.bucket(bucketName).file(objectPath);
  const [buffer] = await file.download();
  return buffer;
}

/**
 * Loads the transcript payload referenced by the provided GCS URI.
 * @param transcriptGcsPath Fully-qualified GCS URI to the transcript JSON.
 * @returns Parsed transcript payload.
 */
export async function fetchTranscriptPayload(transcriptGcsPath: string): Promise<TranscriptPayload> {
  if (!transcriptGcsPath.startsWith("gs://")) {
    throw new Error(`Invalid transcript path: ${transcriptGcsPath}`);
  }
  const [, remainder] = transcriptGcsPath.split("gs://");
  const [bucketPart, ...objectParts] = remainder.split("/");
  const bucketName = bucketPart;
  const objectPath = objectParts.join("/");
  if (!bucketName || !objectPath) {
    throw new Error(`Invalid GCS reference: ${transcriptGcsPath}`);
  }
  const buffer = await readBuffer(bucketName, objectPath);
  const payload = JSON.parse(buffer.toString("utf-8"));
  return payload as TranscriptPayload;
}

/**
 * Persists generated notes markdown into the configured bucket.
 * @param videoId Parent video identifier.
 * @param noteId Note identifier.
 * @param markdown Markdown body to store.
 * @returns GCS URI of the uploaded object.
 */
export async function uploadNotesMarkdown(
  videoId: string,
  noteId: string,
  markdown: string,
): Promise<string> {
  const filePath = `${videoId}/${noteId}.md`;
  const bucket = storage.bucket(serviceConfig.notesBucketName);
  await bucket.file(filePath).save(markdown, {
    contentType: "text/markdown",
    resumable: false,
  });
  logger.info("Uploaded notes markdown", {
    component: "storage",
    videoId,
    noteId,
    bucket: serviceConfig.notesBucketName,
    filePath,
  });
  return `gs://${serviceConfig.notesBucketName}/${filePath}`;
}

/**
 * Resolves the destination bucket used for notes artifacts.
 * @returns Bucket name string.
 */
export function getNotesBucketName(): string {
  return serviceConfig.notesBucketName;
}
