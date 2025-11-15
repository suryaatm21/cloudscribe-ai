import { PubSub } from "@google-cloud/pubsub";
import { serviceConfig } from "./config";
import { logger } from "./logger";

const pubsub = new PubSub();

export interface TranscriptionJobPayload {
  videoId: string;
  transcriptId: string;
  audioGcsUri: string;
  userId?: string;
  operationName?: string;
}

export async function publishTranscriptionJob(payload: TranscriptionJobPayload) {
  const topic = getTranscriptionTopic();
  const messageId = await topic.publishMessage({ json: payload });
  logger.info("Published transcription job", {
    component: "transcriptionQueue",
    messageId,
    videoId: payload.videoId,
    transcriptId: payload.transcriptId,
  });
  return messageId;
}

function getTranscriptionTopic() {
  if (!serviceConfig.transcriptionTopicName) {
    throw new Error("Transcription topic name is not configured");
  }
  return pubsub.topic(serviceConfig.transcriptionTopicName);
}

