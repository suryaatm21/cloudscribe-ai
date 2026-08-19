import http from "http";
import { AddressInfo } from "net";
import { SpeechJobStartError } from "../transcription";
import { serviceConfig } from "../config";
import {
  claimTranscriptJob,
  getTranscript,
  listTranscriptsForReconcile,
  updateTranscript,
  updateTranscriptStatus,
} from "../firestore";
import {
  finalizeTranscriptFromRawObject,
  inspectBatchRecognizeOperation,
  startTranscriptionJob,
} from "../transcription";
import { app } from "../index";

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

jest.mock("../config", () => ({
  serviceConfig: {
    enableTranscription: true,
    rawTranscriptPrefix: "raw",
    normalizedTranscriptPrefix: "normalized",
    transcriptsBucketName: "atmuri-yt-transcripts",
    reconcileStaleAfterMs: 1,
    environment: "test",
    speechToTextLanguage: "en-US",
    speechToTextModel: "long",
    speechLocation: "us-central1",
    projectId: "yt-clone-385f4",
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

jest.mock("../storage", () => ({
  setupDirectories: jest.fn(),
  audioWorkFileNameFromUri: jest.fn().mockReturnValue(undefined),
  deleteAudioWorkObject: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../health", () => ({
  buildHealthResponse: jest.fn(),
}));

jest.mock("../videoProcessor", () => ({
  processVideo: jest.fn(),
  uidFromVideoId: jest.fn(),
  videoIdFromFileNames: jest.fn(),
}));

jest.mock("../firestore", () => {
  const actual = jest.requireActual("../firestore");
  return {
    ...actual,
    claimTranscriptJob: jest.fn(),
    getTranscript: jest.fn(),
    listTranscriptsForReconcile: jest.fn(),
    updateTranscript: jest.fn(),
    updateTranscriptStatus: jest.fn(),
    isVideoNew: jest.fn(),
    setVideo: jest.fn(),
  };
});

jest.mock("../transcription", () => {
  const actual = jest.requireActual("../transcription");
  return {
    ...actual,
    startTranscriptionJob: jest.fn(),
    inspectBatchRecognizeOperation: jest.fn(),
    finalizeTranscriptFromRawObject: jest.fn(),
  };
});

function pubsubBody(payload: unknown) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      messageId: "m1",
    },
  };
}

function postJson(
  route: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: route,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk as Buffer));
          res.on("end", () => {
            server.close(() => {
              resolve({
                status: res.statusCode ?? 0,
                text: Buffer.concat(chunks).toString("utf8"),
              });
            });
          });
        },
      );
      req.on("error", (err) => {
        server.close(() => reject(err));
      });
      req.write(payload);
      req.end();
    });
  });
}

describe("transcription HTTP endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serviceConfig.enableTranscription = true;
    (updateTranscript as jest.Mock).mockResolvedValue(undefined);
    (updateTranscriptStatus as jest.Mock).mockResolvedValue(undefined);
  });

  describe("POST /transcribe-audio", () => {
    const job = {
      videoId: "uid-1762753390224",
      transcriptId: "primary",
      audioGcsUri: "gs://atmuri-yt-audio-work/uid-1762753390224.flac",
    };

    it("returns 200 without claiming when transcription is disabled", async () => {
      serviceConfig.enableTranscription = false;
      const response = await postJson("/transcribe-audio", pubsubBody(job));
      expect(response.status).toBe(200);
      expect(response.text).toContain("Transcription disabled");
      expect(claimTranscriptJob).not.toHaveBeenCalled();
      expect(startTranscriptionJob).not.toHaveBeenCalled();
    });

    it("acks a missing transcript without creating a failed document", async () => {
      (claimTranscriptJob as jest.Mock).mockResolvedValue({ kind: "missing" });
      const response = await postJson("/transcribe-audio", pubsubBody(job));
      expect(response.status).toBe(200);
      expect(startTranscriptionJob).not.toHaveBeenCalled();
      expect(updateTranscriptStatus).not.toHaveBeenCalled();
    });

    it("does not start Speech for a terminal failed transcript", async () => {
      (claimTranscriptJob as jest.Mock).mockResolvedValue({
        kind: "terminal-failed",
      });
      const response = await postJson("/transcribe-audio", pubsubBody(job));
      expect(response.status).toBe(200);
      expect(response.text).toContain("already failed");
      expect(startTranscriptionJob).not.toHaveBeenCalled();
    });

    it("starts Speech after a successful pending claim and persists the operation", async () => {
      (claimTranscriptJob as jest.Mock).mockResolvedValue({ kind: "claimed" });
      (startTranscriptionJob as jest.Mock).mockResolvedValue("operations/123");
      const response = await postJson("/transcribe-audio", pubsubBody(job));
      expect(response.status).toBe(200);
      expect(response.text).toContain("Transcription job started");
      expect(startTranscriptionJob).toHaveBeenCalledWith(
        job.audioGcsUri,
        job.videoId,
        job.transcriptId,
      );
      expect(updateTranscript).toHaveBeenCalledWith(job.videoId, job.transcriptId, {
        operationName: "operations/123",
      });
    });

    it("records needs_review when the RPC may have started", async () => {
      (claimTranscriptJob as jest.Mock).mockResolvedValue({ kind: "claimed" });
      (startTranscriptionJob as jest.Mock).mockRejectedValue(
        new SpeechJobStartError("deadline exceeded", "maybe-started"),
      );
      const response = await postJson("/transcribe-audio", pubsubBody(job));
      expect(response.status).toBe(200);
      expect(response.text).toContain("needs review");
      expect(updateTranscriptStatus).toHaveBeenCalledWith(
        job.videoId,
        job.transcriptId,
        "needs_review",
        expect.objectContaining({
          error: expect.stringContaining("may have started"),
        }),
      );
    });

    it("records failed when the RPC definitely never started", async () => {
      (claimTranscriptJob as jest.Mock).mockResolvedValue({ kind: "claimed" });
      (startTranscriptionJob as jest.Mock).mockRejectedValue(
        new SpeechJobStartError("Invalid GCS URI", "never-started"),
      );
      const response = await postJson("/transcribe-audio", pubsubBody(job));
      expect(response.status).toBe(200);
      expect(updateTranscriptStatus).toHaveBeenCalledWith(
        job.videoId,
        job.transcriptId,
        "failed",
        expect.objectContaining({ error: "Invalid GCS URI" }),
      );
    });

    it("records needs_review with the operation name when persist fails after accept", async () => {
      (claimTranscriptJob as jest.Mock).mockResolvedValue({ kind: "claimed" });
      (startTranscriptionJob as jest.Mock).mockResolvedValue("operations/123");
      (updateTranscript as jest.Mock).mockRejectedValue(new Error("firestore down"));
      const response = await postJson("/transcribe-audio", pubsubBody(job));
      expect(response.status).toBe(200);
      expect(updateTranscriptStatus).toHaveBeenCalledWith(
        job.videoId,
        job.transcriptId,
        "needs_review",
        expect.objectContaining({
          operationName: "operations/123",
        }),
      );
    });
  });

  describe("POST /transcript-ready", () => {
    const objectName = "raw/uid-1762753390224/primary/out.json";

    it("acks objects from a bucket other than the configured transcripts bucket", async () => {
      const response = await postJson(
        "/transcript-ready",
        pubsubBody({ bucket: "some-other-bucket", name: objectName }),
      );
      expect(response.status).toBe(200);
      expect(finalizeTranscriptFromRawObject).not.toHaveBeenCalled();
      expect(updateTranscriptStatus).not.toHaveBeenCalled();
    });

    it("acks a raw path that is missing the output filename", async () => {
      const response = await postJson(
        "/transcript-ready",
        pubsubBody({
          bucket: "atmuri-yt-transcripts",
          name: "raw/uid-1762753390224/primary",
        }),
      );
      expect(response.status).toBe(200);
      expect(finalizeTranscriptFromRawObject).not.toHaveBeenCalled();
    });

    it("acks extra path components instead of silently truncating them", async () => {
      const response = await postJson(
        "/transcript-ready",
        pubsubBody({
          bucket: "atmuri-yt-transcripts",
          name: "raw/uid-1762753390224/primary/out.json/extra",
        }),
      );
      expect(response.status).toBe(200);
      expect(finalizeTranscriptFromRawObject).not.toHaveBeenCalled();
    });

    it("refuses to create a transcript that was never claimed", async () => {
      (getTranscript as jest.Mock).mockResolvedValue(undefined);
      const response = await postJson(
        "/transcript-ready",
        pubsubBody({ bucket: "atmuri-yt-transcripts", name: objectName }),
      );
      expect(response.status).toBe(200);
      expect(finalizeTranscriptFromRawObject).not.toHaveBeenCalled();
      expect(updateTranscriptStatus).not.toHaveBeenCalled();
    });

    it("refuses to finalize a pending transcript that was never claimed", async () => {
      (getTranscript as jest.Mock).mockResolvedValue({
        videoId: "uid-1762753390224",
        status: "pending",
        language: "en-US",
        model: "long",
      });
      const response = await postJson(
        "/transcript-ready",
        pubsubBody({ bucket: "atmuri-yt-transcripts", name: objectName }),
      );
      expect(response.status).toBe(200);
      expect(finalizeTranscriptFromRawObject).not.toHaveBeenCalled();
    });

    it("normalizes a claimed running transcript", async () => {
      (getTranscript as jest.Mock).mockResolvedValue({
        videoId: "uid-1762753390224",
        status: "running",
        language: "en-US",
        model: "long",
        audioGcsUri: "gs://atmuri-yt-audio-work/uid-1762753390224.flac",
      });
      (finalizeTranscriptFromRawObject as jest.Mock).mockResolvedValue({
        gcsPath: "gs://atmuri-yt-transcripts/normalized/uid-1762753390224/primary.json",
        transcript: {
          segments: [{ text: "Hi", startTime: 0, endTime: 1 }],
          durationSeconds: 1,
        },
      });
      const response = await postJson(
        "/transcript-ready",
        pubsubBody({ bucket: "atmuri-yt-transcripts", name: objectName }),
      );
      expect(response.status).toBe(200);
      expect(response.text).toContain("Transcript normalized");
      expect(updateTranscriptStatus).toHaveBeenCalledWith(
        "uid-1762753390224",
        "primary",
        "done",
        expect.objectContaining({ segmentCount: 1, durationSeconds: 1 }),
      );
    });
  });

  describe("POST /reconcile-transcripts", () => {
    it("recovers a completed Speech job from operation.result", async () => {
      (listTranscriptsForReconcile as jest.Mock).mockResolvedValue([
        {
          id: "primary",
          videoId: "uid-1762753390224",
          status: "running",
          language: "en-US",
          model: "long",
          operationName: "operations/abc",
          claimedAt: { toMillis: () => 0 },
        },
      ]);
      (inspectBatchRecognizeOperation as jest.Mock).mockResolvedValue({
        done: true,
        outputUri:
          "gs://atmuri-yt-transcripts/raw/uid-1762753390224/primary/out.json",
      });
      (finalizeTranscriptFromRawObject as jest.Mock).mockResolvedValue({
        gcsPath:
          "gs://atmuri-yt-transcripts/normalized/uid-1762753390224/primary.json",
        transcript: {
          segments: [{ text: "Hi", startTime: 0, endTime: 1 }],
          durationSeconds: 1,
        },
      });

      const response = await postJson("/reconcile-transcripts", {});
      expect(response.status).toBe(200);
      const body = JSON.parse(response.text) as {
        recovered: number;
        failed: number;
      };
      expect(body.recovered).toBe(1);
      expect(body.failed).toBe(0);
      expect(updateTranscriptStatus).toHaveBeenCalledWith(
        "uid-1762753390224",
        "primary",
        "done",
        expect.objectContaining({ segmentCount: 1 }),
      );
    });

    it("moves a stale running job without operationName to needs_review", async () => {
      (listTranscriptsForReconcile as jest.Mock).mockResolvedValue([
        {
          id: "primary",
          videoId: "uid-1762753390224",
          status: "running",
          language: "en-US",
          model: "long",
          claimedAt: { toMillis: () => 0 },
        },
      ]);
      const response = await postJson("/reconcile-transcripts", {});
      expect(response.status).toBe(200);
      const body = JSON.parse(response.text) as {
        failed: number;
        needsReview: number;
      };
      expect(body.failed).toBe(0);
      expect(body.needsReview).toBe(1);
      expect(updateTranscriptStatus).toHaveBeenCalledWith(
        "uid-1762753390224",
        "primary",
        "needs_review",
        expect.objectContaining({
          error: expect.stringContaining("may have started"),
        }),
      );
    });
  });
});
