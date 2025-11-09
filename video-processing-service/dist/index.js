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
const express_1 = __importDefault(require("express"));
const storage_1 = require("./storage");
const app = (0, express_1.default)();
app.use(express_1.default.json());
(0, storage_1.setupDirectories)();
app.post("/process-video", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    // Log the incoming request for debugging
    console.log("Received request:", JSON.stringify({
        headers: req.headers,
        body: req.body,
    }, null, 2));
    let data;
    try {
        // Ensure body.message.data exists (Pub/Sub format)
        if (!((_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.data)) {
            console.error("No message data found in request");
            res.status(400).send("Bad Request: missing message data");
            return;
        }
        const message = Buffer.from(req.body.message.data, "base64").toString("utf8");
        console.log("Decoded message:", message);
        try {
            data = JSON.parse(message);
        }
        catch (parseError) {
            console.error("Failed to parse message:", parseError);
            res.status(400).send("Bad Request: invalid JSON in message");
            return;
        }
        if (!data.name) {
            console.error("No filename in message payload");
            res.status(400).send("Bad Request: missing filename in payload");
            return;
        }
    }
    catch (error) {
        console.error("Error processing request:", error);
        // Always return 200 for Pub/Sub to acknowledge the message was received
        // even if we couldn't process it to prevent redelivery of malformed messages
        res.status(200).send("Message acknowledged, but processing failed");
        return;
    }
    const inputFileName = data.name;
    const outputFileName = `processed-${inputFileName}`;
    try {
        console.log(`Starting processing for file: ${inputFileName}`);
        yield (0, storage_1.downloadRawVideo)(inputFileName);
        yield (0, storage_1.convertVideo)(inputFileName, outputFileName);
        yield (0, storage_1.uploadProcessedVideo)(outputFileName);
        // Clean up files after successful processing
        yield Promise.all([
            (0, storage_1.deleteRawVideo)(inputFileName),
            (0, storage_1.deleteProcessedVideo)(outputFileName),
        ]);
        console.log(`Successfully processed video: ${inputFileName}`);
        // Return 200 to acknowledge the message
        res.status(200).send("Processing completed successfully");
    }
    catch (err) {
        console.error("Error during video processing:", err);
        // Clean up any partial files
        try {
            yield Promise.all([
                (0, storage_1.deleteRawVideo)(inputFileName),
                (0, storage_1.deleteProcessedVideo)(outputFileName),
            ]);
        }
        catch (cleanupErr) {
            console.error("Error during cleanup:", cleanupErr);
        }
        // Still return 200 to acknowledge receipt of the message
        // This prevents Pub/Sub from retrying failed messages
        res.status(200).send("Message acknowledged, but processing failed");
    }
}));
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Video processing service running at http://localhost:${port}`);
    console.log("Ready to process videos from Pub/Sub");
});
