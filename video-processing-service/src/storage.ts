import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { serviceConfig } from './config';
import { logger } from './logger';

const storage = new Storage();

const rawVideoBucketName = serviceConfig.rawVideoBucketName;
const processedVideoBucketName = serviceConfig.processedVideoBucketName;
const audioWorkBucketName = serviceConfig.audioWorkBucketName;

const localRawVideoPath = './raw-videos';
const localProcessedVideoPath = './processed-videos';
const localAudioWorkPath = './audio-work';

export function getStorageClient(): Storage {
  return storage;
}

/**
 * Ensures the existence of required directories for raw and processed videos.
 */
export function setupDirectories() {
  ensureDirectoryExistence(localRawVideoPath);
  ensureDirectoryExistence(localProcessedVideoPath);
  ensureDirectoryExistence(localAudioWorkPath);
}

/**
 * Converts a raw video to a processed format using ffmpeg.
 *
 * Sprint 2 intentionally dropped `-vf scale=-1:360`. The processed object is
 * the source for Speech audio extraction, and downscaling was losing quality
 * without a product requirement. Raw GCS originals are also never deleted
 * (see docs/project-limitations.md).
 * @param {string} rawVideoName - The name of the raw video file.
 * @param {string} processedVideoName - The name of the processed video file.
 * @returns {Promise<void>} A promise that resolves when the conversion is complete.
 */
export function convertVideo(rawVideoName: string, processedVideoName: string) {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(`${localRawVideoPath}/${rawVideoName}`)
      .on('end', () => {
        logger.info('Video conversion finished', {
          component: 'storage',
          inputFile: rawVideoName,
          outputFile: processedVideoName,
        });
        resolve();
      })
      .on('error', (err) => {
        logger.error('ffmpeg conversion error', {
          component: 'storage',
          inputFile: rawVideoName,
          outputFile: processedVideoName,
          error: err instanceof Error ? err.message : err,
        });
        reject(err);
      })
      .save(`${localProcessedVideoPath}/${processedVideoName}`);
  });
}

/**
 * Extracts audio from a processed video file and stores it locally as FLAC.
 * @param {string} processedVideoName - The name of the processed video file.
 * @param {string} audioFileName - The target audio file name (should end with .flac).
 * @returns {Promise<void>} A promise resolved when extraction completes.
 */
export function extractAudio(
  processedVideoName: string,
  audioFileName: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(`${localProcessedVideoPath}/${processedVideoName}`)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('flac')
      .on('end', () => {
        logger.info('Audio extraction finished', {
          component: 'storage',
          inputFile: processedVideoName,
          outputFile: audioFileName,
        });
        resolve();
      })
      .on('error', (err) => {
        logger.error('Audio extraction error', {
          component: 'storage',
          inputFile: processedVideoName,
          outputFile: audioFileName,
          error: err instanceof Error ? err.message : err,
        });
        reject(err);
      })
      .save(`${localAudioWorkPath}/${audioFileName}`);
  });
}

/**
 * Downloads a raw video from Google Cloud Storage to the local file system.
 * @param {string} fileName - The name of the raw video file to download.
 * @returns {Promise<void>} A promise that resolves when the download is complete.
 */
export async function downloadRawVideo(fileName: string) {
  const bucket = storage.bucket(rawVideoBucketName);
  await bucket.file(fileName).download({
    destination: `${localRawVideoPath}/${fileName}`,
  });
  logger.info('Downloaded raw video', {
    component: 'storage',
    fileName,
    destination: localRawVideoPath,
  });
}

/**
 * Uploads a processed video from the local file system to Google Cloud Storage.
 * @param {string} fileName - The name of the processed video file to upload.
 * @returns {Promise<void>} A promise that resolves when the upload is complete.
 */
export async function uploadProcessedVideo(fileName: string) {
  const bucket = storage.bucket(processedVideoBucketName);

  await bucket.upload(`${localProcessedVideoPath}/${fileName}`, {
    destination: fileName,
  });
  logger.info('Uploaded processed video', {
    component: 'storage',
    fileName,
    bucket: processedVideoBucketName,
  });
  await bucket.file(fileName).makePublic();
}

/**
 * Uploads an extracted audio file for transcription, then deletes the local FLAC.
 * @param {string} fileName - The local audio file name.
 * @returns {Promise<string>} GCS URI for the uploaded audio object.
 */
export async function uploadAudioForTranscription(fileName: string) {
  const bucket = storage.bucket(audioWorkBucketName);
  const localPath = `${localAudioWorkPath}/${fileName}`;
  await bucket.upload(localPath, {
    destination: fileName,
    metadata: { contentType: 'audio/flac' },
  });
  const gcsUri = `gs://${audioWorkBucketName}/${fileName}`;
  logger.info('Uploaded audio for transcription', {
    component: 'storage',
    fileName,
    bucket: audioWorkBucketName,
  });
  await deleteAudioWorkFile(fileName);
  return gcsUri;
}

/**
 * Deletes the GCS audio-work object after the transcript is marked done.
 * Bucket lifecycle is the fallback if this call fails.
 */
export async function deleteAudioWorkObject(fileName: string): Promise<void> {
  try {
    await storage.bucket(audioWorkBucketName).file(fileName).delete({
      ignoreNotFound: true,
    });
    logger.info('Deleted audio work object', {
      component: 'storage',
      fileName,
      bucket: audioWorkBucketName,
    });
  } catch (error) {
    logger.warn('Failed to delete audio work object', {
      component: 'storage',
      fileName,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export function audioWorkFileNameFromUri(audioGcsUri?: string): string | undefined {
  if (!audioGcsUri || !audioGcsUri.startsWith('gs://')) {
    return undefined;
  }
  const withoutScheme = audioGcsUri.slice('gs://'.length);
  const slash = withoutScheme.indexOf('/');
  if (slash < 0 || slash === withoutScheme.length - 1) {
    return undefined;
  }
  return withoutScheme.slice(slash + 1);
}

/**
 * Deletes a raw video file from the local file system.
 * @param {string} fileName - The name of the raw video file to delete.
 * @returns {Promise<void>} A promise that resolves when the file is deleted.
 */
export function deleteRawVideo(fileName: string) {
  return deleteFile(`${localRawVideoPath}/${fileName}`);
}

/**
 * Deletes a processed video file from the local file system.
 * @param {string} fileName - The name of the processed video file to delete.
 * @returns {Promise<void>} A promise that resolves when the file is deleted.
 */
export function deleteProcessedVideo(fileName: string) {
  return deleteFile(`${localProcessedVideoPath}/${fileName}`);
}

/**
 * Deletes a local audio work file.
 * @param {string} fileName - The name of the audio file to delete.
 * @returns {Promise<void>} Resolves when deletion completes.
 */
export function deleteAudioWorkFile(fileName: string) {
  return deleteFile(`${localAudioWorkPath}/${fileName}`);
}

function deleteFile(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          logger.error('Error deleting file', {
            component: 'storage',
            filePath,
            error: err instanceof Error ? err.message : err,
          });
          reject(err);
        } else {
          logger.info('Deleted temporary file', {
            component: 'storage',
            filePath,
          });
          resolve();
        }
      });
    } else {
      logger.debug('File not found during cleanup', {
        component: 'storage',
        filePath,
      });
      resolve();
    }
  });
}

function ensureDirectoryExistence(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true }); // recursive: true enables creating nested directories
    logger.info('Created local directory', {
      component: 'storage',
      dirPath,
    });
  }
}
