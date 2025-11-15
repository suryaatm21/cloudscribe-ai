import { processVideo } from "../videoProcessor";
import { setVideo } from "../firestore";
import {
  downloadRawVideo,
  convertVideo,
  uploadProcessedVideo,
  deleteRawVideo,
  deleteProcessedVideo,
} from "../storage";

jest.mock("../firestore", () => ({
  setVideo: jest.fn(),
}));

jest.mock("../storage", () => ({
  downloadRawVideo: jest.fn(),
  convertVideo: jest.fn(),
  uploadProcessedVideo: jest.fn(),
  deleteRawVideo: jest.fn(),
  deleteProcessedVideo: jest.fn(),
}));

jest.mock("../config", () => ({
  serviceConfig: {
    processingMaxAttempts: 2,
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
  const videoId = "user123-456";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("processes video successfully on first attempt", async () => {
    (downloadRawVideo as jest.Mock).mockResolvedValue(undefined);
    (convertVideo as jest.Mock).mockResolvedValue(undefined);
    (uploadProcessedVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteRawVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteProcessedVideo as jest.Mock).mockResolvedValue(undefined);

    await expect(
      processVideo("input.mp4", "processed-input.mp4", videoId),
    ).resolves.toBeUndefined();

    expect(setVideo).toHaveBeenCalledWith(videoId, {
      status: "processed",
      filename: "processed-input.mp4",
    });
    expect(deleteRawVideo).toHaveBeenCalledWith("input.mp4");
    expect(deleteProcessedVideo).toHaveBeenCalledWith("processed-input.mp4");
  });

  it("retries up to configured attempts and marks failure", async () => {
    const error = new Error("transient failure");
    (downloadRawVideo as jest.Mock).mockRejectedValue(error);
    (deleteRawVideo as jest.Mock).mockResolvedValue(undefined);
    (deleteProcessedVideo as jest.Mock).mockResolvedValue(undefined);

    await expect(
      processVideo("input.mp4", "processed-input.mp4", videoId),
    ).rejects.toThrow("transient failure");

    expect(setVideo).toHaveBeenLastCalledWith(videoId, { status: "failed" });
    expect(downloadRawVideo).toHaveBeenCalledTimes(2);
  });
});

