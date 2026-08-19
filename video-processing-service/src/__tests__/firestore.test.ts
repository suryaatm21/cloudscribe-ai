import { evaluateTranscriptClaim, TranscriptDocument } from "../firestore";

jest.mock("firebase-admin", () => ({
  credential: { applicationDefault: jest.fn() },
}));

jest.mock("firebase-admin/app", () => ({
  initializeApp: jest.fn(),
}));

jest.mock("firebase-admin/firestore", () => ({
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
});

describe("claimTranscriptJob concurrency", () => {
  it("second caller cannot start after the first claim is reserved", async () => {
    const { claimTranscriptJob } = jest.requireActual("../firestore") as {
      claimTranscriptJob: (
        videoId: string,
        transcriptId: string,
      ) => Promise<{ kind: string; operationName?: string }>;
    };

    const store: { data?: TranscriptDocument } = {
      data: {
        videoId: "video-1",
        status: "pending",
        language: "en-US",
        model: "long",
      },
    };

    const { Firestore } = jest.requireMock("firebase-admin/firestore") as {
      Firestore: new () => {
        runTransaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
        collection: () => unknown;
        doc: () => unknown;
      };
    };

    Firestore.prototype.runTransaction = async function runTransaction(
      fn: (tx: {
        get: () => Promise<{ exists: boolean; id: string; data: () => unknown }>;
        set: (_ref: unknown, mutation: Partial<TranscriptDocument>) => void;
      }) => Promise<unknown>,
    ) {
      return fn({
        get: async () => ({
          exists: Boolean(store.data),
          id: "primary",
          data: () => store.data,
        }),
        set: (_ref, mutation) => {
          store.data = { ...(store.data as TranscriptDocument), ...mutation };
        },
      });
    };

    const first = await claimTranscriptJob("video-1", "primary");
    const second = await claimTranscriptJob("video-1", "primary");

    expect(first).toEqual({ kind: "claimed" });
    expect(second).toEqual({ kind: "claim-in-progress" });
    expect(store.data?.status).toBe("running");
  });
});
