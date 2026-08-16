import { logger } from "./logger";
import { publishNotesJob } from "./notesQueue";
import { shouldGenerateNotes } from "./featureFlags";

/**
 * Parameters required to publish a notes job.
 */
interface NotesTriggerPayload {
  videoId: string;
  transcriptId: string;
  gcsPath: string;
  userId?: string;
}

/**
 * Publishes a notes job when feature flags allow the operation.
 * @param payload Metadata referencing the transcript artifact.
 */
export async function triggerNotesJob(payload: NotesTriggerPayload) {
  if (!(await shouldGenerateNotes(payload.userId))) {
    logger.info("Notes job skipped by feature flag", {
      component: "notesTrigger",
      videoId: payload.videoId,
      transcriptId: payload.transcriptId,
    });
    return;
  }
  const noteId = `${payload.transcriptId}-notes`;
  await publishNotesJob({
    videoId: payload.videoId,
    transcriptId: payload.transcriptId,
    transcriptGcsPath: payload.gcsPath,
    noteId,
    userId: payload.userId,
  });
}
