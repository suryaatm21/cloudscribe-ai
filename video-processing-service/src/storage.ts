import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';

const storage = new Storage();

const rawVideoBucketName = 'atmuri-yt-raw-videos'; // must be globally unique
const processedVideoBucketName = 'atmuri-yt-processed-videos'; // must be globally unique

const localRawVideoPath = './raw-videos';
const localProcessedVideoPath = './processed-videos';

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
        console.log('Processing finished successfully');
        resolve();
      })
      .on('error', (err) => {
        console.log('Internal error occured');
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
  console.log(`Downloaded ${fileName} to ${localRawVideoPath}`);
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
  console.log(
    `Uploaded ${fileName} to gs://${processedVideoBucketName}/${fileName}`,
  );
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
          console.log(`Error deleting file: ${err}`);
          reject(err);
        } else {
          console.log(`Deleted file: ${filePath}`);
          resolve();
        }
      });
    } else {
      console.log(`File not found: ${filePath}`);
      resolve();
    }
  });
}

function ensureDirectoryExistence(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true }); // recursive: true enables creating nested directories
    console.log(`Directory created at ${dirPath}`);
  }
}
