import {
  VertexAI,
  HarmBlockThreshold,
  HarmCategory,
} from "@google-cloud/vertexai";
import { serviceConfig } from "./config";
import { logger } from "./logger";

const vertexAi = new VertexAI({
  project: serviceConfig.vertexProjectId,
  location: serviceConfig.vertexRegion,
});

const model = vertexAi.getGenerativeModel({
  model: serviceConfig.vertexModel,
});

function resolveThreshold(): HarmBlockThreshold {
  const key = serviceConfig.vertexSafetyTier as keyof typeof HarmBlockThreshold;
  return HarmBlockThreshold[key] ?? HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE;
}

const DEFAULT_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: resolveThreshold() },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: resolveThreshold() },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: resolveThreshold() },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: resolveThreshold() },
];

/**
 * Additional context captured when generating notes.
 */
export interface NotesGenerationMetadata {
  transcriptId: string;
  promptVersion: string;
  durationSeconds: number;
}

/**
 * Calls Gemini to generate a markdown document from the provided prompt.
 * @param prompt Fully materialized prompt text.
 * @param metadata Context captured for observability.
 * @returns Markdown string produced by Vertex AI.
 */
export async function generateNotesMarkdown(
  prompt: string,
  metadata: NotesGenerationMetadata,
): Promise<string> {
  logger.info("Calling Vertex AI to generate notes", {
    component: "vertexai",
    transcriptId: metadata.transcriptId,
    promptVersion: metadata.promptVersion,
  });
  const response = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    safetySettings: DEFAULT_SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      topP: 0.9,
      topK: 32,
    },
  });
  const textParts =
    response.response?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "") ?? [];
  const markdown = textParts.join("\n").trim();
  if (!markdown) {
    throw new Error("Vertex AI response did not include any text");
  }
  logger.info("Vertex AI generation completed", {
    component: "vertexai",
    transcriptId: metadata.transcriptId,
    promptVersion: metadata.promptVersion,
  });
  return markdown;
}
