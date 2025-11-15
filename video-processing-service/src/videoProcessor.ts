import {
  downloadRawVideo,
  convertVideo,
  deleteRawVideo,
  uploadProcessedVideo,
  deleteProcessedVideo,
  extractAudio,
  uploadAudioForTranscription,
  deleteAudioWorkFile,
} from "./storage";
import {
  createTranscript,
  setVideo,
  updateTranscriptStatus,
} from "./firestore";
import { serviceConfig } from "./config";
import { logger } from "./logger";
import { publishTranscriptionJob } from "./transcriptionQueue";

const DEFAULT_TRANSCRIPT_ID = "primary";

/**
 * Processes a video by downloading, converting, uploading, and updating its status.
 * @param {string} inputFileName - The name of the input video file.
 * @param {string} outputFileName - The name of the output video file.
 * @param {string} videoId - The unique identifier for the video.
 * @returns {Promise<void>} A promise that resolves when processing is complete.
 * @throws {Error} If any step in the video processing pipeline fails.
 */
export async function processVideo(
  inputFileName: string,
  outputFileName: string,
  videoId: string,
): Promise<void> {
  const maxAttempts = serviceConfig.processingMaxAttempts;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      logger.info('Starting video processing', {
        jobId: videoId,
        component: 'videoProcessor',
        attempt,
        maxAttempts,
        inputFileName,
        outputFileName,
      });

      await downloadRawVideo(inputFileName);
      await convertVideo(inputFileName, outputFileName);
      await uploadProcessedVideo(outputFileName);

      await setVideo(videoId, {
        status: "processed",
        filename: outputFileName,
      });

      if (serviceConfig.enableTranscription) {
        await triggerTranscriptionPipeline(videoId, outputFileName);
      }

      await Promise.all([
        deleteRawVideo(inputFileName),
        deleteProcessedVideo(outputFileName),
      ]);

      logger.info("Successfully processed video", {
        jobId: videoId,
        component: "videoProcessor",
        inputFileName,
      });
      return;
    } catch (err) {
      lastError = err;
      logger.error("Error during video processing", {
        jobId: videoId,
        component: "videoProcessor",
        attempt,
        maxAttempts,
        error: err instanceof Error ? err.message : err,
      });
      await cleanupFiles(inputFileName, outputFileName);

      if (attempt < maxAttempts) {
        logger.warn("Retrying video processing after failure", {
          jobId: videoId,
          component: "videoProcessor",
          nextAttempt: attempt + 1,
        });
      }
    }
  }

  await setVideo(videoId, { status: "failed" });
  const errorToThrow =
    lastError instanceof Error
      ? lastError
      : new Error("Video processing failed after retries");
  logger.error("Exhausted video processing attempts", {
    jobId: videoId,
    component: "videoProcessor",
    attempts: maxAttempts,
    error: errorToThrow.message,
  });
  throw errorToThrow;
}

/**
 * Cleans up video files after processing or in case of errors.
 * @param {string} inputFileName - The name of the input video file.
 * @param {string} outputFileName - The name of the output video file.
 * @returns {Promise<void>} A promise that resolves when cleanup is complete.
 */
async function cleanupFiles(
  inputFileName: string,
  outputFileName: string,
): Promise<void> {
  try {
    await Promise.all([
      deleteRawVideo(inputFileName),
      deleteProcessedVideo(outputFileName),
    ]);
  } catch (cleanupErr) {
    logger.error("Error during cleanup", {
      component: "videoProcessor",
      jobId: videoIdFromFileNames(inputFileName),
      error: cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
    });
  }
}

function videoIdFromFileNames(inputFileName: string): string | undefined {
  return inputFileName.split(".")[0];
}

async function triggerTranscriptionPipeline(
  videoId: string,
  processedFileName: string,
) {
  const transcriptId = DEFAULT_TRANSCRIPT_ID;
  const uid = videoId.split("-")[0];
  const audioFileName = `${videoId}.flac`;

  try {
    await extractAudio(processedFileName, audioFileName);
    const audioGcsUri = await uploadAudioForTranscription(audioFileName);

    await createTranscript(videoId, transcriptId, {
      status: "pending",
      language: serviceConfig.speechToTextLanguage,
      model: serviceConfig.speechToTextModel,
      audioGcsUri,
      userId: uid,
    });

    await publishTranscriptionJob({
      videoId,
      transcriptId,
      audioGcsUri,
      userId: uid,
    });

    await updateTranscriptStatus(videoId, transcriptId, "running");
    logger.info("Queued transcription job", {
      component: "videoProcessor",
      videoId,
      transcriptId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to queue transcription job", {
      component: "videoProcessor",
      videoId,
      transcriptId,
      error: message,
    });
    await updateTranscriptStatus(videoId, transcriptId, "failed", {
      error: message,
    });
  } finally {
    await deleteAudioWorkFile(audioFileName);
  }
}

