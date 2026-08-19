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

export interface ParsedRawTranscriptObject {
  videoId: string;
  transcriptId: string;
  outputFile: string;
}

export type SpeechStartCertainty = "never-started" | "maybe-started";

export class SpeechJobStartError extends Error {
  readonly certainty: SpeechStartCertainty;

  constructor(message: string, certainty: SpeechStartCertainty) {
    super(message);
    this.name = "SpeechJobStartError";
    this.certainty = certainty;
  }
}

/**
 * Malformed Speech JSON / schema will never become valid on retry.
 * Callers must ack Pub/Sub (200) and mark the transcript failed.
 */
export class PermanentTranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentTranscriptParseError";
  }
}

export function isPermanentTranscriptParseError(
  error: unknown,
): error is PermanentTranscriptParseError {
  return error instanceof PermanentTranscriptParseError;
}

function throwPermanentParse(message: string): never {
  throw new PermanentTranscriptParseError(message);
}

/**
 * gRPC codes that mean the server rejected the request before accepting a
 * batch job. Codes like DEADLINE_EXCEEDED (4) and UNAVAILABLE (14) are
 * omitted: the RPC may already have been accepted.
 */
const NEVER_STARTED_GRPC_CODES = new Set([
  3, // INVALID_ARGUMENT
  5, // NOT_FOUND
  6, // ALREADY_EXISTS
  7, // PERMISSION_DENIED
  9, // FAILED_PRECONDITION
  11, // OUT_OF_RANGE
  16, // UNAUTHENTICATED
]);

const SAFE_OBJECT_ID = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

export function isSafeObjectId(value: string): boolean {
  return SAFE_OBJECT_ID.test(value);
}

function isSafeOutputFile(value: string): boolean {
  if (!value || value.length > 256) {
    return false;
  }
  if (value.includes("/") || /[\n\r\0]/.test(value)) {
    return false;
  }
  if (value === "." || value === ".." || value.includes("..")) {
    return false;
  }
  return true;
}

/**
 * Strict `raw/{videoId}/{transcriptId}/{outputFile}` parser.
 * Extra path components, a missing filename, or unsafe IDs are rejected.
 */
export function parseRawTranscriptObjectName(
  objectName: string,
): ParsedRawTranscriptObject | undefined {
  const prefix = `${serviceConfig.rawTranscriptPrefix}/`;
  if (!objectName.startsWith(prefix)) {
    return undefined;
  }
  const rest = objectName.slice(prefix.length);
  if (!rest || rest.endsWith("/")) {
    return undefined;
  }
  const parts = rest.split("/");
  if (parts.length !== 3) {
    return undefined;
  }
  const [videoId, transcriptId, outputFile] = parts;
  if (
    !isSafeObjectId(videoId) ||
    !isSafeObjectId(transcriptId) ||
    !isSafeOutputFile(outputFile)
  ) {
    return undefined;
  }
  return { videoId, transcriptId, outputFile };
}

export function parseGsUri(
  uri: string,
): { bucket: string; path: string } | undefined {
  if (!uri.startsWith("gs://")) {
    return undefined;
  }
  const withoutScheme = uri.slice("gs://".length);
  const slash = withoutScheme.indexOf("/");
  if (slash <= 0 || slash === withoutScheme.length - 1) {
    return undefined;
  }
  return {
    bucket: withoutScheme.slice(0, slash),
    path: withoutScheme.slice(slash + 1),
  };
}

export function isConfiguredTranscriptsBucket(bucketName: string): boolean {
  return bucketName === serviceConfig.transcriptsBucketName;
}

function speechV2Model(model: string): string {
  if (model === "short" || model === "latest_short") {
    return "short";
  }
  return "long";
}

function grpcStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

export function classifySpeechStartFailure(error: unknown): {
  certainty: SpeechStartCertainty;
  message: string;
} {
  if (error instanceof SpeechJobStartError) {
    return { certainty: error.certainty, message: error.message };
  }
  const message = errorMessage(error);
  const code = grpcStatusCode(error);
  if (code !== undefined && NEVER_STARTED_GRPC_CODES.has(code)) {
    return { certainty: "never-started", message };
  }
  return { certainty: "maybe-started", message };
}

export async function startTranscriptionJob(
  audioGcsUri: string,
  videoId: string,
  transcriptId: string,
): Promise<string> {
  if (!audioGcsUri || !audioGcsUri.startsWith("gs://")) {
    throw new SpeechJobStartError(
      `Invalid GCS URI: ${audioGcsUri}`,
      "never-started",
    );
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

  try {
    const [operation] = await getSpeechClient().batchRecognize(request);
    if (!operation.name) {
      throw new SpeechJobStartError(
        "Speech-to-Text did not return an operation name",
        "maybe-started",
      );
    }

    logger.info("Started transcription job", {
      component: "transcription",
      operationName: operation.name,
      videoId,
      transcriptId,
      outputPrefix,
    });
    return operation.name;
  } catch (error) {
    if (error instanceof SpeechJobStartError) {
      throw error;
    }
    const classified = classifySpeechStartFailure(error);
    throw new SpeechJobStartError(classified.message, classified.certainty);
  }
}

/**
 * Reads a google-gax LRO. The decoded `BatchRecognizeResponse` is
 * `operation.result`. `operation.latestResponse` is the raw LRO envelope
 * and does not contain `results`.
 */
export function inspectDecodedBatchRecognizeOperation(operation: {
  done?: boolean;
  error?: unknown;
  result?: unknown;
}): BatchRecognizeInspection {
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

  const decoded = operation.result;
  if (decoded === null || decoded === undefined || typeof decoded !== "object") {
    return {
      done: true,
      error:
        "Speech job completed without a BatchRecognizeResponse in operation.result",
    };
  }

  const resultsField = (decoded as { results?: unknown }).results;
  const fileResults = mapValues(resultsField);
  if (fileResults.length === 0) {
    return {
      done: true,
      error: "Speech job completed without a GCS result URI",
    };
  }

  const firstError = fileResults.find((file) => {
    if (typeof file !== "object" || file === null) {
      return false;
    }
    const error = (file as { error?: { message?: string | null } | null }).error;
    return Boolean(error?.message);
  }) as { error?: { message?: string | null } | null } | undefined;
  if (firstError?.error?.message) {
    return { done: true, error: firstError.error.message };
  }

  const outputUri = fileResults
    .map((file) => outputUriFromFileResult(file))
    .find((uri): uri is string => Boolean(uri));
  return {
    done: true,
    outputUri,
  };
}

export async function inspectBatchRecognizeOperation(
  operationName: string,
): Promise<BatchRecognizeInspection> {
  if (!operationName) {
    throw new Error("Operation name is required to inspect a Speech job");
  }

  const operation =
    await getSpeechClient().checkBatchRecognizeProgress(operationName);
  return inspectDecodedBatchRecognizeOperation(operation);
}

export function buildTranscriptPayload(
  videoId: string,
  parsed: unknown,
): ITranscriptPayload {
  const results = extractSpeechV2Results(parsed);
  const segments: ITranscriptSegment[] = [];
  let maxEnd = 0;

  results.forEach((result, index) => {
    const alternative = firstAlternative(result, index);
    const text = stringField(alternative, "transcript")?.trim() ?? "";
    if (!text) {
      throwPermanentParse(
        `Unexpected Speech v2 result JSON: results[${index}] is missing transcript text`,
      );
    }

    const words = asArray(readField(alternative, "words"));
    const startTime =
      durationToSeconds(readField(words[0], "startOffset", "start_offset")) ??
      durationToSeconds(readField(result, "resultEndOffset", "result_end_offset"));
    const endTime =
      durationToSeconds(
        readField(words[words.length - 1], "endOffset", "end_offset"),
      ) ??
      durationToSeconds(readField(result, "resultEndOffset", "result_end_offset"));
    if (startTime === undefined || endTime === undefined) {
      throwPermanentParse(
        `Unexpected Speech v2 result JSON: results[${index}] is missing timing`,
      );
    }
    maxEnd = Math.max(maxEnd, endTime);

    const confidence = numberField(alternative, "confidence");
    segments.push({
      text,
      startTime,
      endTime,
      confidence: confidence ?? undefined,
    });
  });

  if (segments.length === 0) {
    throwPermanentParse(
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
    throwPermanentParse(
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
  if (
    !transcript ||
    !Array.isArray(transcript.segments) ||
    transcript.segments.length === 0
  ) {
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

function mapValues(value: unknown): unknown[] {
  if (!value) {
    return [];
  }
  if (value instanceof Map) {
    return [...value.values()];
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>);
  }
  return [];
}

function outputUriFromFileResult(file: unknown): string | undefined {
  if (typeof file !== "object" || file === null) {
    return undefined;
  }
  const record = file as {
    cloudStorageResult?: { uri?: string | null } | null;
    uri?: string | null;
  };
  return record.cloudStorageResult?.uri ?? record.uri ?? undefined;
}

function extractSpeechV2Results(parsed: unknown): Record<string, unknown>[] {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throwPermanentParse(
      `Unexpected Speech v2 result JSON: expected an object, got ${describeType(parsed)}`,
    );
  }

  const results = readField(parsed, "results");
  if (!Array.isArray(results)) {
    throwPermanentParse(
      "Unexpected Speech v2 result JSON: missing results[] (BatchRecognizeResults)",
    );
  }

  return results.map((result, index) => {
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throwPermanentParse(
        `Unexpected Speech v2 result JSON: results[${index}] is not an object`,
      );
    }
    return result as Record<string, unknown>;
  });
}

function firstAlternative(
  result: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const alternatives = asArray(readField(result, "alternatives"));
  const first = alternatives[0];
  if (first === undefined) {
    throwPermanentParse(
      `Unexpected Speech v2 result JSON: results[${index}] has no alternatives`,
    );
  }
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throwPermanentParse(
      `Unexpected Speech v2 result JSON: results[${index}].alternatives[0] is not an object`,
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
      throwPermanentParse(`Unexpected Speech v2 duration string: ${value}`);
    }
    return Number(match[1]);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (!("seconds" in record) && !("nanos" in record)) {
      throwPermanentParse(
        `Unexpected Speech v2 duration object: ${JSON.stringify(value)}`,
      );
    }
    const seconds = Number(record.seconds ?? 0);
    const nanos = Number(record.nanos ?? 0);
    if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
      throwPermanentParse(
        `Unexpected Speech v2 duration object: ${JSON.stringify(value)}`,
      );
    }
    return seconds + nanos / 1_000_000_000;
  }
  throwPermanentParse(
    `Unexpected Speech v2 duration value: ${describeType(value)}`,
  );
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
