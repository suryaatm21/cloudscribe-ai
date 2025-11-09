import express, { Request, Response } from "express";
import {
  downloadRawVideo,
  convertVideo,
  setupDirectories,
  deleteRawVideo,
  uploadProcessedVideo,
  deleteProcessedVideo,
} from "./storage";

const app = express();
app.use(express.json());

setupDirectories();

app.post(
  "/process-video",
  async (req: Request, res: Response): Promise<void> => {
    // Log the incoming request for debugging
    console.log(
      "Received request:",
      JSON.stringify(
        {
          headers: req.headers,
          body: req.body,
        },
        null,
        2
      )
    );

    let data;

    try {
      // Ensure body.message.data exists (Pub/Sub format)
      if (!req.body?.message?.data) {
        console.error("No message data found in request");
        res.status(400).send("Bad Request: missing message data");
        return;
      }

      const message = Buffer.from(req.body.message.data, "base64").toString(
        "utf8"
      );
      console.log("Decoded message:", message);

      try {
        data = JSON.parse(message);
      } catch (parseError) {
        console.error("Failed to parse message:", parseError);
        res.status(400).send("Bad Request: invalid JSON in message");
        return;
      }

      if (!data.name) {
        console.error("No filename in message payload");
        res.status(400).send("Bad Request: missing filename in payload");
        return;
      }
    } catch (error) {
      console.error("Error processing request:", error);
      // Always return 200 for Pub/Sub to acknowledge the message was received
      // even if we couldn't process it to prevent redelivery of malformed messages
      res.status(200).send("Message acknowledged, but processing failed");
      return;
    }

    const inputFileName = data.name;
    const outputFileName = `processed-${inputFileName}`;

    try {
      console.log(`Starting processing for file: ${inputFileName}`);
      await downloadRawVideo(inputFileName);
      await convertVideo(inputFileName, outputFileName);
      await uploadProcessedVideo(outputFileName);

      // Clean up files after successful processing
      await Promise.all([
        deleteRawVideo(inputFileName),
        deleteProcessedVideo(outputFileName),
      ]);

      console.log(`Successfully processed video: ${inputFileName}`);
      // Return 200 to acknowledge the message
      res.status(200).send("Processing completed successfully");
    } catch (err) {
      console.error("Error during video processing:", err);

      // Clean up any partial files
      try {
        await Promise.all([
          deleteRawVideo(inputFileName),
          deleteProcessedVideo(outputFileName),
        ]);
      } catch (cleanupErr) {
        console.error("Error during cleanup:", cleanupErr);
      }

      // Still return 200 to acknowledge receipt of the message
      // This prevents Pub/Sub from retrying failed messages
      res.status(200).send("Message acknowledged, but processing failed");
    }
  }
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Video processing service running at http://localhost:${port}`);
  console.log("Ready to process videos from Pub/Sub");
});
