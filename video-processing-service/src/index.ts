import express, { Request, Response } from 'express';
import { setupDirectories } from './storage';
import { isVideoNew, setVideo } from './firestore';
import { processVideo } from './videoProcessor';
import {
  decodePubSubMessage,
  logRequest,
  sendSuccessResponse,
  sendBadRequestResponse,
  sendAcknowledgmentResponse,
} from './pubsubHandler';

const app = express();
app.use(express.json());

setupDirectories();

/**
 * Endpoint to handle video processing requests from Pub/Sub.
 * Receives a message, validates it, and processes the video.
 */
app.post(
  '/process-video',
  async (req: Request, res: Response): Promise<void> => {
    logRequest(req);

    let data;

    try {
      data = decodePubSubMessage(req);
    } catch (error) {
      console.error('Error decoding message:', error);

      if (error instanceof Error && error.message.includes('Bad Request')) {
        sendBadRequestResponse(res, `Bad Request: ${error.message}`);
      } else {
        sendAcknowledgmentResponse(res);
      }
      return;
    }

    const inputFileName = data.name; // Format of <UID>-<DATE>.<EXTENSION>
    const outputFileName = `processed-${inputFileName}`;
    const videoId = inputFileName.split('.')[0]; // Extract video ID from filename

    // Only process video if it's new, otherwise skip to avoid duplicates
    if (!(await isVideoNew(videoId))) {
      sendBadRequestResponse(
        res,
        'Bad Request: video already processed or processing',
      );
      return;
    }

    // Set initial video status as processing
    await setVideo(videoId, {
      id: videoId,
      uid: videoId.split('-')[0],
      status: 'processing',
    });

    try {
      await processVideo(inputFileName, outputFileName, videoId);
      sendSuccessResponse(res, 'Processing completed successfully');
    } catch (err) {
      console.error('Error during video processing:', err);
      sendAcknowledgmentResponse(res);
    }
  },
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Video processing service running at http://localhost:${port}`);
  console.log('Ready to process videos from Pub/Sub');
});
