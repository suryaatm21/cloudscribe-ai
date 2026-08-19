import {
  evaluateTranscriptClaim,
  claimTranscriptJob,
  buildTranscriptStatusUpdate,
  shouldApplyTranscriptStatusTransition,
  TranscriptDocument,
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
    Timestamp: { now: () => ({ seconds: 1, nanoseconds: 0 }) },
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

describe("evaluateTranscriptClaim", () => {
  const pending: TranscriptDocument = {
    videoId: "video-1",
    status: "pending",
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

  it("refuses to regress a done transcript and allows recovery to done", () => {
    expect(shouldApplyTranscriptStatusTransition("done", "failed")).toBe(false);
    expect(shouldApplyTranscriptStatusTransition("done", "running")).toBe(false);
    expect(shouldApplyTranscriptStatusTransition("done", "done")).toBe(true);
    expect(shouldApplyTranscriptStatusTransition("needs_review", "done")).toBe(
      true,
    );
    expect(shouldApplyTranscriptStatusTransition("running", "failed")).toBe(
      true,
    );
  });
});
