import express, { Request, Response } from "express";
import { setupDirectories } from "./storage";
import {
  getTranscript,
  isVideoNew,
  setVideo,
  updateTranscript,
  updateTranscriptStatus,
} from "./firestore";
import { processVideo } from "./videoProcessor";
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
  pollTranscriptionResult,
  startTranscriptionJob,
  uploadTranscriptPayload,
} from "./transcription";
import { TranscriptionJobPayload } from "./transcriptionQueue";

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
    const videoId = inputFileName.split(".")[0]; // Extract video ID from filename

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

    // Set initial video status as processing
    await setVideo(videoId, {
      id: videoId,
      uid: videoId.split("-")[0],
      status: "processing",
    });

    try {
      await processVideo(inputFileName, outputFileName, videoId);
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
      const transcript = await getTranscript(videoId, transcriptId);
      if (!transcript) {
        await updateTranscriptStatus(videoId, transcriptId, "failed", {
          error: "Transcript metadata missing",
        });
        sendAcknowledgmentResponse(res);
        return;
      }

      if (transcript.status === "done") {
        sendSuccessResponse(res, "Transcript already completed");
        return;
      }

      const operationName =
        transcript.operationName ??
        (await startTranscriptionJob(audioGcsUri, videoId));

      if (!transcript.operationName) {
        await updateTranscript(videoId, transcriptId, { operationName });
      }

      await updateTranscriptStatus(videoId, transcriptId, "running");

      const transcriptPayload = await pollTranscriptionResult(
        operationName,
        videoId,
      );
      const gcsPath = await uploadTranscriptPayload(videoId, transcriptPayload);

      await updateTranscriptStatus(videoId, transcriptId, "done", {
        gcsPath,
        segmentCount: transcriptPayload.segments.length,
        durationSeconds: transcriptPayload.durationSeconds,
      });

      sendSuccessResponse(res, "Transcription completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Transcription job failed", {
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
