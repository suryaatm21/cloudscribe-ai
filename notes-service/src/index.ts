import express, { Request, Response } from "express";
import { serviceConfig } from "./config";
import { logger } from "./logger";
import { buildHealthReport } from "./health";
import { decodePubSubMessage, acknowledge, badRequest } from "./pubsubHandler";
import { handleNotesJob, NotesJobPayload } from "./notesGenerator";

const app = express();
app.use(express.json());

app.get("/health", async (_req: Request, res: Response) => {
  try {
    const report = await buildHealthReport();
    res.status(200).json(report);
  } catch (error) {
    logger.error("Health check failed", {
      component: "health",
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({ status: "degraded" });
  }
});

app.post("/notes/:jobId?", async (req: Request, res: Response) => {
  let payload: NotesJobPayload;
  try {
    payload = decodePubSubMessage<NotesJobPayload>(req);
  } catch (error) {
    badRequest(res, error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    const result = await handleNotesJob(payload);
    acknowledge(res);
    logger.info("Notes job completed", {
      component: "http",
      videoId: payload.videoId,
      transcriptId: payload.transcriptId,
      result,
    });
  } catch (error) {
    logger.error("Notes job failed", {
      component: "http",
      videoId: payload.videoId,
      transcriptId: payload.transcriptId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).send("Notes generation failed");
  }
});

app.listen(serviceConfig.port, () => {
  logger.info("Notes service started", {
    component: "bootstrap",
    port: serviceConfig.port,
    service: serviceConfig.serviceName,
  });
});
