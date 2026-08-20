import { processVideo, uidFromVideoId, videoIdFromFileNames } from "../videoProcessor";
import { createTranscript, setVideo } from "../firestore";
import {
  downloadRawVideo,
  convertVideo,
  uploadProcessedVideo,
  deleteRawVideo,
  deleteProcessedVideo,
  extractAudio,
  uploadAudioForTranscription,
  deleteAudioWorkFile,
} from "../storage";
import { publishTranscriptionJob } from "../transcriptionQueue";
import { serviceConfig } from "../config";

jest.mock("../firestore", () => ({
  setVideo: jest.fn(),
  createTranscript: jest.fn(),
  updateTranscriptStatus: jest.fn(),
}));

jest.mock("../storage", () => ({
  downloadRawVideo: jest.fn(),
  convertVideo: jest.fn(),
  uploadProcessedVideo: jest.fn(),
  deleteRawVideo: jest.fn(),
  deleteProcessedVideo: jest.fn(),
  extractAudio: jest.fn(),
  uploadAudioForTranscription: jest.fn(),
  deleteAudioWorkFile: jest.fn(),
}));

jest.mock("../transcriptionQueue", () => ({
  publishTranscriptionJob: jest.fn(),
}));

jest.mock("../config", () => ({
  serviceConfig: {
    processingMaxAttempts: 2,
    enableTranscription: false,
    speechToTextLanguage: "en-US",
    speechToTextModel: "long",
  },
}));

jest.mock("../logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("processVideo", () => {
  const videoId = "user123-1762753390224";
  const userId = "user123";

  beforeEach(() => {
    jest.clearAllMocks();
    serviceConfig.enableTranscription = false;
  });

  it("processes video successfully on first attempt", async () => {
    (downloadRawVideo as jest.Mock).mockResolvedValue(undefined);
    (convertVideo as jest.Mock).mockResolvedValue(undefined);
    (uploadProcessedVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteRawVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteProcessedVideo as jest.Mock).mockResolvedValue(undefined);

    await expect(
      processVideo("input.mp4", "processed-input.mp4", videoId, userId),
    ).resolves.toBeUndefined();

    expect(setVideo).toHaveBeenCalledWith(videoId, {
      status: "processed",
      filename: "processed-input.mp4",
      uid: userId,
    });
    expect(deleteRawVideo).toHaveBeenCalledWith("input.mp4");
    expect(deleteProcessedVideo).toHaveBeenCalledWith("processed-input.mp4");
    expect(extractAudio).not.toHaveBeenCalled();
    expect(publishTranscriptionJob).not.toHaveBeenCalled();
  });

  it("queues transcription when ENABLE_TRANSCRIPTION is on", async () => {
    serviceConfig.enableTranscription = true;
    (downloadRawVideo as jest.Mock).mockResolvedValue(undefined);
    (convertVideo as jest.Mock).mockResolvedValue(undefined);
    (uploadProcessedVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteRawVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteProcessedVideo as jest.Mock).mockResolvedValue(undefined);
    (extractAudio as jest.Mock).mockResolvedValue(undefined);
    (uploadAudioForTranscription as jest.Mock).mockResolvedValue(
      "gs://atmuri-yt-audio-work/user123-1762753390224.flac",
    );
    (deleteAudioWorkFile as jest.Mock).mockResolvedValue(undefined);
    (createTranscript as jest.Mock).mockResolvedValue(undefined);
    (publishTranscriptionJob as jest.Mock).mockResolvedValue("mid-1");

    await processVideo("input.mp4", "processed-input.mp4", videoId, userId);

    expect(extractAudio).toHaveBeenCalledWith(
      "processed-input.mp4",
      `${videoId}.flac`,
    );
    expect(createTranscript).toHaveBeenCalledWith(
      videoId,
      "primary",
      expect.objectContaining({
        status: "pending",
        source: "batch",
        audioGcsUri: "gs://atmuri-yt-audio-work/user123-1762753390224.flac",
        userId,
        language: "en-US",
        model: "long",
      }),
    );
    expect(publishTranscriptionJob).toHaveBeenCalledWith({
      videoId,
      transcriptId: "primary",
      audioGcsUri: "gs://atmuri-yt-audio-work/user123-1762753390224.flac",
      userId,
    });
  });

  it("retries up to configured attempts and marks failure", async () => {
    const error = new Error("transient failure");
    (downloadRawVideo as jest.Mock).mockRejectedValue(error);
    (deleteRawVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteProcessedVideo as jest.Mock).mockResolvedValue(undefined);

    await expect(
      processVideo("input.mp4", "processed-input.mp4", videoId, userId),
    ).rejects.toThrow("transient failure");

    expect(setVideo).toHaveBeenLastCalledWith(videoId, {
      status: "failed",
      uid: userId,
    });
    expect(downloadRawVideo).toHaveBeenCalledTimes(2);
  });
});

describe("filename helpers", () => {
  it("keeps dots in the video id except the extension", () => {
    expect(videoIdFromFileNames("user.dot-1762753390224.mp4")).toBe(
      "user.dot-1762753390224",
    );
  });

  it("extracts hyphenated uids by stripping the trailing timestamp", () => {
    expect(uidFromVideoId("my-hyphen-uid-1762753390224")).toBe("my-hyphen-uid");
    expect(uidFromVideoId("plain")).toBeNull();
  });

  it("rejects uids that contain path separators or newlines", () => {
    expect(uidFromVideoId("ab/cd-1762753390224")).toBeNull();
    expect(uidFromVideoId("ab\ncd-1762753390224")).toBeNull();
  });
});
