import express, { Request, Response } from "express";
import {
  audioWorkFileNameFromUri,
  deleteAudioWorkObject,
  setupDirectories,
} from "./storage";
import {
  claimTranscriptJob,
  getTranscript,
  isVideoNew,
  listRunningTranscripts,
  setVideo,
  timestampToMillis,
  updateTranscript,
  updateTranscriptStatus,
} from "./firestore";
import {
  processVideo,
  uidFromVideoId,
  videoIdFromFileNames,
} from "./videoProcessor";
import { buildHealthResponse } from "./health";
import {
  decodePubSubMessage,
  decodeJsonPayload,
  logRequest,
  sendSuccessResponse,
  sendBadRequestResponse,
  sendAcknowledgmentResponse,
} from "./pubsubHandler";
import { logger } from "./logger";
import {
  finalizeTranscriptFromRawObject,
  GcsObjectNotification,
  inspectBatchRecognizeOperation,
  parseRawTranscriptObjectName,
  startTranscriptionJob,
} from "./transcription";
import { TranscriptionJobPayload } from "./transcriptionQueue";
import { serviceConfig } from "./config";

const app = express();
app.use(express.json());

setupDirectories();

/**
 * Health endpoint to verify service readiness and dependency availability.
 */
app.get("/health", async (_req: Request, res: Response): Promise<void> => {
  try {
    const healthReport = await buildHealthResponse();
    const statusCode = healthReport.status === "ok" ? 200 : 503;
    res.status(statusCode).json(healthReport);
  } catch (error) {
    logger.error("Health check failed", {
      component: "http",
      error: error instanceof Error ? error.message : error,
    });
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      reason: "Unexpected error while computing health report",
    });
  }
});

/**
 * Endpoint to handle video processing requests from Pub/Sub.
 * Receives a message, validates it, and processes the video.
 */
app.post(
  "/process-video",
  async (req: Request, res: Response): Promise<void> => {
    logRequest(req);

    let data;

    try {
      data = decodePubSubMessage(req);
    } catch (error) {
      logger.error("Error decoding Pub/Sub message", {
        component: "pubsubHandler",
        error: error instanceof Error ? error.message : error,
      });
      // Always return 200 to prevent Pub/Sub from retrying malformed messages
      sendAcknowledgmentResponse(res);
      return;
    }

    const inputFileName = data.name; // Format of <UID>-<DATE>.<EXTENSION>
    const outputFileName = `processed-${inputFileName}`;
    const videoId = videoIdFromFileNames(inputFileName);
    const userId = videoId ? uidFromVideoId(videoId) : null;

    if (!videoId || !userId) {
      logger.error("Invalid videoId format", {
        component: "videoProcessor",
        videoId,
        expectedFormat: "{uid}-{timestamp}.{ext}",
      });
      sendAcknowledgmentResponse(res);
      return;
    }

    // Only process video if it's new, otherwise skip to avoid duplicates
    // Return 200 (not 400) so Pub/Sub doesn't retry already-processed videos
    if (!(await isVideoNew(videoId))) {
      sendSuccessResponse(
        res,
        "Video already processed or processing - skipping",
      );
      logger.info("Skipping already processed video", {
        jobId: videoId,
        component: "videoProcessor",
      });
      return;
    }

    await setVideo(videoId, {
      id: videoId,
      uid: userId,
      status: "processing",
    });

    try {
      await processVideo(inputFileName, outputFileName, videoId, userId);
      sendSuccessResponse(res, "Processing completed successfully");
    } catch (err) {
      logger.error("Error during video processing", {
        jobId: videoId,
        component: "videoProcessor",
        error: err instanceof Error ? err.message : err,
      });
      sendAcknowledgmentResponse(res);
    }
  },
);

app.post(
  "/transcribe-audio",
  async (req: Request, res: Response): Promise<void> => {
    logRequest(req);

    let payload: TranscriptionJobPayload;
    try {
      payload = decodeJsonPayload<TranscriptionJobPayload>(req);
    } catch (error) {
      logger.error("Invalid transcription message", {
        component: "transcription",
        error: error instanceof Error ? error.message : error,
      });
      sendBadRequestResponse(res, "Invalid transcription payload");
      return;
    }

    const { videoId, transcriptId, audioGcsUri } = payload;
    if (!videoId || !transcriptId || !audioGcsUri) {
      sendBadRequestResponse(res, "Missing transcription job fields");
      return;
    }

    try {
      const claim = await claimTranscriptJob(videoId, transcriptId);
      if (claim.kind === "missing") {
        logger.error("Transcript metadata not found", {
          component: "transcription",
          videoId,
          transcriptId,
        });
        await updateTranscriptStatus(videoId, transcriptId, "failed", {
          error: "Transcript metadata missing",
        });
        sendAcknowledgmentResponse(res);
        return;
      }

      if (claim.kind === "already-done") {
        sendSuccessResponse(res, "Transcript already completed");
        return;
      }

      if (claim.kind === "reuse-operation") {
        logger.info("Redelivery reused existing Speech operation", {
          component: "transcription",
          videoId,
          transcriptId,
          operationName: claim.operationName,
        });
        sendSuccessResponse(res, "Transcription already running");
        return;
      }

      if (claim.kind === "claim-in-progress") {
        logger.info("Transcription claim already held by another delivery", {
          component: "transcription",
          videoId,
          transcriptId,
        });
        sendSuccessResponse(res, "Transcription claim already in progress");
        return;
      }

      const operationName = await startTranscriptionJob(
        audioGcsUri,
        videoId,
        transcriptId,
      );
      await updateTranscript(videoId, transcriptId, { operationName });
      sendSuccessResponse(res, "Transcription job started");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Transcription job failed to start", {
        component: "transcription",
        videoId: payload.videoId,
        transcriptId: payload.transcriptId,
        error: message,
      });
      await updateTranscriptStatus(payload.videoId, payload.transcriptId, "failed", {
        error: message,
      });
      res.status(500).send("Transcription job failed");
    }
  },
);

app.post(
  "/transcript-ready",
  async (req: Request, res: Response): Promise<void> => {
    logRequest(req);

    let notification: GcsObjectNotification;
    try {
      notification = decodeJsonPayload<GcsObjectNotification>(req);
    } catch (error) {
      logger.error("Invalid transcript-ready message", {
        component: "transcription",
        error: error instanceof Error ? error.message : error,
      });
      sendAcknowledgmentResponse(res);
      return;
    }

    const objectName = notification.name;
    const bucketName = notification.bucket;
    if (!objectName || !bucketName) {
      sendAcknowledgmentResponse(res);
      return;
    }

    if (!objectName.startsWith(`${serviceConfig.rawTranscriptPrefix}/`)) {
      logger.info("Ignoring non-raw transcript object", {
        component: "transcription",
        objectName,
      });
      sendSuccessResponse(res, "Ignored object outside raw/ prefix");
      return;
    }

    const parsedName = parseRawTranscriptObjectName(objectName);
    if (!parsedName) {
      logger.error("Could not parse raw transcript object name", {
        component: "transcription",
        objectName,
      });
      sendAcknowledgmentResponse(res);
      return;
    }

    const { videoId, transcriptId } = parsedName;

    try {
      const transcript = await getTranscript(videoId, transcriptId);
      if (transcript?.status === "done") {
        sendSuccessResponse(res, "Transcript already completed");
        return;
      }

      const { gcsPath, transcript: payload } =
        await finalizeTranscriptFromRawObject(
          videoId,
          transcriptId,
          bucketName,
          objectName,
        );

      await updateTranscriptStatus(videoId, transcriptId, "done", {
        gcsPath,
        segmentCount: payload.segments.length,
        durationSeconds: payload.durationSeconds,
      });

      const audioFileName = audioWorkFileNameFromUri(transcript?.audioGcsUri);
      if (audioFileName) {
        await deleteAudioWorkObject(audioFileName);
      }

      sendSuccessResponse(res, "Transcript normalized");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to finalize transcript", {
        component: "transcription",
        videoId,
        transcriptId,
        error: message,
      });
      await updateTranscriptStatus(videoId, transcriptId, "failed", {
        error: message,
      });
      res.status(500).send("Transcript finalization failed");
    }
  },
);

app.post(
  "/reconcile-transcripts",
  async (_req: Request, res: Response): Promise<void> => {
    const staleAfterMs = serviceConfig.reconcileStaleAfterMs;
    const now = Date.now();
    let inspected = 0;
    let failed = 0;
    let recovered = 0;
    let stillRunning = 0;

    try {
      const running = await listRunningTranscripts();
      for (const transcript of running) {
        const videoId = transcript.videoId;
        const transcriptId = transcript.id;
        if (!videoId || !transcriptId) {
          continue;
        }

        const claimedAt = timestampToMillis(
          transcript.claimedAt ?? transcript.createdAt,
        );
        if (claimedAt !== undefined && now - claimedAt < staleAfterMs) {
          stillRunning += 1;
          continue;
        }

        inspected += 1;

        if (!transcript.operationName) {
          await updateTranscriptStatus(videoId, transcriptId, "failed", {
            error: "Speech job never started after claim",
          });
          failed += 1;
          continue;
        }

        const inspection = await inspectBatchRecognizeOperation(
          transcript.operationName,
        );
        if (!inspection.done) {
          stillRunning += 1;
          continue;
        }

        if (inspection.error) {
          await updateTranscriptStatus(videoId, transcriptId, "failed", {
            error: inspection.error,
          });
          failed += 1;
          continue;
        }

        if (!inspection.outputUri) {
          await updateTranscriptStatus(videoId, transcriptId, "failed", {
            error: "Speech job completed without a GCS result URI",
          });
          failed += 1;
          continue;
        }

        const rawObject = parseGsUri(inspection.outputUri);
        if (!rawObject) {
          await updateTranscriptStatus(videoId, transcriptId, "failed", {
            error: `Unparseable Speech output URI: ${inspection.outputUri}`,
          });
          failed += 1;
          continue;
        }

        const { gcsPath, transcript: payload } =
          await finalizeTranscriptFromRawObject(
            videoId,
            transcriptId,
            rawObject.bucket,
            rawObject.path,
          );
        await updateTranscriptStatus(videoId, transcriptId, "done", {
          gcsPath,
          segmentCount: payload.segments.length,
          durationSeconds: payload.durationSeconds,
        });
        const audioFileName = audioWorkFileNameFromUri(transcript.audioGcsUri);
        if (audioFileName) {
          await deleteAudioWorkObject(audioFileName);
        }
        recovered += 1;
      }

      res.status(200).json({
        inspected,
        failed,
        recovered,
        stillRunning,
      });
    } catch (error) {
      logger.error("Transcript reconciliation failed", {
        component: "transcription",
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).send("Transcript reconciliation failed");
    }
  },
);

function parseGsUri(
  uri: string,
): { bucket: string; path: string } | undefined {
  if (!uri.startsWith("gs://")) {
    return undefined;
  }
  const withoutScheme = uri.slice("gs://".length);
  const slash = withoutScheme.indexOf("/");
  if (slash <= 0 || slash === withoutScheme.length - 1) {
    return undefined;
  }
  return {
    bucket: withoutScheme.slice(0, slash),
    path: withoutScheme.slice(slash + 1),
  };
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info("Video processing service started", {
    component: "bootstrap",
    port,
  });
  logger.info("Ready to process videos from Pub/Sub", {
    component: "bootstrap",
  });
});
