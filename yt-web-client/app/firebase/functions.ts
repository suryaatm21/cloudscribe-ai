import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const generateUploadUrl = httpsCallable(functions, "generateUploadUrl");
const finalizeUploadFunction = httpsCallable(functions, "finalizeUpload");
const getVideosFunction = httpsCallable(functions, "getVideos");
const getTranscriptUrlFunction = httpsCallable(functions, "getTranscriptUrl");

/**
 * `undefined` status means the upload finished but the worker has not picked
 * the video up yet, which is a real state the home page should show rather
 * than hide.
 */
export type VideoStatus = "processing" | "processed" | "failed";

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: VideoStatus;
  title?: string;
  description?: string;
  /** Firestore Timestamp, serialized by the callable transport. */
  createdAt?: { _seconds: number; _nanoseconds: number };
}

export interface VideoPage {
  videos: Video[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GetVideosOptions {
  limit?: number;
  cursor?: string | null;
}

export async function getVideos(
  options: GetVideosOptions = {},
): Promise<VideoPage> {
  const response = await getVideosFunction({
    // Opt in to the paginated response; without this the callable returns the
    // legacy bare array so older deployed bundles keep working.
    paged: true,
    limit: options.limit,
    cursor: options.cursor ?? undefined,
  });
  return normalizeVideoPage(response.data);
}

/**
 * Accepts both the paginated response and the older bare-array response.
 *
 * The Functions and web-client deploys run on separate Cloud Build triggers,
 * so for a few minutes after a release the browser may be talking to whichever
 * side shipped first. Tolerating both shapes means neither deploy order breaks
 * the home page.
 */
function normalizeVideoPage(data: unknown): VideoPage {
  if (Array.isArray(data)) {
    return { videos: data as Video[], nextCursor: null, hasMore: false };
  }
  const page = data as Partial<VideoPage> | null | undefined;
  if (page && Array.isArray(page.videos)) {
    return {
      videos: page.videos,
      nextCursor: page.nextCursor ?? null,
      hasMore: Boolean(page.hasMore),
    };
  }
  return { videos: [], nextCursor: null, hasMore: false };
}

export interface UploadResult {
  success: boolean;
  fileName: string;
  videoId: string;
  title?: string;
  message: string;
}

/**
 * Uploads a file, then records its title.
 *
 * The title is stored after the bytes land, not when the signed URL is issued,
 * so an abandoned upload leaves nothing behind.
 */
export async function uploadVideo(
  file: File,
  title?: string,
): Promise<UploadResult> {
  const response: any = await generateUploadUrl({
    fileExtension: file.name.split(".").pop(),
  });

  if (!response?.data?.url) {
    throw new Error("Failed to get upload URL from server");
  }

  const { url, fileName } = response.data;
  const videoId: string = response.data.videoId ?? stripExtension(fileName);

  const uploadResult = await fetch(url, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  if (!uploadResult.ok) {
    throw new Error(
      `Upload failed: ${uploadResult.status} ${uploadResult.statusText}`,
    );
  }

  const trimmedTitle = title?.trim();
  let storedTitle: string | undefined;
  try {
    const finalized: any = await finalizeUploadFunction({
      videoId,
      title: trimmedTitle,
    });
    storedTitle = finalized?.data?.title ?? undefined;
  } catch (error) {
    // The video is already in GCS and will still be processed; only the title
    // is lost. Failing the whole upload here would be a lie.
    console.warn("Upload succeeded but saving the title failed:", error);
  }

  return {
    success: true,
    fileName,
    videoId,
    title: storedTitle,
    message: "Video uploaded successfully! Processing will begin shortly.",
  };
}

function stripExtension(fileName: string): string {
  const segments = fileName.split(".");
  if (segments.length <= 1) {
    return fileName;
  }
  const candidate = segments.slice(0, -1).join(".");
  return candidate.length > 0 ? candidate : fileName;
}

export interface TranscriptResponse {
  url: string;
  transcriptId: string;
  segmentCount: number;
  durationSeconds: number;
  language?: string;
  model?: string;
}

export async function getTranscriptUrl(
  videoId: string,
  transcriptId = "primary",
): Promise<TranscriptResponse> {
  const response: any = await getTranscriptUrlFunction({
    videoId,
    transcriptId,
  });
  if (!response?.data?.url) {
    throw new Error("Transcript URL not available");
  }
  return response.data as TranscriptResponse;
}
