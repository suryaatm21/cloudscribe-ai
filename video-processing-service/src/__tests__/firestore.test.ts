import {
  createdAtFromVideoId,
  evaluateTranscriptClaim,
  claimTranscriptJob,
  buildTranscriptStatusUpdate,
  shouldApplyTranscriptStatusTransition,
  TranscriptDocument,
  updateTranscriptStatus,
  RECONCILE_TRANSCRIPT_STATUSES,
} from "../firestore";

jest.mock("firebase-admin", () => ({
  credential: { applicationDefault: jest.fn() },
}));

jest.mock("firebase-admin/app", () => ({
  initializeApp: jest.fn(),
}));

jest.mock("firebase-admin/firestore", () => {
  const deleteSentinel = { __fieldValueDelete: true };
  return {
    Firestore: class {
      collection() {
        return this;
      }
      doc() {
        return this;
      }
      runTransaction(fn: (tx: unknown) => unknown) {
        return fn({});
      }
    },
    Timestamp: {
      now: () => ({ seconds: 1, nanoseconds: 0 }),
      fromMillis: (millis: number) => ({
        seconds: Math.floor(millis / 1000),
        nanoseconds: (millis % 1000) * 1e6,
      }),
    },
    FieldValue: { delete: () => deleteSentinel },
  };
});

jest.mock("../logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("createdAtFromVideoId", () => {
  it("recovers the upload time embedded in the video id", () => {
    // 1762755371008 ms -> 2025-11-10T05:36:11.008Z
    expect(createdAtFromVideoId("user123-1762755371008")).toEqual({
      seconds: 1762755371,
      nanoseconds: 8_000_000,
    });
  });

  it("keeps hyphenated uids intact", () => {
    expect(createdAtFromVideoId("my-hyphen-uid-1762755371008")).toEqual({
      seconds: 1762755371,
      nanoseconds: 8_000_000,
    });
  });

  it("returns undefined when there is no trailing timestamp", () => {
    expect(createdAtFromVideoId("plain")).toBeUndefined();
    expect(createdAtFromVideoId("user123-42")).toBeUndefined();
  });

  it("rejects timestamps that would pin a video to the top of the list", () => {
    const farFuture = Date.now() + 90 * 24 * 60 * 60 * 1000;
    expect(createdAtFromVideoId(`user123-${farFuture}`)).toBeUndefined();
    // 2001, before the project existed.
    expect(createdAtFromVideoId("user123-1000000000000")).toBeUndefined();
  });
});

describe("evaluateTranscriptClaim", () => {
  const pending: TranscriptDocument = {
    videoId: "video-1",
    status: "pending",
    source: "batch",
    language: "en-US",
    model: "long",
  };

  it("claims a pending transcript with no operation", () => {
    expect(evaluateTranscriptClaim(pending)).toEqual({ kind: "claimed" });
  });

  it("rejects a missing transcript", () => {
    expect(evaluateTranscriptClaim(undefined)).toEqual({ kind: "missing" });
  });

  it("reuses an existing operation on redelivery", () => {
    expect(
      evaluateTranscriptClaim({
        ...pending,
        status: "running",
        operationName: "operations/already-started",
      }),
    ).toEqual({
      kind: "reuse-operation",
      operationName: "operations/already-started",
    });
  });

  it("rejects a concurrent second start after the first claim", () => {
    expect(
      evaluateTranscriptClaim({
        ...pending,
        status: "running",
      }),
    ).toEqual({ kind: "claim-in-progress" });
  });

  it("acks an already completed transcript", () => {
    expect(
      evaluateTranscriptClaim({
        ...pending,
        status: "done",
      }),
    ).toEqual({ kind: "already-done" });
  });

  it("treats failed as terminal even when an operation name is present", () => {
    expect(
      evaluateTranscriptClaim({
        ...pending,
        status: "failed",
        operationName: "operations/previous",
      }),
    ).toEqual({ kind: "terminal-failed" });
  });

  it("treats no_audio_detected as terminal even when an operation name is present", () => {
    expect(
      evaluateTranscriptClaim({
        ...pending,
        status: "no_audio_detected",
        operationName: "operations/previous",
      }),
    ).toEqual({ kind: "terminal-no-audio" });
  });

  it("does not re-claim a needs_review transcript", () => {
    expect(
      evaluateTranscriptClaim({
        ...pending,
        status: "needs_review",
        error: "Speech RPC may have started",
      }),
    ).toEqual({ kind: "needs-review" });
  });
});

describe("claimTranscriptJob concurrency", () => {
  it("only one of two overlapping claims transitions pending to running", async () => {
    const store: { version: number; data: TranscriptDocument } = {
      version: 0,
      data: {
        videoId: "video-1",
        status: "pending",
        source: "batch",
        language: "en-US",
        model: "long",
      },
    };

    let arrivals = 0;
    let releaseFirstWave: () => void = () => {};
    const firstWave = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });
    let firstWaveReleased = false;

    const { Firestore } = jest.requireMock("firebase-admin/firestore") as {
      Firestore: {
        prototype: {
          runTransaction: (
            fn: (tx: {
              get: () => Promise<{
                exists: boolean;
                id: string;
                data: () => unknown;
              }>;
              set: (
                _ref: unknown,
                mutation: Partial<TranscriptDocument>,
              ) => void;
            }) => Promise<unknown>,
          ) => Promise<unknown>;
        };
      };
    };

    Firestore.prototype.runTransaction = async function runTransaction(fn) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const snapVersion = store.version;
        const snapData = { ...store.data };
        let pendingWrite: Partial<TranscriptDocument> | undefined;
        const result = await fn({
          get: async () => {
            arrivals += 1;
            if (!firstWaveReleased && arrivals >= 2) {
              firstWaveReleased = true;
              releaseFirstWave();
            }
            if (!firstWaveReleased) {
              await firstWave;
            }
            return {
              exists: true,
              id: "primary",
              data: () => ({ ...snapData }),
            };
          },
          set: (_ref, mutation) => {
            pendingWrite = mutation;
          },
        });
        if (store.version !== snapVersion) {
          continue;
        }
        if (pendingWrite) {
          store.data = { ...store.data, ...pendingWrite };
          store.version += 1;
        }
        return result;
      }
      throw new Error("transaction retries exhausted");
    };

    const [first, second] = await Promise.all([
      claimTranscriptJob("video-1", "primary"),
      claimTranscriptJob("video-1", "primary"),
    ]);

    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(["claim-in-progress", "claimed"]);
    expect(store.data.status).toBe("running");
    expect(store.version).toBe(1);
  });
});

describe("transcript status updates", () => {
  const { FieldValue } = jest.requireMock("firebase-admin/firestore") as {
    FieldValue: { delete: () => unknown };
  };

  it("clears a stale error when recovering to done", () => {
    const payload = buildTranscriptStatusUpdate("done", {
      gcsPath: "gs://atmuri-yt-transcripts/normalized/video-1/primary.json",
    });
    expect(payload.status).toBe("done");
    expect(payload.error).toEqual(FieldValue.delete());
    expect(payload.gcsPath).toBe(
      "gs://atmuri-yt-transcripts/normalized/video-1/primary.json",
    );
  });

  it("keeps an explicit error on failed", () => {
    const payload = buildTranscriptStatusUpdate("failed", { error: "boom" });
    expect(payload.error).toBe("boom");
  });

  it("sets completedAt and clears error on no_audio_detected", () => {
    const payload = buildTranscriptStatusUpdate("no_audio_detected", {
      segmentCount: 0,
    });
    expect(payload.status).toBe("no_audio_detected");
    expect(payload.completedAt).toBeDefined();
    expect(payload.error).toEqual(FieldValue.delete());
    expect(payload.segmentCount).toBe(0);
  });

  it("refuses to regress a finished transcript and treats same-status as no transition", () => {
    expect(shouldApplyTranscriptStatusTransition("done", "failed")).toBe(false);
    expect(shouldApplyTranscriptStatusTransition("done", "running")).toBe(false);
    expect(shouldApplyTranscriptStatusTransition("done", "done")).toBe(false);
    expect(shouldApplyTranscriptStatusTransition("needs_review", "done")).toBe(
      true,
    );
    expect(shouldApplyTranscriptStatusTransition("running", "failed")).toBe(
      true,
    );
    expect(shouldApplyTranscriptStatusTransition("running", "running")).toBe(
      false,
    );
    expect(
      shouldApplyTranscriptStatusTransition("no_audio_detected", "failed"),
    ).toBe(false);
    expect(
      shouldApplyTranscriptStatusTransition(
        "no_audio_detected",
        "no_audio_detected",
      ),
    ).toBe(false);
    expect(
      shouldApplyTranscriptStatusTransition("running", "no_audio_detected"),
    ).toBe(true);
  });

  it("excludes no_audio_detected from sweeper candidates", () => {
    expect(RECONCILE_TRANSCRIPT_STATUSES).toEqual(["running", "needs_review"]);
    expect(RECONCILE_TRANSCRIPT_STATUSES).not.toContain("no_audio_detected");
    expect(RECONCILE_TRANSCRIPT_STATUSES).not.toContain("failed");
    expect(RECONCILE_TRANSCRIPT_STATUSES).not.toContain("done");
  });
});

describe("updateTranscriptStatus", () => {
  const setFn = jest.fn();
  let currentStatus: TranscriptDocument["status"] | undefined;
  let previousRunTransaction: (
    fn: (tx: unknown) => unknown,
  ) => unknown | Promise<unknown>;

  beforeEach(() => {
    setFn.mockClear();
    const { Firestore } = jest.requireMock("firebase-admin/firestore") as {
      Firestore: {
        prototype: {
          runTransaction: (fn: (tx: unknown) => unknown) => unknown;
        };
      };
    };
    previousRunTransaction = Firestore.prototype.runTransaction;
    Firestore.prototype.runTransaction = async function runTransaction(fn) {
      return fn({
        get: async () => ({
          exists: currentStatus !== undefined,
          data: () => ({ status: currentStatus, videoId: "video-1" }),
        }),
        set: setFn,
      });
    };
  });

  afterEach(() => {
    const { Firestore } = jest.requireMock("firebase-admin/firestore") as {
      Firestore: {
        prototype: {
          runTransaction: (fn: (tx: unknown) => unknown) => unknown;
        };
      };
    };
    Firestore.prototype.runTransaction = previousRunTransaction;
  });

  it("returns false and does not write when refusing to regress done", async () => {
    currentStatus = "done";
    await expect(
      updateTranscriptStatus("video-1", "primary", "failed", {
        error: "late failure",
      }),
    ).resolves.toBe(false);
    expect(setFn).not.toHaveBeenCalled();
  });

  it("returns true and writes when the transition is applied", async () => {
    currentStatus = "running";
    await expect(
      updateTranscriptStatus("video-1", "primary", "failed", {
        error: "boom",
      }),
    ).resolves.toBe(true);
    expect(setFn).toHaveBeenCalled();
  });

  it("refuses to regress no_audio_detected to failed", async () => {
    currentStatus = "no_audio_detected";
    await expect(
      updateTranscriptStatus("video-1", "primary", "failed", {
        error: "late failure",
      }),
    ).resolves.toBe(false);
    expect(setFn).not.toHaveBeenCalled();
  });

  it("returns false without writing when current already matches next", async () => {
    currentStatus = "done";
    await expect(
      updateTranscriptStatus("video-1", "primary", "done", {
        gcsPath: "gs://atmuri-yt-transcripts/normalized/video-1/primary.json",
      }),
    ).resolves.toBe(false);
    expect(setFn).not.toHaveBeenCalled();

    currentStatus = "no_audio_detected";
    await expect(
      updateTranscriptStatus("video-1", "primary", "no_audio_detected", {
        segmentCount: 0,
      }),
    ).resolves.toBe(false);
    expect(setFn).not.toHaveBeenCalled();
  });

  it("sweeper/notification race: a later done write is not a recovered transition", async () => {
    const store: {
      version: number;
      data: { status: TranscriptDocument["status"]; videoId: string };
    } = {
      version: 0,
      data: { status: "running", videoId: "video-1" },
    };

    let arrivals = 0;
    let releaseFirstWave: () => void = () => {};
    const firstWave = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });
    let firstWaveReleased = false;

    const { Firestore } = jest.requireMock("firebase-admin/firestore") as {
      Firestore: {
        prototype: {
          runTransaction: (
            fn: (tx: {
              get: () => Promise<{
                exists: boolean;
                data: () => unknown;
              }>;
              set: (_ref: unknown, mutation: Record<string, unknown>) => void;
            }) => Promise<unknown>,
          ) => Promise<unknown>;
        };
      };
    };

    Firestore.prototype.runTransaction = async function runTransaction(fn) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const snapVersion = store.version;
        const snapData = { ...store.data };
        let pendingWrite: Record<string, unknown> | undefined;
        const result = await fn({
          get: async () => {
            arrivals += 1;
            if (!firstWaveReleased && arrivals >= 2) {
              firstWaveReleased = true;
              releaseFirstWave();
            }
            if (!firstWaveReleased) {
              await firstWave;
            }
            return {
              exists: true,
              data: () => ({ ...snapData }),
            };
          },
          set: (_ref, mutation) => {
            pendingWrite = mutation;
          },
        });
        if (store.version !== snapVersion) {
          continue;
        }
        if (pendingWrite) {
          store.data = {
            ...store.data,
            ...(pendingWrite as {
              status?: TranscriptDocument["status"];
            }),
          };
          store.version += 1;
        }
        return result;
      }
      throw new Error("transaction retries exhausted");
    };

    const [first, second] = await Promise.all([
      updateTranscriptStatus("video-1", "primary", "done", {
        gcsPath: "gs://atmuri-yt-transcripts/normalized/video-1/primary.json",
      }),
      updateTranscriptStatus("video-1", "primary", "done", {
        gcsPath: "gs://atmuri-yt-transcripts/normalized/video-1/primary.json",
      }),
    ]);

    expect([first, second].sort()).toEqual([false, true]);
    expect(store.data.status).toBe("done");
    expect(store.version).toBe(1);
  });
});
