import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { serviceConfig } from './config';
import { logger } from './logger';

const storage = new Storage();

const rawVideoBucketName = serviceConfig.rawVideoBucketName;
const processedVideoBucketName = serviceConfig.processedVideoBucketName;

const localRawVideoPath = './raw-videos';
const localProcessedVideoPath = './processed-videos';

export function getStorageClient(): Storage {
  return storage;
}

/**
 * Ensures the existence of required directories for raw and processed videos.
 */
export function setupDirectories() {
  ensureDirectoryExistence(localRawVideoPath);
  ensureDirectoryExistence(localProcessedVideoPath);
}

/**
 * Converts a raw video to a processed format using ffmpeg.
 * @param {string} rawVideoName - The name of the raw video file.
 * @param {string} processedVideoName - The name of the processed video file.
 * @returns {Promise<void>} A promise that resolves when the conversion is complete.
 */
export function convertVideo(rawVideoName: string, processedVideoName: string) {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(`${localRawVideoPath}/${rawVideoName}`)
      .outputOptions('-vf', 'scale=-1:360')
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
