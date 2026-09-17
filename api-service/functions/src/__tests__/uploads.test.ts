import {
  ALLOWED_VIDEO_EXTENSIONS,
  normalizeVideoExtension,
} from "../uploads";

describe("normalizeVideoExtension", () => {
  it("accepts every allowed extension", () => {
    for (const ext of ALLOWED_VIDEO_EXTENSIONS) {
      expect(normalizeVideoExtension(ext)).toBe(ext);
    }
  });

  it("lowercases and trims", () => {
    expect(normalizeVideoExtension("MP4")).toBe("mp4");
    expect(normalizeVideoExtension(" mov ")).toBe("mov");
  });

  // The worker derives the video id by stripping only the final extension,
  // so `{id}.tar.gz` would become video `{id}.tar` there while finalizeUpload
  // writes `{id}`: a document that never gets processed.
  it("rejects multi-part extensions", () => {
    expect(normalizeVideoExtension("tar.gz")).toBeNull();
    expect(normalizeVideoExtension("mp4.mov")).toBeNull();
    expect(normalizeVideoExtension(".mp4")).toBeNull();
  });

  it("rejects path characters and non-video types", () => {
    expect(normalizeVideoExtension("mp4/../x")).toBeNull();
    expect(normalizeVideoExtension("exe")).toBeNull();
    expect(normalizeVideoExtension("")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeVideoExtension(undefined)).toBeNull();
    expect(normalizeVideoExtension(null)).toBeNull();
    expect(normalizeVideoExtension(42)).toBeNull();
    expect(normalizeVideoExtension({})).toBeNull();
  });
});
