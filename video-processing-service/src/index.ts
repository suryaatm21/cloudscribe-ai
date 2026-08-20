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
  listTranscriptsForReconcile,
  setVideo,
  timestampToMillis,
  updateTranscript,
  updateTranscriptStatus,
  wasTranscriptClaimed,
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
  sendAcknowledgmentResponse,
} from "./pubsubHandler";
import { logger } from "./logger";
import {
  classifySpeechStartFailure,
  finalizeTranscriptFromRawObject,
  GcsObjectNotification,
  inspectBatchRecognizeOperation,
  isConfiguredTranscriptsBucket,
  isNoAudioDetectedError,
  isPermanentTranscriptParseError,
  parseGsUri,
  parseRawTranscriptObjectName,
  startTranscriptionJob,
} from "./transcription";
import { TranscriptionJobPayload } from "./transcriptionQueue";
import { serviceConfig } from "./config";

export const app = express();
app.use(express.json());

setupDirectories();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function persistNoAudioDetected(
  videoId: string,
  transcriptId: string,
  audioGcsUri: string | undefined,
): Promise<boolean> {
  const applied = await updateTranscriptStatus(
    videoId,
    transcriptId,
    "no_audio_detected",
    {
      segmentCount: 0,
      durationSeconds: 0,
    },
  );
  const audioFileName = audioWorkFileNameFromUri(audioGcsUri);
  if (audioFileName) {
    try {
      await deleteAudioWorkObject(audioFileName);
    } catch (cleanupError) {
      logger.warn("Failed to delete audio work object after no_audio_detected", {
        component: "transcription",
        videoId,
        transcriptId,
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : cleanupError,
      });
    }
  }
  return applied;
}

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

    if (!serviceConfig.enableTranscription) {
      logger.info("Skipping transcription; ENABLE_TRANSCRIPTION is false", {
        component: "transcription",
      });
      sendSuccessResponse(res, "Transcription disabled");
      return;
    }

    let payload: TranscriptionJobPayload;
    try {
      payload = decodeJsonPayload<TranscriptionJobPayload>(req);
    } catch (error) {
      logger.error("Invalid transcription message", {
        component: "transcription",
        error: error instanceof Error ? error.message : error,
      });
      // Pub/Sub retries any non-2xx until the dead-letter limit. A malformed
      // payload will never become valid, so ack it.
      sendAcknowledgmentResponse(res);
      return;
    }

    const { videoId, transcriptId, audioGcsUri } = payload;
    if (
      !isNonEmptyString(videoId) ||
      !isNonEmptyString(transcriptId) ||
      !isNonEmptyString(audioGcsUri)
    ) {
      logger.error("Transcription job payload has invalid required fields", {
        component: "transcription",
        videoIdType: typeof videoId,
        transcriptIdType: typeof transcriptId,
        audioGcsUriType: typeof audioGcsUri,
      });
      sendAcknowledgmentResponse(res);
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
        sendAcknowledgmentResponse(res);
        return;
      }

      if (claim.kind === "already-done") {
        sendSuccessResponse(res, "Transcript already completed");
        return;
      }

      if (claim.kind === "terminal-failed") {
        sendSuccessResponse(res, "Transcript already failed");
        return;
      }

      if (claim.kind === "terminal-no-audio") {
        sendSuccessResponse(res, "No speech detected");
        return;
      }

      if (claim.kind === "needs-review") {
        sendSuccessResponse(res, "Transcript start needs review");
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

      let operationName: string;
      try {
        operationName = await startTranscriptionJob(
          audioGcsUri,
          videoId,
          transcriptId,
        );
      } catch (startError) {
        const classified = classifySpeechStartFailure(startError);
        if (classified.certainty === "never-started") {
          logger.error("Speech RPC definitely never started", {
            component: "transcription",
            videoId,
            transcriptId,
            error: classified.message,
          });
          await updateTranscriptStatus(videoId, transcriptId, "failed", {
            error: classified.message,
          });
          sendSuccessResponse(res, "Transcription job rejected");
          return;
        }

        logger.error("Speech RPC may have started; leaving for review", {
          component: "transcription",
          videoId,
          transcriptId,
          error: classified.message,
        });
        await updateTranscriptStatus(videoId, transcriptId, "needs_review", {
          error: `Speech RPC may have started: ${classified.message}`,
        });
        sendSuccessResponse(res, "Transcription start needs review");
        return;
      }

      try {
        await updateTranscript(videoId, transcriptId, { operationName });
        sendSuccessResponse(res, "Transcription job started");
      } catch (persistError) {
        const message =
          persistError instanceof Error
            ? persistError.message
            : String(persistError);
        logger.error("Speech accepted the job but operationName persist failed", {
          component: "transcription",
          videoId,
          transcriptId,
          operationName,
          error: message,
        });
        await updateTranscriptStatus(videoId, transcriptId, "needs_review", {
          operationName,
          error: `Speech accepted the job but persisting operationName failed: ${message}`,
        });
        sendSuccessResponse(res, "Transcription start needs review");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Transcription claim path failed", {
        component: "transcription",
        videoId: payload.videoId,
        transcriptId: payload.transcriptId,
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
    if (!isNonEmptyString(objectName) || !isNonEmptyString(bucketName)) {
      logger.error("Transcript-ready payload has invalid bucket or object name", {
        component: "transcription",
        objectNameType: typeof objectName,
        bucketNameType: typeof bucketName,
      });
      sendAcknowledgmentResponse(res);
      return;
    }

    if (!isConfiguredTranscriptsBucket(bucketName)) {
      logger.error("Ignoring transcript object from unexpected bucket", {
        component: "transcription",
        bucketName,
        objectName,
      });
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
    let audioGcsUri: string | undefined;

    try {
      const transcript = await getTranscript(videoId, transcriptId);
      audioGcsUri = transcript?.audioGcsUri;
      if (!wasTranscriptClaimed(transcript)) {
        logger.error("Refusing to finalize an unclaimed transcript", {
          component: "transcription",
          videoId,
          transcriptId,
          status: transcript?.status,
        });
        sendAcknowledgmentResponse(res);
        return;
      }

      if (transcript?.status === "done") {
        sendSuccessResponse(res, "Transcript already completed");
        return;
      }

      if (transcript?.status === "no_audio_detected") {
        sendSuccessResponse(res, "No speech detected");
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
      if (isNoAudioDetectedError(error)) {
        logger.info("Speech returned no usable speech segments", {
          component: "transcription",
          videoId,
          transcriptId,
        });
        try {
          await persistNoAudioDetected(
            videoId,
            transcriptId,
            audioGcsUri,
          );
        } catch (statusError) {
          logger.error("Failed to persist no_audio_detected", {
            component: "transcription",
            videoId,
            transcriptId,
            error:
              statusError instanceof Error
                ? statusError.message
                : statusError,
          });
          res.status(500).send("Transcript finalization failed");
          return;
        }
        sendSuccessResponse(res, "No speech detected");
        return;
      }
      if (isPermanentTranscriptParseError(error)) {
        logger.error(
          "Permanent Speech result parse/schema failure; acking without retry",
          {
            component: "transcription",
            videoId,
            transcriptId,
            error: message,
          },
        );
        try {
          await updateTranscriptStatus(videoId, transcriptId, "failed", {
            error: message,
          });
        } catch (statusError) {
          logger.error("Failed to persist permanent parse failure", {
            component: "transcription",
            videoId,
            transcriptId,
            error:
              statusError instanceof Error
                ? statusError.message
                : statusError,
          });
          res.status(500).send("Transcript finalization failed");
          return;
        }
        sendAcknowledgmentResponse(res);
        return;
      }
      logger.error("Failed to finalize transcript", {
        component: "transcription",
        videoId,
        transcriptId,
        error: message,
      });
      res.status(500).send("Transcript finalization failed");
    }
  },
);

app.post(
  "/reconcile-transcripts",
  async (_req: Request, res: Response): Promise<void> => {
    if (!serviceConfig.enableTranscription) {
      logger.info(
        "Skipping transcript reconciliation; ENABLE_TRANSCRIPTION is false",
        { component: "transcription" },
      );
      // Cloud Scheduler retries any non-2xx. Ack even when the flag is off.
      res.status(200).json({
        skipped: true,
        reason: "transcription disabled",
      });
      return;
    }

    const staleAfterMs = serviceConfig.reconcileStaleAfterMs;
    const now = Date.now();
    let processed = 0;
    let failed = 0;
    let recovered = 0;
    let stillRunning = 0;
    let needsReview = 0;
    let noAudioDetected = 0;
    let errors = 0;

    try {
      const candidates = await listTranscriptsForReconcile();
      for (const transcript of candidates) {
        const videoId = transcript.videoId;
        const transcriptId = transcript.id;
        try {
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

          processed += 1;

          if (!transcript.operationName) {
            if (transcript.status === "needs_review") {
              needsReview += 1;
              continue;
            }
            const applied = await updateTranscriptStatus(
              videoId,
              transcriptId,
              "needs_review",
              {
                error:
                  "Claimed without a persisted Speech operationName; RPC may have started",
              },
            );
            if (applied) {
              needsReview += 1;
            }
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
            const applied = await updateTranscriptStatus(
              videoId,
              transcriptId,
              "failed",
              {
                error: inspection.error,
              },
            );
            if (applied) {
              failed += 1;
            }
            continue;
          }

          if (!inspection.outputUri) {
            const applied = await updateTranscriptStatus(
              videoId,
              transcriptId,
              "failed",
              {
                error: "Speech job completed without a GCS result URI",
              },
            );
            if (applied) {
              failed += 1;
            }
            continue;
          }

          const rawObject = parseGsUri(inspection.outputUri);
          if (
            !rawObject ||
            !isConfiguredTranscriptsBucket(rawObject.bucket)
          ) {
            const applied = await updateTranscriptStatus(
              videoId,
              transcriptId,
              "failed",
              {
                error: `Unparseable or untrusted Speech output URI: ${inspection.outputUri}`,
              },
            );
            if (applied) {
              failed += 1;
            }
            continue;
          }

          const parsedOutput = parseRawTranscriptObjectName(rawObject.path);
          if (
            !parsedOutput ||
            parsedOutput.videoId !== videoId ||
            parsedOutput.transcriptId !== transcriptId
          ) {
            const applied = await updateTranscriptStatus(
              videoId,
              transcriptId,
              "failed",
              {
                error: `Speech output path did not match claimed transcript: ${inspection.outputUri}`,
              },
            );
            if (applied) {
              failed += 1;
            }
            continue;
          }

          const { gcsPath, transcript: payload } =
            await finalizeTranscriptFromRawObject(
              videoId,
              transcriptId,
              rawObject.bucket,
              rawObject.path,
            );
          const applied = await updateTranscriptStatus(
            videoId,
            transcriptId,
            "done",
            {
              gcsPath,
              segmentCount: payload.segments.length,
              durationSeconds: payload.durationSeconds,
            },
          );
          if (applied) {
            recovered += 1;
          }
          const audioFileName = audioWorkFileNameFromUri(transcript.audioGcsUri);
          if (audioFileName) {
            try {
              await deleteAudioWorkObject(audioFileName);
            } catch (cleanupError) {
              logger.warn("Failed to delete audio work object after recovery", {
                component: "transcription",
                videoId,
                transcriptId,
                error:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : cleanupError,
              });
            }
          }
        } catch (itemError) {
          const message =
            itemError instanceof Error ? itemError.message : String(itemError);
          if (isNoAudioDetectedError(itemError) && videoId && transcriptId) {
            logger.info(
              "Speech returned no usable speech segments during reconcile",
              {
                component: "transcription",
                videoId,
                transcriptId,
              },
            );
            try {
              const applied = await persistNoAudioDetected(
                videoId,
                transcriptId,
                transcript.audioGcsUri,
              );
              if (applied) {
                noAudioDetected += 1;
              }
            } catch (statusError) {
              errors += 1;
              logger.error(
                "Failed to persist no_audio_detected during reconcile",
                {
                  component: "transcription",
                  videoId,
                  transcriptId,
                  error:
                    statusError instanceof Error
                      ? statusError.message
                      : statusError,
                },
              );
            }
            continue;
          }
          if (
            isPermanentTranscriptParseError(itemError) &&
            videoId &&
            transcriptId
          ) {
            logger.error(
              "Permanent Speech result parse/schema failure during reconcile; marking failed",
              {
                component: "transcription",
                videoId,
                transcriptId,
                error: message,
              },
            );
            try {
              const applied = await updateTranscriptStatus(
                videoId,
                transcriptId,
                "failed",
                { error: message },
              );
              if (applied) {
                failed += 1;
              }
            } catch (statusError) {
              errors += 1;
              logger.error(
                "Failed to persist permanent parse failure during reconcile",
                {
                  component: "transcription",
                  videoId,
                  transcriptId,
                  error:
                    statusError instanceof Error
                      ? statusError.message
                      : statusError,
                },
              );
            }
            continue;
          }
          errors += 1;
          logger.error("Reconcile item failed; continuing sweep", {
            component: "transcription",
            videoId,
            transcriptId,
            error: message,
          });
        }
      }

      res.status(200).json({
        processed,
        inspected: processed,
        failed,
        recovered,
        stillRunning,
        needsReview,
        noAudioDetected,
        errors,
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

const port = process.env.PORT || 3000;

export function startServer() {
  return app.listen(port, () => {
    logger.info("Video processing service started", {
      component: "bootstrap",
      port,
    });
    logger.info("Ready to process videos from Pub/Sub", {
      component: "bootstrap",
    });
  });
}

if (process.env.JEST_WORKER_ID === undefined) {
  startServer();
}
