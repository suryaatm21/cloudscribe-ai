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

jest.mock("../config", () => ({
  serviceConfig: {
    speechToTextLanguage: "en-US",
    speechToTextModel: "long",
    transcriptsBucketName: "test-transcripts",
    speechLocation: "us-central1",
    rawTranscriptPrefix: "raw",
    normalizedTranscriptPrefix: "normalized",
    projectId: "yt-clone-385f4",
  },
}));

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
  durationToSeconds,
  parseRawTranscriptObjectName,
  startTranscriptionJob,
  uploadTranscriptPayload,
} from "../transcription";

describe("transcription module", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "fixtures/speech-v2-batch-results.json"),
      "utf8",
    ),
  );

  beforeEach(() => {
    jest.clearAllMocks();
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
        processingStrategy: "DYNAMIC_BATCHING",
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

  it("rejects an empty or non-gs:// audio URI", async () => {
    await expect(
      startTranscriptionJob("", "video-1", "primary"),
    ).rejects.toThrow("Invalid GCS URI");
    await expect(
      startTranscriptionJob("https://example.com/a.flac", "video-1", "primary"),
    ).rejects.toThrow("Invalid GCS URI");
    expect(mockBatchRecognize).not.toHaveBeenCalled();
  });

  it("requires an operation name from batchRecognize", async () => {
    mockBatchRecognize.mockResolvedValue([{}]);
    await expect(
      startTranscriptionJob("gs://audio/sample.flac", "video-1", "primary"),
    ).rejects.toThrow("Speech-to-Text did not return an operation name");
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
      /expected an object/,
    );
    expect(() => buildTranscriptPayload("video-9", { metadata: {} })).toThrow(
      /missing results\[\]/,
    );
    expect(() =>
      buildTranscriptPayload("video-9", { results: [{ alternatives: [] }] }),
    ).toThrow(/no usable segments/);
  });

  it("requires videoId and segments before upload", async () => {
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

  it("parses raw/ object names and proto3 duration strings", () => {
    expect(
      parseRawTranscriptObjectName("raw/uid-1234567890/primary/out.json"),
    ).toEqual({ videoId: "uid-1234567890", transcriptId: "primary" });
    expect(parseRawTranscriptObjectName("normalized/x/y.json")).toBeUndefined();
    expect(durationToSeconds("0.400s")).toBeCloseTo(0.4);
    expect(durationToSeconds("2s")).toBe(2);
  });
});
