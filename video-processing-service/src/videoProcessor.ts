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
  try {
    console.log(`Starting processing for file: ${inputFileName}`);

    await downloadRawVideo(inputFileName);
    await convertVideo(inputFileName, outputFileName);
    await uploadProcessedVideo(outputFileName);

    // Update video status to processed in Firestore
    await setVideo(videoId, {
      status: 'processed',
      filename: outputFileName,
    });

    // Clean up files after successful processing
    await Promise.all([
      deleteRawVideo(inputFileName),
      deleteProcessedVideo(outputFileName),
    ]);

    console.log(`Successfully processed video: ${inputFileName}`);
  } catch (err) {
    console.error('Error during video processing:', err);

    // Clean up any partial files
    await cleanupFiles(inputFileName, outputFileName);

    throw err;
  }
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
