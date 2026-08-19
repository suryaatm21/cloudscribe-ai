import { assertTranscriptOutputPrefixes } from "../config";

describe("assertTranscriptOutputPrefixes", () => {
  it("accepts distinct non-overlapping prefixes", () => {
    expect(() =>
      assertTranscriptOutputPrefixes("raw", "normalized"),
    ).not.toThrow();
    expect(() => assertTranscriptOutputPrefixes("ra", "raw")).not.toThrow();
  });

  it("rejects empty prefixes", () => {
    expect(() => assertTranscriptOutputPrefixes("", "normalized")).toThrow(
      /non-empty/,
    );
    expect(() => assertTranscriptOutputPrefixes("raw", "")).toThrow(
      /non-empty/,
    );
  });

  it("rejects identical prefixes", () => {
    expect(() => assertTranscriptOutputPrefixes("raw", "raw")).toThrow(
      /distinct/,
    );
  });

  it("rejects path-prefix overlap that would loop notifications", () => {
    expect(() =>
      assertTranscriptOutputPrefixes("raw", "raw/extra"),
    ).toThrow(/overlap/);
    expect(() =>
      assertTranscriptOutputPrefixes("out/nested", "out"),
    ).toThrow(/overlap/);
  });

  it("does not treat similarly named siblings as overlapping", () => {
    expect(() =>
      assertTranscriptOutputPrefixes("raw", "raw2"),
    ).not.toThrow();
  });
});

describe("serviceConfig load-time validation", () => {
  const tracked = [
    "ENABLE_TRANSCRIPTION",
    "RAW_TRANSCRIPT_PREFIX",
    "NORMALIZED_TRANSCRIPT_PREFIX",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of tracked) {
      original[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of tracked) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    jest.resetModules();
  });

  it("defaults ENABLE_TRANSCRIPTION to false", () => {
    delete process.env.ENABLE_TRANSCRIPTION;
    jest.resetModules();
    const { serviceConfig } = jest.requireActual("../config") as {
      serviceConfig: { enableTranscription: boolean };
    };
    expect(serviceConfig.enableTranscription).toBe(false);
  });

  it("fails fast when configured prefixes overlap", () => {
    process.env.RAW_TRANSCRIPT_PREFIX = "raw";
    process.env.NORMALIZED_TRANSCRIPT_PREFIX = "raw/nested";
    jest.resetModules();
    expect(() => jest.requireActual("../config")).toThrow(/overlap/);
  });
});
