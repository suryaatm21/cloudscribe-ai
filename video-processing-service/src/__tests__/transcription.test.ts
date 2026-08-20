import fs from "fs";
import path from "path";

const mockBatchRecognize = jest.fn();
const mockCheckProgress = jest.fn();
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockDownload = jest.fn();

jest.mock("@google-cloud/speech", () => ({
  v2: {
    SpeechClient: class {
      batchRecognize = mockBatchRecognize;
      checkBatchRecognizeProgress = mockCheckProgress;
    },
  },
}));

jest.mock("../config", () => {
  const { speechApiProcessingStrategy } = jest.requireActual("../config") as {
    speechApiProcessingStrategy: (strategy: string) => string;
  };
  return {
    speechApiProcessingStrategy,
    serviceConfig: {
      speechToTextLanguage: "en-US",
      speechToTextModel: "long",
      transcriptsBucketName: "test-transcripts",
      speechLocation: "us-central1",
      rawTranscriptPrefix: "raw",
      normalizedTranscriptPrefix: "normalized",
      projectId: "yt-clone-385f4",
      speechProcessingStrategy: "STANDARD",
    },
  };
});

jest.mock("../storage", () => ({
  getStorageClient: () => ({
    bucket: () => ({
      file: () => ({
        save: mockSave,
        download: mockDownload,
      }),
    }),
  }),
}));

jest.mock("../logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  buildTranscriptPayload,
  classifySpeechStartFailure,
  downloadSpeechResultJson,
  durationToSeconds,
  inspectBatchRecognizeOperation,
  inspectDecodedBatchRecognizeOperation,
  parseRawTranscriptObjectName,
  PermanentTranscriptParseError,
  NoAudioDetectedError,
  SpeechJobStartError,
  startTranscriptionJob,
  uploadTranscriptPayload,
} from "../transcription";
import { serviceConfig } from "../config";

function buildGaxBatchRecognizeOperation(outputUri: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Operation } = require("google-gax/build/src/longRunningCalls/longrunning");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const speechProtos = require("@google-cloud/speech/build/protos/protos");
  const BatchRecognizeResponse =
    speechProtos.google.cloud.speech.v2.BatchRecognizeResponse;
  const decoded = BatchRecognizeResponse.fromObject({
    results: {
      "gs://audio/sample.flac": {
        cloudStorageResult: { uri: outputUri },
      },
    },
  });
  const grpcOp = {
    name: "operations/abc",
    done: true,
    response: {
      type_url:
        "type.googleapis.com/google.cloud.speech.v2.BatchRecognizeResponse",
      value: BatchRecognizeResponse.encode(decoded).finish(),
    },
  };
  return new Operation(
    grpcOp,
    {
      operationsClient: {
        cancelOperation: async () => ({}),
        getOperationInternal: async () => [grpcOp],
      },
      responseDecoder: (value: Uint8Array) =>
        BatchRecognizeResponse.decode(value),
      metadataDecoder: () => ({}),
    },
    {
      initialRetryDelayMillis: 1,
      retryDelayMultiplier: 1.3,
      maxRetryDelayMillis: 1,
      totalTimeoutMillis: 1,
    },
  );
}

describe("transcription module", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures/speech-v2-batch-results.json"),
      "utf8",
    ),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    serviceConfig.speechProcessingStrategy = "STANDARD";
  });

  it("starts a Speech v2 batchRecognize job and returns the operation name", async () => {
    mockBatchRecognize.mockResolvedValue([{ name: "operations/123" }]);
    const operationName = await startTranscriptionJob(
      "gs://audio/sample.flac",
      "uid-1762753390224",
      "primary",
    );
    expect(operationName).toBe("operations/123");
    expect(mockBatchRecognize).toHaveBeenCalledWith(
      expect.objectContaining({
        recognizer:
          "projects/yt-clone-385f4/locations/us-central1/recognizers/_",
        files: [{ uri: "gs://audio/sample.flac" }],
        recognitionOutputConfig: {
          gcsOutputConfig: {
            uri: "gs://test-transcripts/raw/uid-1762753390224/primary/",
          },
        },
        processingStrategy: "PROCESSING_STRATEGY_UNSPECIFIED",
        config: expect.objectContaining({
          languageCodes: ["en-US"],
          features: expect.objectContaining({
            enableWordTimeOffsets: true,
            enableAutomaticPunctuation: true,
            enableWordConfidence: true,
          }),
        }),
      }),
    );
  });

  it("sends DYNAMIC_BATCHING when that strategy is configured", async () => {
    serviceConfig.speechProcessingStrategy = "DYNAMIC_BATCHING";
    mockBatchRecognize.mockResolvedValue([{ name: "operations/123" }]);
    await startTranscriptionJob(
      "gs://audio/sample.flac",
      "uid-1762753390224",
      "primary",
    );
    expect(mockBatchRecognize).toHaveBeenCalledWith(
      expect.objectContaining({
        processingStrategy: "DYNAMIC_BATCHING",
      }),
    );
    serviceConfig.speechProcessingStrategy = "STANDARD";
  });

  it("rejects an empty or non-gs:// audio URI before the RPC", async () => {
    await expect(
      startTranscriptionJob("", "video-1", "primary"),
    ).rejects.toBeInstanceOf(SpeechJobStartError);
    await expect(
      startTranscriptionJob("https://example.com/a.flac", "video-1", "primary"),
    ).rejects.toMatchObject({
      certainty: "never-started",
    });
    expect(mockBatchRecognize).not.toHaveBeenCalled();
  });

  it("treats a missing operation name as maybe-started", async () => {
    mockBatchRecognize.mockResolvedValue([{}]);
    await expect(
      startTranscriptionJob("gs://audio/sample.flac", "video-1", "primary"),
    ).rejects.toMatchObject({
      message: "Speech-to-Text did not return an operation name",
      certainty: "maybe-started",
    });
  });

  it("classifies deadline exceeded as maybe-started and invalid argument as never-started", () => {
    expect(
      classifySpeechStartFailure({ code: 4, message: "deadline" }),
    ).toEqual({
      certainty: "maybe-started",
      message: "deadline",
    });
    expect(
      classifySpeechStartFailure({ code: 3, message: "bad request" }),
    ).toEqual({
      certainty: "never-started",
      message: "bad request",
    });
  });

  it("maps a realistic Speech v2 GCS result fixture into ITranscriptPayload", () => {
    const payload = buildTranscriptPayload("video-7", fixture);
    expect(payload.videoId).toBe("video-7");
    expect(payload.segments).toHaveLength(2);
    expect(payload.segments[0]).toEqual({
      text: "Hello world.",
      startTime: 0,
      endTime: 1.2,
      confidence: 0.94,
    });
    expect(payload.segments[1].text).toBe("This is a test.");
    expect(payload.durationSeconds).toBe(2.4);
  });

  it("accepts duration objects with seconds and nanos", () => {
    const payload = buildTranscriptPayload("video-8", {
      results: [
        {
          alternatives: [
            {
              transcript: "Hi",
              words: [
                {
                  startOffset: { seconds: "0", nanos: 0 },
                  endOffset: { seconds: "1", nanos: 500000000 },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(payload.segments[0].endTime).toBe(1.5);
  });

  it("fails loudly on unexpected Speech v2 JSON", () => {
    expect(() => buildTranscriptPayload("video-9", null)).toThrow(
      PermanentTranscriptParseError,
    );
    expect(() => buildTranscriptPayload("video-9", { metadata: {} })).toThrow(
      /missing results\[\]/,
    );
    expect(() =>
      buildTranscriptPayload("video-9", { results: [{ alternatives: [] }] }),
    ).toThrow(/has no alternatives/);
  });

  it("marks a well-formed empty results list as no_audio_detected, not failed", () => {
    const emptyResults = { results: [] };
    try {
      buildTranscriptPayload("video-9", emptyResults);
      throw new Error("expected NoAudioDetectedError");
    } catch (error) {
      expect(error).toBeInstanceOf(NoAudioDetectedError);
      expect(error).not.toBeInstanceOf(PermanentTranscriptParseError);
    }
    try {
      buildTranscriptPayload("video-9", {
        results: [{ alternatives: [{ transcript: "   " }] }],
      });
      throw new Error("expected NoAudioDetectedError");
    } catch (error) {
      expect(error).toBeInstanceOf(NoAudioDetectedError);
      expect(error).not.toBeInstanceOf(PermanentTranscriptParseError);
    }
  });

  it("treats a present non-string transcript as a permanent parse error", () => {
    const malformedValues: unknown[] = [17, { text: "nope" }, null];
    for (const transcript of malformedValues) {
      expect(() =>
        buildTranscriptPayload("video-9", {
          results: [{ alternatives: [{ transcript }] }],
        }),
      ).toThrow(PermanentTranscriptParseError);
      expect(() =>
        buildTranscriptPayload("video-9", {
          results: [{ alternatives: [{ transcript }] }],
        }),
      ).toThrow(/transcript is not a string/);
    }
  });

  it("fails the whole payload when a valid segment is mixed with a malformed transcript", () => {
    expect(() =>
      buildTranscriptPayload("video-9", {
        results: [
          {
            alternatives: [
              {
                transcript: "Hello",
                words: [
                  { startOffset: "0s", endOffset: "1s", word: "Hello" },
                ],
              },
            ],
          },
          { alternatives: [{ transcript: 17 }] },
        ],
      }),
    ).toThrow(PermanentTranscriptParseError);
    expect(() =>
      buildTranscriptPayload("video-9", {
        results: [
          {
            alternatives: [
              {
                transcript: "Hello",
                words: [
                  { startOffset: "0s", endOffset: "1s", word: "Hello" },
                ],
              },
            ],
          },
          { alternatives: [{ transcript: 17 }] },
        ],
      }),
    ).not.toThrow(NoAudioDetectedError);
  });

  it("fails loudly on a malformed entry instead of persisting a partial transcript", () => {
    expect(() =>
      buildTranscriptPayload("video-9", {
        results: [
          {
            alternatives: [
              {
                transcript: "Hello",
                words: [
                  { startOffset: "0s", endOffset: "1s", word: "Hello" },
                ],
              },
            ],
          },
          { alternatives: [{ transcript: "oops", words: [] }] },
        ],
      }),
    ).toThrow(/results\[1\] is missing timing/);
  });

  it("requires videoId and non-empty segments before upload", async () => {
    await expect(
      uploadTranscriptPayload("", "primary", {
        videoId: "",
        segments: [],
        durationSeconds: 0,
        language: "en-US",
        model: "long",
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("videoId is required for transcript upload");

    await expect(
      uploadTranscriptPayload(
        "video-9",
        "primary",
        undefined as unknown as never,
      ),
    ).rejects.toThrow("Invalid transcript payload");

    await expect(
      uploadTranscriptPayload("video-9", "primary", {
        videoId: "video-9",
        segments: [],
        durationSeconds: 0,
        language: "en-US",
        model: "long",
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("Invalid transcript payload");
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("uploads normalized transcript JSON", async () => {
    await uploadTranscriptPayload("video-9", "primary", {
      videoId: "video-9",
      segments: [{ text: "Hi", startTime: 0, endTime: 1 }],
      durationSeconds: 1,
      language: "en-US",
      model: "long",
      createdAt: new Date().toISOString(),
    });
    expect(mockSave).toHaveBeenCalledWith(
      expect.stringContaining("video-9"),
      expect.objectContaining({ contentType: "application/json" }),
    );
  });

  it("parses a strict raw/{videoId}/{transcriptId}/{outputFile} object name", () => {
    expect(
      parseRawTranscriptObjectName("raw/uid-1234567890/primary/out.json"),
    ).toEqual({
      videoId: "uid-1234567890",
      transcriptId: "primary",
      outputFile: "out.json",
    });
    expect(parseRawTranscriptObjectName("normalized/x/y.json")).toBeUndefined();
    expect(
      parseRawTranscriptObjectName("raw/uid-1234567890/primary"),
    ).toBeUndefined();
    expect(
      parseRawTranscriptObjectName(
        "raw/uid-1234567890/primary/out.json/extra",
      ),
    ).toBeUndefined();
    expect(
      parseRawTranscriptObjectName("raw/uid-1234567890/primary/../out.json"),
    ).toBeUndefined();
    expect(
      parseRawTranscriptObjectName("raw/uid/new\nline/primary/out.json"),
    ).toBeUndefined();
    expect(durationToSeconds("0.400s")).toBeCloseTo(0.4);
    expect(durationToSeconds("2s")).toBe(2);
  });

  it("refuses empty duration objects instead of coercing them to 0", () => {
    expect(() => durationToSeconds({})).toThrow(PermanentTranscriptParseError);
    expect(() => durationToSeconds({})).toThrow(/duration object/);
  });

  it("classifies invalid Speech JSON as a permanent parse error", async () => {
    mockDownload.mockResolvedValue([Buffer.from("not-json")]);
    await expect(downloadSpeechResultJson("b", "o.json")).rejects.toBeInstanceOf(
      PermanentTranscriptParseError,
    );
  });

  it("reads BatchRecognizeResponse from a real google-gax Operation.result", async () => {
    const outputUri =
      "gs://test-transcripts/raw/uid-1762753390224/primary/out.json";
    const operation = buildGaxBatchRecognizeOperation(outputUri);

    expect(operation.done).toBe(true);
    expect(
      (operation.latestResponse as { results?: unknown }).results,
    ).toBeUndefined();
    expect(operation.result).toBeTruthy();
    expect(
      (operation.result as { results?: unknown }).results,
    ).toBeTruthy();

    const inspection = inspectDecodedBatchRecognizeOperation(operation);
    expect(inspection).toEqual({ done: true, outputUri });

    mockCheckProgress.mockResolvedValue(operation);
    await expect(
      inspectBatchRecognizeOperation("operations/abc"),
    ).resolves.toEqual({ done: true, outputUri });
  });

  it("does not treat the raw LRO envelope as a completed Speech response", () => {
    const inspection = inspectDecodedBatchRecognizeOperation({
      done: true,
      latestResponse: {
        done: true,
        name: "operations/abc",
        results: {
          "gs://audio/sample.flac": {
            cloudStorageResult: {
              uri: "gs://test-transcripts/raw/vid/tid/out.json",
            },
          },
        },
      },
      result: null,
    } as never);
    expect(inspection.done).toBe(true);
    expect(inspection.outputUri).toBeUndefined();
    expect(inspection.error).toMatch(/operation\.result/);
  });
});
