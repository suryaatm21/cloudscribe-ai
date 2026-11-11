import {
  assertTranscriptOutputPrefixes,
  parseSpeechProcessingStrategy,
  speechApiProcessingStrategy,
} from "../config";

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
    "SPEECH_PROCESSING_STRATEGY",
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

  it("does not crash the process when prefixes overlap and transcription is off", () => {
    process.env.RAW_TRANSCRIPT_PREFIX = "raw";
    process.env.NORMALIZED_TRANSCRIPT_PREFIX = "raw/nested";
    delete process.env.ENABLE_TRANSCRIPTION;
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    jest.resetModules();
    expect(() => jest.requireActual("../config")).not.toThrow();
    const { serviceConfig } = jest.requireActual("../config") as {
      serviceConfig: { enableTranscription: boolean };
    };
    expect(serviceConfig.enableTranscription).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringMatching(/overlap/),
    );
    consoleError.mockRestore();
  });

  it("fails fast at import when prefixes overlap and transcription is enabled", () => {
    process.env.ENABLE_TRANSCRIPTION = "true";
    process.env.RAW_TRANSCRIPT_PREFIX = "raw";
    process.env.NORMALIZED_TRANSCRIPT_PREFIX = "raw/nested";
    jest.resetModules();
    expect(() => jest.requireActual("../config")).toThrow(/overlap/);
  });

  it("defaults SPEECH_PROCESSING_STRATEGY to STANDARD", () => {
    delete process.env.SPEECH_PROCESSING_STRATEGY;
    jest.resetModules();
    const { serviceConfig } = jest.requireActual("../config") as {
      serviceConfig: { speechProcessingStrategy: string };
    };
    expect(serviceConfig.speechProcessingStrategy).toBe("STANDARD");
  });

  it("accepts DYNAMIC_BATCHING", () => {
    process.env.SPEECH_PROCESSING_STRATEGY = "DYNAMIC_BATCHING";
    jest.resetModules();
    const { serviceConfig } = jest.requireActual("../config") as {
      serviceConfig: { speechProcessingStrategy: string };
    };
    expect(serviceConfig.speechProcessingStrategy).toBe("DYNAMIC_BATCHING");
  });

  it("fails at import on an unrecognized SPEECH_PROCESSING_STRATEGY", () => {
    process.env.SPEECH_PROCESSING_STRATEGY = "FAST";
    jest.resetModules();
    expect(() => jest.requireActual("../config")).toThrow(
      /Unrecognized SPEECH_PROCESSING_STRATEGY/,
    );
  });
});

describe("parseSpeechProcessingStrategy", () => {
  it("maps STANDARD to PROCESSING_STRATEGY_UNSPECIFIED and DYNAMIC_BATCHING through", () => {
    expect(parseSpeechProcessingStrategy(undefined)).toBe("STANDARD");
    expect(parseSpeechProcessingStrategy("")).toBe("STANDARD");
    expect(parseSpeechProcessingStrategy("STANDARD")).toBe("STANDARD");
    expect(parseSpeechProcessingStrategy("DYNAMIC_BATCHING")).toBe(
      "DYNAMIC_BATCHING",
    );
    expect(speechApiProcessingStrategy("STANDARD")).toBe(
      "PROCESSING_STRATEGY_UNSPECIFIED",
    );
    expect(speechApiProcessingStrategy("DYNAMIC_BATCHING")).toBe(
      "DYNAMIC_BATCHING",
    );
    expect(() => parseSpeechProcessingStrategy("dynamic_batching")).toThrow(
      /Unrecognized/,
    );
  });
});
