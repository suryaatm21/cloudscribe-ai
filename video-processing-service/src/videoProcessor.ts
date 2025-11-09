import {
  downloadRawVideo,
  convertVideo,
  deleteRawVideo,
  uploadProcessedVideo,
  deleteProcessedVideo,
} from './storage';
import { setVideo } from './firestore';

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
  const parsedAttempts = Number(process.env.PROCESSING_MAX_ATTEMPTS);
  const maxAttempts = Number.isFinite(parsedAttempts) && parsedAttempts > 0
    ? parsedAttempts
    : 3;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      console.log(
        `Starting processing for file: ${inputFileName} (attempt ${attempt}/${maxAttempts})`,
      );

      await downloadRawVideo(inputFileName);
      await convertVideo(inputFileName, outputFileName);
      await uploadProcessedVideo(outputFileName);

      await setVideo(videoId, {
        status: 'processed',
        filename: outputFileName,
      });

      await Promise.all([
        deleteRawVideo(inputFileName),
        deleteProcessedVideo(outputFileName),
      ]);

      console.log(`Successfully processed video: ${inputFileName}`);
      return;
    } catch (err) {
      lastError = err;
      console.error(
        `Error during video processing (attempt ${attempt}/${maxAttempts}):`,
        err,
      );
      await cleanupFiles(inputFileName, outputFileName);

      if (attempt < maxAttempts) {
        console.log('Retrying video processing after failure...');
      }
    }
  }

  await setVideo(videoId, { status: 'failed' });
  const errorToThrow =
    lastError instanceof Error
      ? lastError
      : new Error('Video processing failed after retries');
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
    console.error('Error during cleanup:', cleanupErr);
  }
}
