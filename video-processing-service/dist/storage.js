"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupDirectories = setupDirectories;
exports.convertVideo = convertVideo;
exports.downloadRawVideo = downloadRawVideo;
exports.uploadProcessedVideo = uploadProcessedVideo;
exports.deleteRawVideo = deleteRawVideo;
exports.deleteProcessedVideo = deleteProcessedVideo;
const storage_1 = require("@google-cloud/storage");
const fs_1 = __importDefault(require("fs"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const storage = new storage_1.Storage();
const rawVideoBucketName = "atmuri-yt-raw-videos"; // must be globally unique
const processedVideoBucketName = "atmuri-yt-processed-videos"; // must be globally unique
const localRawVideoPath = "./raw-videos";
const localProcessedVideoPath = "./processed-videos";
function setupDirectories() {
    ensureDirectoryExistence(localRawVideoPath);
    ensureDirectoryExistence(localProcessedVideoPath);
}
function convertVideo(rawVideoName, processedVideoName) {
    return new Promise((resolve, reject) => {
        (0, fluent_ffmpeg_1.default)(`${localRawVideoPath}/${rawVideoName}`)
            .outputOptions("-vf", "scale=-1:360")
            .on("end", () => {
            console.log('Processing finished successfully');
            resolve();
        })
            .on("error", (err) => {
            console.log("Internal error occured");
            reject(err);
        })
            .save(`${localProcessedVideoPath}/${processedVideoName}`);
    });
}
function downloadRawVideo(fileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const bucket = storage.bucket(rawVideoBucketName);
        yield bucket.file(fileName).download({
            destination: `${localRawVideoPath}/${fileName}`,
        });
        console.log(`Downloaded ${fileName} to ${localRawVideoPath}`);
    });
}
function uploadProcessedVideo(fileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const bucket = storage.bucket(processedVideoBucketName);
        yield bucket.upload(`${localProcessedVideoPath}/${fileName}`, {
            destination: fileName,
        });
        console.log(`Uploaded ${fileName} to gs://${processedVideoBucketName}/${fileName}`);
        yield bucket.file(fileName).makePublic();
    });
}
function deleteFile(filePath) {
    return new Promise((resolve, reject) => {
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlink(filePath, (err) => {
                if (err) {
                    console.log(`Error deleting file: ${err}`);
                    reject(err);
                }
                else {
                    console.log(`Deleted file: ${filePath}`);
                    resolve();
                }
            });
        }
        else {
            console.log(`File not found: ${filePath}`);
            resolve();
        }
    });
}
function deleteRawVideo(fileName) {
    return deleteFile(`${localRawVideoPath}/${fileName}`);
}
function deleteProcessedVideo(fileName) {
    return deleteFile(`${localProcessedVideoPath}/${fileName}`);
}
function ensureDirectoryExistence(dirPath) {
    if (!fs_1.default.existsSync(dirPath)) {
        fs_1.default.mkdirSync(dirPath, { recursive: true }); // recursive: true enables creating nested directories
        console.log(`Directory created at ${dirPath}`);
    }
}
