import { z } from "zod";
import { createOrUpdateNote, updateNoteStatus } from "./firestore";
import { logger } from "./logger";
import { loadPromptTemplate } from "./promptLoader";
import { fetchTranscriptPayload, uploadNotesMarkdown } from "./storage";
import { generateNotesMarkdown } from "./vertexai";
import { shouldGenerateNotes } from "./featureFlags";
import { serviceConfig } from "./config";

/**
 * Runtime validation schema for Pub/Sub payloads requesting notes generation.
 */
const notesJobPayloadSchema = z.object({
  videoId: z.string().min(1),
  transcriptId: z.string().min(1),
  transcriptGcsPath: z.string().min(5),
  noteId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
});

export type NotesJobPayload = z.infer<typeof notesJobPayloadSchema>;

/**
 * Materializes the prompt template by injecting transcript metadata.
 * @param template Raw prompt template string containing placeholders.
 * @param transcript Transcript payload pulled from GCS.
 * @returns Prompt string ready for Vertex AI submission.
 */
export function buildPromptText(
  template: string,
  transcript: {
    segments: { text: string; startTime: number; endTime: number }[];
    durationSeconds: number;
    videoId: string;
  },
): string {
  const transcriptText = transcript.segments
    .map((segment) => {
      const start = new Date(segment.startTime * 1000).toISOString().substring(11, 19);
      return `- [${start}] ${segment.text}`;
    })
    .join("\n");
  return template
    .replace(/{{transcript}}/gi, transcriptText)
    .replace(/{{duration}}/gi, `${Math.round(transcript.durationSeconds / 60)} minutes`)
    .replace(/{{videoId}}/gi, transcript.videoId);
}

/**
 * Handles a single notes generation request end-to-end.
 * @param rawPayload Arbitrary payload received via Pub/Sub.
 * @returns GCS path of the generated markdown file.
 */
export async function handleNotesJob(rawPayload: unknown): Promise<string> {
  const payload = notesJobPayloadSchema.parse(rawPayload);
  const noteId = payload.noteId ?? `${payload.transcriptId}-notes`;
  if (!(await shouldGenerateNotes(payload.userId))) {
    logger.info("Notes generation skipped via feature flag", {
      component: "notesGenerator",
      videoId: payload.videoId,
      transcriptId: payload.transcriptId,
      userId: payload.userId,
    });
    await updateNoteStatus(payload.videoId, noteId, "failed", {
      error: "Notes generation disabled",
    });
    return "Feature flag disabled";
  }

  await createOrUpdateNote(payload.videoId, noteId, {
    videoId: payload.videoId,
    noteId,
    transcriptId: payload.transcriptId,
    promptVersion: serviceConfig.notesPromptId,
    status: "pending",
    userId: payload.userId ?? "unknown",
  });

  await updateNoteStatus(payload.videoId, noteId, "running");

  try {
    const transcript = await fetchTranscriptPayload(payload.transcriptGcsPath);
    const template = await loadPromptTemplate(serviceConfig.notesPromptId);
    const prompt = buildPromptText(template.template, transcript);
    const markdown = await generateNotesMarkdown(prompt, {
      transcriptId: payload.transcriptId,
      promptVersion: template.version,
      durationSeconds: transcript.durationSeconds,
    });
    const gcsPath = await uploadNotesMarkdown(payload.videoId, noteId, markdown);
    await updateNoteStatus(payload.videoId, noteId, "done", {
      gcsPath,
      promptVersion: template.version,
    });
    return gcsPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Notes generation failed", {
      component: "notesGenerator",
      videoId: payload.videoId,
      transcriptId: payload.transcriptId,
      error: message,
    });
    await updateNoteStatus(payload.videoId, noteId, "failed", { error: message });
    throw error;
  }
}
