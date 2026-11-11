import {
  downloadRawVideo,
  convertVideo,
  deleteRawVideo,
  uploadProcessedVideo,
  deleteProcessedVideo,
  extractAudio,
  uploadAudioForTranscription,
  deleteAudioWorkFile,
  isNoAudioStreamError,
  isTranscodeDeadlineError,
  TranscodeDeadlineError,
} from "./storage";
import { Timestamp } from "firebase-admin/firestore";
import {
  createTranscript,
  setVideoEnsuringCreatedAt,
  updateTranscriptStatus,
} from "./firestore";
import { serviceConfig } from "./config";
import { logger } from "./logger";
import { publishTranscriptionJob } from "./transcriptionQueue";

const DEFAULT_TRANSCRIPT_ID = "primary";

/**
 * Total ffmpeg budget for one video, shared by every attempt and by audio
 * extraction. Cloud Run ends the request at 3600 s but does not stop a child
 * process, so ffmpeg is killed at this deadline instead. That keeps all
 * transcode work inside the request, which is what makes the 2 h stuck-transcode
 * sweep bound (see `/reconcile-transcripts`) safe: after 50 minutes ffmpeg is
 * dead, so a claim older than 2 h cannot belong to a live transcode. Download
 * and upload are not covered; ffmpeg is the only step with no natural limit.
 */
export const TRANSCODE_DEADLINE_MS = 50 * 60 * 1000;

/**
 * Processes a video by downloading, converting, uploading, and updating its status.
 * @param {string} inputFileName - The name of the input video file.
 * @param {string} outputFileName - The name of the output video file.
 * @param {string} videoId - The unique identifier for the video.
 * @param {string} userId - Owner uid persisted on the video and transcript docs.
 * @returns {Promise<void>} A promise that resolves when processing is complete.
 * @throws {Error} If any step in the video processing pipeline fails.
 */
export async function processVideo(
  inputFileName: string,
  outputFileName: string,
  videoId: string,
  userId: string,
): Promise<void> {
  const maxAttempts = serviceConfig.processingMaxAttempts;
  const deadlineAt = Date.now() + TRANSCODE_DEADLINE_MS;
  const remainingMs = () => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new TranscodeDeadlineError(
        `Transcoding used its ${TRANSCODE_DEADLINE_MS / 60000} minute budget before ffmpeg could finish`,
      );
    }
    return remaining;
  };
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      logger.info("Starting video processing", {
        jobId: videoId,
        component: "videoProcessor",
        attempt,
        maxAttempts,
        inputFileName,
        outputFileName,
      });

      await downloadRawVideo(inputFileName);
      await convertVideo(inputFileName, outputFileName, remainingMs());
      await uploadProcessedVideo(outputFileName);

      await setVideoEnsuringCreatedAt(videoId, {
        status: "processed",
        filename: outputFileName,
        uid: userId,
      });

      if (serviceConfig.enableTranscription) {
        await triggerTranscriptionPipeline(
          videoId,
          outputFileName,
          userId,
          remainingMs,
        );
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

      if (isTranscodeDeadlineError(err)) {
        // The budget is spent; another attempt would outlive the request.
        break;
      }

      if (attempt < maxAttempts) {
        logger.warn("Retrying video processing after failure", {
          jobId: videoId,
          component: "videoProcessor",
          nextAttempt: attempt + 1,
        });
      }
    }
  }

  // Also ensures createdAt: a failed video the owner cannot see is worse than
  // a failed video they can.
  const errorToThrow =
    lastError instanceof Error
      ? lastError
      : new Error("Video processing failed after retries");
  await setVideoEnsuringCreatedAt(videoId, {
    status: "failed",
    uid: userId,
    error: errorToThrow.message,
  });
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
      jobId: videoIdFromFileNames(inputFileName) ?? "unknown",
      error: cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
    });
  }
}

/**
 * Dot-safe video id: everything except the final extension.
 * `split(".")[0]` breaks on filenames that contain extra dots.
 */
export function videoIdFromFileNames(inputFileName: string): string | undefined {
  if (!inputFileName) {
    return undefined;
  }
  const segments = inputFileName.split(".");
  if (segments.length <= 1) {
    return inputFileName;
  }
  const candidate = segments.slice(0, -1).join(".");
  return candidate.length > 0 ? candidate : inputFileName;
}

/**
 * Uploads name videos as `{uid}-{timestamp}.{ext}`. Strip the trailing
 * numeric timestamp so hyphenated UIDs survive; `split("-")[0]` does not.
 */
export function uidFromVideoId(videoId: string): string | null {
  if (!videoId) {
    return null;
  }
  if (videoId.includes("/") || /[\n\r\0]/.test(videoId)) {
    return null;
  }
  const match = videoId.match(/^(.*)-(\d{10,})$/);
  if (!match || !match[1]) {
    return null;
  }
  const uid = match[1];
  if (uid.includes("/") || /[\n\r\0]/.test(uid)) {
    return null;
  }
  return uid;
}

/**
 * Triggers the asynchronous transcription pipeline for a processed video.
 * Leaves the transcript at `pending`; `/transcribe-audio` claims it before Speech.
 * @param videoId - The unique video identifier
 * @param processedFileName - The processed video filename
 * @param userId - The user ID who owns the video
 * @param remainingMs - Returns the ffmpeg budget left; throws once it is spent
 */
async function triggerTranscriptionPipeline(
  videoId: string,
  processedFileName: string,
  userId: string,
  remainingMs: () => number,
) {
  const transcriptId = DEFAULT_TRANSCRIPT_ID;
  const audioFileName = `${videoId}.flac`;

  try {
    await extractAudio(processedFileName, audioFileName, remainingMs());
    const audioGcsUri = await uploadAudioForTranscription(audioFileName);

    const created = await createTranscript(videoId, transcriptId, {
      status: "pending",
      source: "batch",
      language: serviceConfig.speechToTextLanguage,
      model: serviceConfig.speechToTextModel,
      audioGcsUri,
      userId,
    });
    if (!created) {
      // Another delivery or an earlier attempt already owns this transcript.
      // Do not publish a second job and do not touch its status: it may be
      // running, and the audio object it points at is shared.
      logger.warn("Transcript already exists; skipping duplicate job", {
        component: "videoProcessor",
        videoId,
        transcriptId,
      });
      return;
    }

    await publishTranscriptionJob({
      videoId,
      transcriptId,
      audioGcsUri,
      userId,
    });

    logger.info("Queued transcription job", {
      component: "videoProcessor",
      videoId,
      transcriptId,
    });
  } catch (err) {
    if (isNoAudioStreamError(err)) {
      logger.info("Source has no audio stream; marking no_audio_detected", {
        component: "videoProcessor",
        videoId,
        transcriptId,
      });
      // A false return (document already exists) is correct here too: leave the
      // existing transcript as it is.
      await createTranscript(videoId, transcriptId, {
        status: "no_audio_detected",
        source: "batch",
        language: serviceConfig.speechToTextLanguage,
        model: serviceConfig.speechToTextModel,
        userId,
        segmentCount: 0,
        durationSeconds: 0,
        completedAt: Timestamp.now(),
      });
      return;
    }

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
    await deleteAudioWorkFile(audioFileName);
  }
}
