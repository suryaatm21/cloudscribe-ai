import { promises as fs } from "node:fs";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { serviceConfig } from "./config";
import { logger } from "./logger";

/**
 * Metadata describing a prompt template variant.
 */
export interface PromptTemplate {
  id: string;
  version: string;
  template: string;
  metadata?: Record<string, unknown>;
}

const storage = new Storage();
const promptCache = new Map<string, { template: PromptTemplate; expiresAt: number }>();

/**
 * Computes the absolute path of a local prompt template file.
 * @param promptId Template identifier.
 * @returns Filesystem path to the prompt JSON.
 */
function getLocalPromptPath(promptId: string): string {
  return path.join(__dirname, "..", "prompts", `${promptId}.json`);
}

/**
 * Attempts to download the prompt template from GCS.
 * @param promptId Template identifier.
 * @returns Parsed prompt template or undefined on failure.
 */
async function readFromGcs(promptId: string): Promise<PromptTemplate | undefined> {
  try {
    const [buffer] = await storage
      .bucket(serviceConfig.promptsBucketName)
      .file(`${promptId}.json`)
      .download();
    return JSON.parse(buffer.toString("utf-8"));
  } catch (error) {
    logger.warn("Failed to load prompt template from GCS, falling back to local file", {
      promptId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Loads the prompt template from the local repository checkout.
 * @param promptId Template identifier.
 * @returns Parsed prompt template.
 */
async function readFromFilesystem(promptId: string): Promise<PromptTemplate> {
  const filePath = getLocalPromptPath(promptId);
  const buffer = await fs.readFile(filePath, "utf-8");
  return JSON.parse(buffer);
}

/**
 * Loads and caches the prompt template for later reuse.
 * @param promptId Template identifier requested by the caller.
 * @returns Fully materialized prompt template.
 */
export async function loadPromptTemplate(promptId: string): Promise<PromptTemplate> {
  const cached = promptCache.get(promptId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.template;
  }

  let template = await readFromGcs(promptId);
  if (!template) {
    template = await readFromFilesystem(promptId);
  }
  if (!template) {
    throw new Error(`Prompt template not found for id: ${promptId}`);
  }
  promptCache.set(promptId, {
    template,
    expiresAt: Date.now() + serviceConfig.cacheTtlMs,
  });
  return template;
}
