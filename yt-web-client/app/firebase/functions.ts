import { getFunctions, httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const generateUploadUrl = httpsCallable(functions, "generateUploadUrl");
const getVideosFunction = httpsCallable(functions, "getVideos");

export interface Video {
  id?: string;
  uid?: string;
  filename?: string;
  status?: "processing" | "processed";
  title?: string;
  description?: string;
}

export async function getVideos(): Promise<Video[]> {
  const response: any = await getVideosFunction();
  return response.data as Video[];
}

export async function uploadVideo(file: File) {
  const response: any = await generateUploadUrl({
    fileExtension: file.name.split(".").pop(),
  });

  if (!response?.data?.url) {
    throw new Error("Failed to get upload URL from server");
  }

  // upload file to the signed URL returned as response by our await function call above
  const uploadResult = await fetch(response?.data?.url, {
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

  return {
    success: true,
    fileName: response.data.fileName,
    message: "Video uploaded successfully! Processing will begin shortly.",
  };
}
