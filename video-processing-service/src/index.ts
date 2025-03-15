import express, { Request, Response } from "express";
import {
  downloadRawVideo,
  convertVideo,
  setupDirectories,
  deleteRawVideo,
  uploadProcessedVideo
} from "./storage";

const app = express();
app.use(express.json());

setupDirectories();

app.post("/process-video", async (req: Request, res: Response): Promise<void> => {
  let data;
  
  try {
    // Ensure body.message.data exists
    if (!req.body?.message?.data) {
      throw new Error("Invalid request: missing data.");
    }

    const message = Buffer.from(req.body.message.data, 'base64').toString('utf8');
    data = JSON.parse(message);
    
    if (!data.name) {
      throw new Error("Invalid message payload received.");
    }
  } catch (error) {
    console.error(error);
    res.status(400).send("Bad Request: missing filename.");
    return;
  }

  const inputFileName = data.name;
  const outputFileName = `processed-${inputFileName}`;

  try {
    await downloadRawVideo(inputFileName);
    await convertVideo(inputFileName, outputFileName);
  } catch (err) {
    console.error("Error during video processing:", err);
    
    await Promise.all([
      deleteRawVideo(inputFileName),
      deleteRawVideo(outputFileName)
    ]);

    res.status(500).send("Internal Server Error: Video processing failed.");
    return;
  }

  try {
    await uploadProcessedVideo(outputFileName);
  } catch (uploadErr) {
    console.error("Upload failed:", uploadErr);
    res.status(500).send("Internal Server Error: Upload failed.");
    return;
  }

  res.status(200).send(`Successfully processed ${inputFileName}`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
