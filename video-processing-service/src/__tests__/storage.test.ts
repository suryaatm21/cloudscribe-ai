import ffmpeg from "fluent-ffmpeg";
import {
  extractAudio,
  NoAudioStreamError,
  probeHasAudioStream,
} from "../storage";

jest.mock("../config", () => ({
  serviceConfig: {
    rawVideoBucketName: "raw",
    processedVideoBucketName: "processed",
    audioWorkBucketName: "audio-work",
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

jest.mock("fluent-ffmpeg", () => {
  const mockCommand = {
    noVideo: jest.fn().mockReturnThis(),
    audioChannels: jest.fn().mockReturnThis(),
    audioFrequency: jest.fn().mockReturnThis(),
    audioCodec: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
  };
  const mockFfmpeg = jest.fn(() => mockCommand);
  (mockFfmpeg as jest.Mock & { ffprobe: jest.Mock }).ffprobe = jest.fn();
  return mockFfmpeg;
});

describe("probeHasAudioStream", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns true when ffprobe reports an audio stream", async () => {
    (ffmpeg.ffprobe as jest.Mock).mockImplementation(
      (_path: string, cb: (err: null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: "video" }, { codec_type: "audio" }],
        });
      },
    );

    await expect(probeHasAudioStream("/tmp/sample.mp4")).resolves.toBe(true);
    expect(ffmpeg.ffprobe).toHaveBeenCalled();
  });

  it("returns false when ffprobe reports video-only streams", async () => {
    (ffmpeg.ffprobe as jest.Mock).mockImplementation(
      (_path: string, cb: (err: null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: "video" }],
        });
      },
    );

    await expect(probeHasAudioStream("/tmp/sample.mp4")).resolves.toBe(false);
  });
});

describe("extractAudio", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws NoAudioStreamError without invoking ffmpeg extraction", async () => {
    (ffmpeg.ffprobe as jest.Mock).mockImplementation(
      (_path: string, cb: (err: null, data: unknown) => void) => {
        cb(null, { streams: [{ codec_type: "video" }] });
      },
    );

    await expect(
      extractAudio("processed-input.mp4", "input.flac"),
    ).rejects.toBeInstanceOf(NoAudioStreamError);
    expect(ffmpeg).not.toHaveBeenCalled();
  });
});
