/**
 * Upload validation shared by the upload-URL endpoints. Kept out of index.ts
 * so it can be unit tested without initializing the Admin SDK.
 */

/**
 * Video file extensions accepted for upload.
 *
 * Raw objects are named `{videoId}.{extension}` and the worker recovers the
 * video id by stripping only the final extension, so an extension must be a
 * single token: "tar.gz" would make the worker derive a different id than the
 * one `finalizeUpload` wrote.
 */
export const ALLOWED_VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
]);

export const UNSUPPORTED_EXTENSION_MESSAGE =
  "Unsupported video type. Use one of: " +
  `${[...ALLOWED_VIDEO_EXTENSIONS].join(", ")}.`;

/**
 * Normalizes a client-supplied file extension.
 * @param {unknown} raw Extension from the request, without a leading dot.
 * @return {string | null} Lowercase allowed extension, or null if rejected.
 */
export function normalizeVideoExtension(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const extension = raw.trim().toLowerCase();
  return ALLOWED_VIDEO_EXTENSIONS.has(extension) ? extension : null;
}
