import { Request, Response } from "express";
import { logger } from "./logger";

/**
 * Minimal Pub/Sub push payload format.
 */
interface PubSubMessage<T> {
  message?: {
    data?: string;
    messageId?: string;
  };
  subscription?: string;
}

/**
 * Extracts and parses the Pub/Sub payload from an Express request.
 * @param req Express request forwarded by Pub/Sub.
 * @returns Materialized payload of type T.
 */
export function decodePubSubMessage<T>(req: Request): T {
  const body = req.body as PubSubMessage<T>;
  if (!body?.message?.data) {
    throw new Error("Invalid Pub/Sub payload: missing data");
  }
  const json = Buffer.from(body.message.data, "base64").toString("utf-8");
  return JSON.parse(json) as T;
}

/**
 * Sends a success response acknowledging the message.
 * @param res Express response to populate.
 */
export function acknowledge(res: Response) {
  res.status(200).send();
}

/**
 * Responds with HTTP 400 and structured warning logs.
 * @param res Express response object.
 * @param reason Explanation for the rejection.
 */
export function badRequest(res: Response, reason: string) {
  logger.warn("Rejecting Pub/Sub message", { reason });
  res.status(400).send(reason);
}
