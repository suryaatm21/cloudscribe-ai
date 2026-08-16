import { PubSub } from "@google-cloud/pubsub";
import { serviceConfig } from "./config";
import { logger } from "./logger";

/**
 * Payload forwarded to the notes service via Pub/Sub.
 */
export interface NotesJobPayload {
  videoId: string;
  transcriptId: string;
  transcriptGcsPath: string;
  noteId: string;
  userId?: string;
}

const pubsub = new PubSub();

/**
 * Publishes a Pub/Sub message to the notes topic.
 * @param payload Job payload referencing transcript metadata.
 * @returns Identifier of the published message.
 */
export async function publishNotesJob(payload: NotesJobPayload) {
  if (!serviceConfig.notesTopicName) {
    throw new Error("Notes topic name not configured");
  }
  const topic = pubsub.topic(serviceConfig.notesTopicName);
  const messageId = await topic.publishMessage({ json: payload });
  logger.info("Published notes job", {
    component: "notesQueue",
    videoId: payload.videoId,
    transcriptId: payload.transcriptId,
    noteId: payload.noteId,
    messageId,
  });
  return messageId;
}
