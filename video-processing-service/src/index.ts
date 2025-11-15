import express, { Request, Response } from "express";
import { setupDirectories } from "./storage";
import { isVideoNew, setVideo } from "./firestore";
import { processVideo } from "./videoProcessor";
import { buildHealthResponse } from "./health";
import {
  decodePubSubMessage,
  logRequest,
  sendSuccessResponse,
  sendBadRequestResponse,
  sendAcknowledgmentResponse,
} from "./pubsubHandler";
import { logger } from "./logger";

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
