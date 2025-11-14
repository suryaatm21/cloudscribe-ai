import express, { Request, Response } from "express";
import { setupDirectories } from "./storage";
import { isVideoNew, setVideo } from "./firestore";
import { processVideo } from "./videoProcessor";
import {
  decodePubSubMessage,
  logRequest,
  sendSuccessResponse,
  sendBadRequestResponse,
  sendAcknowledgmentResponse,
} from "./pubsubHandler";

const app = express();
app.use(express.json());

setupDirectories();

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
      console.error("Error decoding message:", error);
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
      console.error("Error during video processing:", err);
      sendAcknowledgmentResponse(res);
    }
  },
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Video processing service running at http://localhost:${port}`);
  console.log("Ready to process videos from Pub/Sub");
});
