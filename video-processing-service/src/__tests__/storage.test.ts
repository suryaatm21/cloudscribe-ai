import ffmpeg from "fluent-ffmpeg";
import {
  convertVideo,
  extractAudio,
  NoAudioStreamError,
  TranscodeDeadlineError,
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

/**
 * Fake ffmpeg process. Synthetic (hand-built): it records handlers and lets the
 * test decide when ffmpeg "starts" or "finishes". No real ffmpeg is run.
 */
function fakeFfmpegCommand() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const command: Record<string, any> = {
    handlers,
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
      return command;
    }),
    save: jest.fn(() => command),
    kill: jest.fn(),
    noVideo: jest.fn(() => command),
    audioChannels: jest.fn(() => command),
    audioFrequency: jest.fn(() => command),
    audioCodec: jest.fn(() => command),
  };
  return command;
}

describe("convertVideo deadline", () => {
  const fiftyMinutes = 50 * 60 * 1000;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("SIGKILLs ffmpeg and rejects with TranscodeDeadlineError when it runs past the deadline", async () => {
    const command = fakeFfmpegCommand();
    (ffmpeg as unknown as jest.Mock).mockReturnValueOnce(command);

    const result = convertVideo("in.mp4", "out.mp4", fiftyMinutes);
    const assertion = expect(result).rejects.toBeInstanceOf(TranscodeDeadlineError);

    jest.advanceTimersByTime(fiftyMinutes - 1);
    expect(command.kill).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(command.kill).toHaveBeenCalledWith("SIGKILL");
    await assertion;
    await expect(result).rejects.toThrow(/50 minute deadline/);
  });

  it("repeats the kill if ffmpeg only starts after the deadline already fired", async () => {
    const command = fakeFfmpegCommand();
    (ffmpeg as unknown as jest.Mock).mockReturnValueOnce(command);

    const result = convertVideo("in.mp4", "out.mp4", 1000);
    const assertion = expect(result).rejects.toBeInstanceOf(TranscodeDeadlineError);
    jest.advanceTimersByTime(1000);
    expect(command.kill).toHaveBeenCalledTimes(1);

    command.handlers.start();
    expect(command.kill).toHaveBeenCalledTimes(2);
    await assertion;
  });

  it("does not kill a conversion that finishes in time, and clears the timer", async () => {
    const command = fakeFfmpegCommand();
    (ffmpeg as unknown as jest.Mock).mockReturnValueOnce(command);

    const result = convertVideo("in.mp4", "out.mp4", fiftyMinutes);
    command.handlers.end();
    await expect(result).resolves.toBeUndefined();

    jest.advanceTimersByTime(fiftyMinutes * 2);
    expect(command.kill).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("passes an ordinary ffmpeg error through unchanged", async () => {
    const command = fakeFfmpegCommand();
    (ffmpeg as unknown as jest.Mock).mockReturnValueOnce(command);

    const result = convertVideo("in.mp4", "out.mp4", fiftyMinutes);
    command.handlers.error(new Error("Invalid data found"));
    await expect(result).rejects.toThrow("Invalid data found");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("has no deadline when none is given", async () => {
    const command = fakeFfmpegCommand();
    (ffmpeg as unknown as jest.Mock).mockReturnValueOnce(command);

    const result = convertVideo("in.mp4", "out.mp4");
    expect(jest.getTimerCount()).toBe(0);
    command.handlers.end();
    await expect(result).resolves.toBeUndefined();
  });
});
