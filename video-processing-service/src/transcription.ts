import { SpeechClient, protos } from '@google-cloud/speech';
import { serviceConfig } from './config';
import { getStorageClient } from './storage';
import { logger } from './logger';

const speechClient = new SpeechClient();
const storage = getStorageClient();

type LongRunningRecognizeResponse =
  protos.google.cloud.speech.v1.ILongRunningRecognizeResponse;
type LongRunningRecognizeMetadata =
  protos.google.cloud.speech.v1.ILongRunningRecognizeMetadata;

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

export interface ITranscriptionJobStatus {
  done: boolean;
  progressPercent: number;
  operationName: string;
}

const POLL_INTERVAL_MS = 30000;
const MAX_POLL_ATTEMPTS = 120; // 60 minutes at 30s intervals

export async function startTranscriptionJob(
  audioGcsUri: string,
  referenceId: string,
): Promise<string> {
  const request: protos.google.cloud.speech.v1.ILongRunningRecognizeRequest = {
    audio: { uri: audioGcsUri },
    config: {
      encoding: "FLAC",
      languageCode: serviceConfig.speechToTextLanguage,
      model:
        serviceConfig.speechToTextModel === "short" ? "latest_short" : "latest_long",
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: true,
      profanityFilter: false,
    },
  };

  const [operation] = await speechClient.longRunningRecognize(request);
  if (!operation.name) {
    throw new Error("Speech-to-Text did not return an operation name");
  }
  logger.info("Started transcription job", {
    component: "transcription",
    operationName: operation.name,
    referenceId,
    audioGcsUri,
  });
  return operation.name;
}

export async function pollTranscriptionResult(
  operationName: string,
  videoId: string,
): Promise<ITranscriptPayload> {
  let attempts = 0;
  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts += 1;
    const request = new protos.google.longrunning.GetOperationRequest({
      name: operationName,
    });
    const [operation] = await speechClient.operationsClient.getOperation(request);
    if (operation.done) {
      return buildTranscriptPayload(
        videoId,
        operationName,
        asUint8Array(operation.response?.value),
      );
    }
    const metadata = operation.metadata?.value
      ? (protos.google.cloud.speech.v1.LongRunningRecognizeMetadata.decode(
          asUint8Array(operation.metadata.value) ?? new Uint8Array(),
        ) as LongRunningRecognizeMetadata)
      : undefined;
    logger.info("Transcription still running", {
      component: "transcription",
      operationName,
      attempts,
      progress: metadata?.progressPercent ?? 0,
    });
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Transcription operation ${operationName} did not complete within allotted time`,
  );
}

async function buildTranscriptPayload(
  videoId: string,
  operationName: string,
  responseBuffer?: Uint8Array | null,
): Promise<ITranscriptPayload> {
  if (!responseBuffer) {
    throw new Error(`Transcription response missing for operation ${operationName}`);
  }
  const response =
    protos.google.cloud.speech.v1.LongRunningRecognizeResponse.decode(
      responseBuffer,
    ) as LongRunningRecognizeResponse;
  const segments: ITranscriptSegment[] = [];
  let maxEnd = 0;

  response.results?.forEach((result) => {
    const alternative = result?.alternatives?.[0];
    if (!alternative) {
      return;
    }
    const words = alternative.words ?? [];
    const startTime = durationToSeconds(words[0]?.startTime) ?? 0;
    const endTime = durationToSeconds(words[words.length - 1]?.endTime) ?? startTime;
    maxEnd = Math.max(maxEnd, endTime);
    segments.push({
      text: (alternative.transcript ?? "").trim(),
      startTime,
      endTime,
      confidence: alternative.confidence ?? undefined,
    });
  });

  logger.info("Transcription completed", {
    component: "transcription",
    operationName,
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

export async function uploadTranscriptPayload(
  videoId: string,
  transcript: ITranscriptPayload,
): Promise<string> {
  const bucket = storage.bucket(serviceConfig.transcriptsBucketName);
  const objectPath = `${videoId}/transcript.json`;
  const payload = { ...transcript, videoId };
  await bucket.file(objectPath).save(JSON.stringify(payload, null, 2), {
    contentType: "application/json",
  });
  logger.info("Uploaded transcript JSON", {
    component: "transcription",
    videoId,
    objectPath,
    bucket: serviceConfig.transcriptsBucketName,
  });
  return `gs://${serviceConfig.transcriptsBucketName}/${objectPath}`;
}

function durationToSeconds(
  duration?: protos.google.protobuf.IDuration | null,
): number | undefined {
  if (!duration) {
    return undefined;
  }
  const seconds = Number(duration.seconds ?? 0);
  const nanos = Number(duration.nanos ?? 0);
  return seconds + nanos / 1_000_000_000;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asUint8Array(
  value?: string | Uint8Array | null,
): Uint8Array | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  return Buffer.from(value);
}

