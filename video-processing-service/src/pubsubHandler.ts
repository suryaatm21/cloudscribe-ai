import { Request, Response } from "express";
import { serviceConfig } from "./config";
import { logger } from "./logger";

/**
 * Represents the decoded message payload from Pub/Sub.
 */
export interface PubSubMessage {
  name: string;
  [key: string]: any;
}

function getJobId(req: Request): string | undefined {
  return (
    req.body?.message?.messageId ||
    req.headers["ce-id"]?.toString() ||
    req.headers["x-request-id"]?.toString()
  );
}

/**
 * Validates and decodes a Pub/Sub message from the request body.
 * @param {Request} req - The Express request object.
 * @returns {PubSubMessage} The decoded message payload.
 * @throws {Error} If the message is invalid or missing required fields.
 */
export function decodePubSubMessage(req: Request): PubSubMessage {
  // Ensure body.message.data exists (Pub/Sub format)
  if (!req.body?.message?.data) {
    throw new Error("No message data found in request");
  }

  const messageId = getJobId(req) ?? "unknown";
  const message = Buffer.from(req.body.message.data, "base64").toString("utf8");

  let data: PubSubMessage;
  try {
    data = JSON.parse(message);
  } catch (parseError) {
    throw new Error("Invalid JSON in message");
  }

  if (!data.name) {
    throw new Error("Missing filename in payload");
  }

  if (serviceConfig.environment !== "production") {
    logger.debug("Decoded Pub/Sub message", { jobId: messageId, payload: data });
  }

  return data;
}

/**
 * Logs the incoming request for debugging purposes.
 * @param {Request} req - The Express request object.
 */
export function logRequest(req: Request): void {
  const jobId = getJobId(req);
  logger.info("Received Pub/Sub event", {
    jobId: jobId ?? "unknown",
    component: "pubsubHandler",
    subscription: req.headers["ce-subject"],
    attributes: req.body?.message?.attributes,
  });
}

/**
 * Sends a success response to acknowledge message processing.
 * @param {Response} res - The Express response object.
 * @param {string} message - The success message to send.
 */
export function sendSuccessResponse(res: Response, message: string): void {
  res.status(200).send(message);
}

/**
 * Sends an error response for bad requests.
 * @param {Response} res - The Express response object.
 * @param {string} message - The error message to send.
 */
export function sendBadRequestResponse(res: Response, message: string): void {
  res.status(400).send(message);
}

/**
 * Sends an acknowledgment response even when processing fails.
 * This prevents Pub/Sub from retrying malformed or unprocessable messages.
 * @param {Response} res - The Express response object.
 */
export function sendAcknowledgmentResponse(res: Response): void {
  res.status(200).send("Message acknowledged, but processing failed");
}
