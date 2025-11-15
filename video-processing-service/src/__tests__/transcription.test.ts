const mockLongRunningRecognize = jest.fn();
const mockGetOperation = jest.fn();
const mockResponseDecode = jest.fn();
const mockMetadataDecode = jest.fn();
const mockSave = jest.fn().mockResolvedValue(undefined);

jest.mock("@google-cloud/speech", () => {
  class MockGetOperationRequest {
    public name?: string;
    constructor(props?: { name?: string }) {
      this.name = props?.name;
    }
  }
  return {
    SpeechClient: class {
      longRunningRecognize = mockLongRunningRecognize;
      getOperation = mockGetOperation;
      operationsClient = {
        getOperation: mockGetOperation,
      };
    },
    protos: {
      google: {
        cloud: {
          speech: {
            v1p1beta1: {
              LongRunningRecognizeResponse: { decode: mockResponseDecode },
              LongRunningRecognizeMetadata: { decode: mockMetadataDecode },
            },
            v1: {
              LongRunningRecognizeResponse: { decode: mockResponseDecode },
              LongRunningRecognizeMetadata: { decode: mockMetadataDecode },
            },
          },
        },
        longrunning: {
          GetOperationRequest: MockGetOperationRequest,
        },
      },
    },
  };
});

jest.mock("../config", () => ({
  serviceConfig: {
    speechToTextLanguage: "en-US",
    speechToTextModel: "long",
    transcriptsBucketName: "test-transcripts",
  },
}));

jest.mock("../storage", () => ({
  getStorageClient: () => ({
    bucket: () => ({
      file: () => ({
        save: mockSave,
      }),
    }),
  }),
}));

import {
  pollTranscriptionResult,
  startTranscriptionJob,
  uploadTranscriptPayload,
} from "../transcription";

describe("transcription module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts transcription job and returns operation name", async () => {
    mockLongRunningRecognize.mockResolvedValue([{ name: "operations/123" }]);
    const operationName = await startTranscriptionJob(
      "gs://audio/sample.flac",
      "job-1",
    );
    expect(operationName).toBe("operations/123");
    expect(mockLongRunningRecognize).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: { uri: "gs://audio/sample.flac" },
        config: expect.objectContaining({
          languageCode: "en-US",
        }),
      }),
    );
  });

  it("polls transcription result and maps segments", async () => {
    mockResponseDecode.mockReturnValue({
      results: [
        {
          alternatives: [
            {
              transcript: "Hello world",
              confidence: 0.92,
              words: [
                { startTime: { seconds: 0 }, endTime: { seconds: 2 } },
                { startTime: { seconds: 2 }, endTime: { seconds: 4 } },
              ],
            },
          ],
        },
      ],
    });
    mockGetOperation.mockResolvedValue([
      {
        done: true,
        response: { value: Buffer.from("mock") },
      },
    ]);

    const payload = await pollTranscriptionResult("operations/123", "video-7");
    expect(payload.videoId).toBe("video-7");
    expect(payload.segments).toHaveLength(1);
    expect(payload.segments[0].text).toBe("Hello world");
    expect(payload.durationSeconds).toBe(4);
  });

  it("uploads transcript JSON to storage", async () => {
    await uploadTranscriptPayload("video-9", {
      videoId: "video-9",
      segments: [],
      durationSeconds: 0,
      language: "en-US",
      model: "long",
      createdAt: new Date().toISOString(),
    });
    expect(mockSave).toHaveBeenCalledWith(
      expect.stringContaining("video-9"),
      expect.objectContaining({ contentType: "application/json" }),
    );
  });
});

