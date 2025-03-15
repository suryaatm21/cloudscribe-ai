import { Storage } from '@google-cloud/storage';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';

const storage = new Storage();

const rawVideoBucketName = "@muri-yt-raw-videos"; // must be globally unique
const processedVideoBucketName = "@muri-yt-processed-videos"; // must be globally unique

const localRawVideoPath = "./raw-videos";
const localProcessedVideoPath = "./processed-videos";

export function setupDirectories(){
    ensureDirectoryExistence(localRawVideoPath);
    ensureDirectoryExistence(localProcessedVideoPath);
}

export function convertVideo(rawVideoName: string, processedVideoName: string) {
    return new Promise<void>((resolve, reject) => {
        ffmpeg(`${localRawVideoPath}/${rawVideoName}`)
            .outputOptions("-vf", "scale=-1:360")
            .on("end", () => {
                console.log('Processing finished successfully');
                resolve();
            }
            )   
            .on("error", (err) => {
                console.log("Internal error occured");
                reject(err);
            })
            .save(`${localProcessedVideoPath}/${processedVideoName}`);
    });


}

export async function downloadRawVideo(fileName: string) {
    const bucket = storage.bucket(rawVideoBucketName);
    await bucket.file(fileName).download({
        destination: `${localRawVideoPath}/${fileName}`,
    });
    console.log(`Downloaded ${fileName} to ${localRawVideoPath}`);
}

export async function uploadProcessedVideo(fileName: string) {
    const bucket = storage.bucket(processedVideoBucketName);

    await bucket.upload(`${localProcessedVideoPath}/${fileName}`, {
        destination: fileName,
    });
    console.log(`Uploaded ${fileName} to gs://${processedVideoBucketName}/${fileName}`);
    await bucket.file(fileName).makePublic();
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

export function deleteRawVideo(fileName: string) {
    return deleteFile(`${localRawVideoPath}/${fileName}`);
}

export function deleteProcessedVideo(fileName: string) {
    return deleteFile(`${localProcessedVideoPath}/${fileName}`);
}

function ensureDirectoryExistence(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true }); // recursive: true enables creating nested directories
      console.log(`Directory created at ${dirPath}`);
    }
}