import { v2 } from "@google-cloud/speech";
import { serviceConfig } from "./config";
import { getStorageClient } from "./storage";
import { logger } from "./logger";

/**
 * Assumed Speech-to-Text v2 GCS result JSON shape
 * ================================================
 * Nobody on this project has seen a real v2 `batchRecognize` result file yet.
 * `buildTranscriptPayload` therefore validates the parsed object and throws
 * on unexpected structure instead of returning an empty transcript.
 *
 * Documented REST / proto3 JSON for `BatchRecognizeResults`:
 *   {
 *     results: SpeechRecognitionResult[],
 *     metadata?: RecognitionResponseMetadata
 *   }
 *
 * Each `SpeechRecognitionResult`:
 *   {
 *     alternatives: [{
 *       transcript: string,
 *       confidence?: number,
 *       words?: [{
 *         startOffset: string,   // proto3 Duration, e.g. "0.400s"
 *         endOffset: string,
 *         word: string,
 *         confidence?: number
 *       }]
 *     }],
 *     resultEndOffset?: string,
 *     languageCode?: string
 *   }
 *
 * Additional encodings we accept so a later correction is cheap:
 *   - Duration as `{ seconds, nanos }` (protobufjs / some client dumps)
 *   - snake_case field names (`start_offset`, `end_offset`, `result_end_offset`)
 *
 * See:
 * https://cloud.google.com/speech-to-text/docs/reference/rest/v2/BatchRecognizeFileResult
 */

export interface ITranscriptSegment {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

export interface ITranscriptPayload {
  videoId: string;
  language: string;
  model: string;
  durationSeconds: number;
  segments: ITranscriptSegment[];
  createdAt: string;
}

export interface ISpeechV2BatchRecognizeResults {
  results?: unknown;
  metadata?: unknown;
}

export interface GcsObjectNotification {
  name?: string;
  bucket?: string;
  contentType?: string;
}

export interface BatchRecognizeInspection {
  done: boolean;
  error?: string;
  outputUri?: string;
}

let speechClient: v2.SpeechClient | undefined;

function getSpeechClient(): v2.SpeechClient {
  if (!speechClient) {
    const location = serviceConfig.speechLocation;
    speechClient = new v2.SpeechClient({
      apiEndpoint: `${location}-speech.googleapis.com`,
    });
  }
  return speechClient;
}

export function implicitRecognizerPath(): string {
  const projectId = serviceConfig.projectId;
  if (!projectId) {
    throw new Error(
      "PROJECT_ID (or GOOGLE_CLOUD_PROJECT) is required to start a Speech v2 job",
    );
  }
  return `projects/${projectId}/locations/${serviceConfig.speechLocation}/recognizers/_`;
}

export function rawTranscriptObjectPrefix(
  videoId: string,
  transcriptId: string,
): string {
  return `${serviceConfig.rawTranscriptPrefix}/${videoId}/${transcriptId}/`;
}

export function normalizedTranscriptObjectPath(
  videoId: string,
  transcriptId: string,
): string {
  return `${serviceConfig.normalizedTranscriptPrefix}/${videoId}/${transcriptId}.json`;
}

export function parseRawTranscriptObjectName(
  objectName: string,
): { videoId: string; transcriptId: string } | undefined {
  const prefix = `${serviceConfig.rawTranscriptPrefix}/`;
  if (!objectName.startsWith(prefix)) {
    return undefined;
  }
  const rest = objectName.slice(prefix.length);
  const [videoId, transcriptId] = rest.split("/");
  if (!videoId || !transcriptId) {
    return undefined;
  }
  return { videoId, transcriptId };
}

function speechV2Model(model: string): string {
  if (model === "short" || model === "latest_short") {
    return "short";
  }
  return "long";
}

export async function startTranscriptionJob(
  audioGcsUri: string,
  videoId: string,
  transcriptId: string,
): Promise<string> {
  if (!audioGcsUri || !audioGcsUri.startsWith("gs://")) {
    throw new Error(`Invalid GCS URI: ${audioGcsUri}`);
  }

  const outputPrefix = rawTranscriptObjectPrefix(videoId, transcriptId);
  const outputUri = `gs://${serviceConfig.transcriptsBucketName}/${outputPrefix}`;

  const request = {
    recognizer: implicitRecognizerPath(),
    config: {
      explicitDecodingConfig: {
        encoding: "FLAC" as const,
        sampleRateHertz: 16000,
        audioChannelCount: 1,
      },
      languageCodes: [serviceConfig.speechToTextLanguage],
      model: speechV2Model(serviceConfig.speechToTextModel),
      features: {
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
      },
    },
    files: [{ uri: audioGcsUri }],
    recognitionOutputConfig: {
      gcsOutputConfig: { uri: outputUri },
    },
    processingStrategy: "DYNAMIC_BATCHING" as const,
  };

  const [operation] = await getSpeechClient().batchRecognize(request);
  if (!operation.name) {
    throw new Error("Speech-to-Text did not return an operation name");
  }

  logger.info("Started transcription job", {
    component: "transcription",
    operationName: operation.name,
    videoId,
    transcriptId,
    outputPrefix,
  });
  return operation.name;
}

export async function inspectBatchRecognizeOperation(
  operationName: string,
): Promise<BatchRecognizeInspection> {
  if (!operationName) {
    throw new Error("Operation name is required to inspect a Speech job");
  }

  const operation =
    await getSpeechClient().checkBatchRecognizeProgress(operationName);
  const done = Boolean(operation.done);
  const rpcError = operation.error;

  if (!done) {
    return { done: false };
  }

  if (rpcError) {
    const message =
      typeof rpcError === "object" &&
      rpcError !== null &&
      "message" in rpcError &&
      typeof rpcError.message === "string"
        ? rpcError.message
        : "Speech-to-Text operation failed";
    return { done: true, error: message };
  }

  const result = operation.latestResponse as
    | {
        results?: Record<
          string,
          {
            error?: { message?: string | null } | null;
            cloudStorageResult?: { uri?: string | null } | null;
            uri?: string | null;
          }
        >;
      }
    | undefined;

  const fileResults = result?.results ? Object.values(result.results) : [];
  const firstError = fileResults.find((file) => file.error?.message);
  if (firstError?.error?.message) {
    return { done: true, error: firstError.error.message };
  }

  const outputUri = fileResults.find(
    (file) => file.cloudStorageResult?.uri || file.uri,
  );
  return {
    done: true,
    outputUri: outputUri?.cloudStorageResult?.uri ?? outputUri?.uri ?? undefined,
  };
}

export function buildTranscriptPayload(
  videoId: string,
  parsed: unknown,
): ITranscriptPayload {
  const results = extractSpeechV2Results(parsed);
  const segments: ITranscriptSegment[] = [];
  let maxEnd = 0;

  for (const result of results) {
    const alternative = firstAlternative(result);
    if (!alternative) {
      continue;
    }
    const text = stringField(alternative, "transcript")?.trim() ?? "";
    if (!text) {
      continue;
    }

    const words = asArray(readField(alternative, "words"));
    const startTime =
      durationToSeconds(readField(words[0], "startOffset", "start_offset")) ??
      durationToSeconds(readField(result, "resultEndOffset", "result_end_offset")) ??
      0;
    const endTime =
      durationToSeconds(
        readField(words[words.length - 1], "endOffset", "end_offset"),
      ) ??
      durationToSeconds(readField(result, "resultEndOffset", "result_end_offset")) ??
      startTime;
    maxEnd = Math.max(maxEnd, endTime);

    const confidence = numberField(alternative, "confidence");
    segments.push({
      text,
      startTime,
      endTime,
      confidence: confidence ?? undefined,
    });
  }

  if (segments.length === 0) {
    throw new Error(
      "Speech v2 result contained no usable segments; refusing to persist an empty transcript",
    );
  }

  logger.info("Built transcript payload from Speech v2 JSON", {
    component: "transcription",
    videoId,
    segments: segments.length,
    durationSeconds: maxEnd,
  });

  return {
    videoId,
    language: serviceConfig.speechToTextLanguage,
    model: serviceConfig.speechToTextModel,
    durationSeconds: maxEnd,
    segments,
    createdAt: new Date().toISOString(),
  };
}

export async function downloadSpeechResultJson(
  bucketName: string,
  objectName: string,
): Promise<unknown> {
  const [contents] = await getStorageClient()
    .bucket(bucketName)
    .file(objectName)
    .download();
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error(
      `Speech v2 result at gs://${bucketName}/${objectName} is not valid JSON`,
    );
  }
  return parsed;
}

export async function uploadTranscriptPayload(
  videoId: string,
  transcriptId: string,
  transcript: ITranscriptPayload,
): Promise<string> {
  if (!videoId) {
    throw new Error("videoId is required for transcript upload");
  }
  if (!transcript || !Array.isArray(transcript.segments)) {
    throw new Error("Invalid transcript payload");
  }

  const objectPath = normalizedTranscriptObjectPath(videoId, transcriptId);
  const payload = { ...transcript, videoId };
  await getStorageClient()
    .bucket(serviceConfig.transcriptsBucketName)
    .file(objectPath)
    .save(JSON.stringify(payload, null, 2), {
      contentType: "application/json",
    });

  logger.info("Uploaded normalized transcript JSON", {
    component: "transcription",
    videoId,
    transcriptId,
    objectPath,
    bucket: serviceConfig.transcriptsBucketName,
  });
  return `gs://${serviceConfig.transcriptsBucketName}/${objectPath}`;
}

export async function finalizeTranscriptFromRawObject(
  videoId: string,
  transcriptId: string,
  bucketName: string,
  objectName: string,
): Promise<{ gcsPath: string; transcript: ITranscriptPayload }> {
  const parsed = await downloadSpeechResultJson(bucketName, objectName);
  const transcript = buildTranscriptPayload(videoId, parsed);
  const gcsPath = await uploadTranscriptPayload(
    videoId,
    transcriptId,
    transcript,
  );
  return { gcsPath, transcript };
}

function extractSpeechV2Results(parsed: unknown): Record<string, unknown>[] {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Unexpected Speech v2 result JSON: expected an object, got ${describeType(parsed)}`,
    );
  }

  const results = readField(parsed, "results");
  if (!Array.isArray(results)) {
    throw new Error(
      "Unexpected Speech v2 result JSON: missing results[] (BatchRecognizeResults)",
    );
  }

  return results.map((result, index) => {
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(
        `Unexpected Speech v2 result JSON: results[${index}] is not an object`,
      );
    }
    return result as Record<string, unknown>;
  });
}

function firstAlternative(
  result: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const alternatives = asArray(readField(result, "alternatives"));
  const first = alternatives[0];
  if (first === undefined) {
    return undefined;
  }
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throw new Error(
      "Unexpected Speech v2 result JSON: alternatives[0] is not an object",
    );
  }
  return first as Record<string, unknown>;
}

/**
 * Converts a proto3 Duration (string `"1.5s"`) or `{seconds,nanos}` to seconds.
 */
export function durationToSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)s$/);
    if (!match) {
      throw new Error(`Unexpected Speech v2 duration string: ${value}`);
    }
    return Number(match[1]);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const seconds = Number(record.seconds ?? 0);
    const nanos = Number(record.nanos ?? 0);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
      throw new Error(
        `Unexpected Speech v2 duration object: ${JSON.stringify(value)}`,
      );
    }
    return seconds + nanos / 1_000_000_000;
  }
  throw new Error(`Unexpected Speech v2 duration value: ${describeType(value)}`);
}

function readField(
  source: unknown,
  camel: string,
  snake?: string,
): unknown {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  const record = source as Record<string, unknown>;
  if (camel in record) {
    return record[camel];
  }
  if (snake && snake in record) {
    return record[snake];
  }
  return undefined;
}

function stringField(
  source: Record<string, unknown>,
  camel: string,
  snake?: string,
): string | undefined {
  const value = readField(source, camel, snake);
  return typeof value === "string" ? value : undefined;
}

function numberField(
  source: Record<string, unknown>,
  camel: string,
  snake?: string,
): number | undefined {
  const value = readField(source, camel, snake);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}
