"use client";

import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "../firebase/firebase";
import {
  Video,
  getTranscriptUrl,
  TranscriptResponse,
} from "../firebase/functions";

interface TranscriptMeta {
  id: string;
  status?: "pending" | "running" | "failed" | "done";
  segmentCount?: number;
  durationSeconds?: number;
}

interface TranscriptSegment {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

interface TranscriptPayload {
  segments: TranscriptSegment[];
  language?: string;
  model?: string;
  durationSeconds?: number;
}

const PROCESSED_BASE =
  process.env.NEXT_PUBLIC_PROCESSED_BASE ??
  "https://storage.googleapis.com/atmuri-yt-processed-videos/";

function WatchContent() {
  const params = useSearchParams();
  const videoId = params.get("id");

  const [video, setVideo] = useState<Video | null>(null);
  const [transcriptMeta, setTranscriptMeta] = useState<TranscriptMeta | null>(
    null,
  );
  const [transcriptData, setTranscriptData] = useState<TranscriptPayload | null>(
    null,
  );
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [isTranscriptLoading, setIsTranscriptLoading] = useState(false);
  const [loadedTranscriptId, setLoadedTranscriptId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!videoId) {
      return;
    }
    const unsubscribe = onSnapshot(doc(db, "videos", videoId), (snapshot) => {
      if (!snapshot.exists()) {
        setVideo(null);
        return;
      }
      setVideo({ id: snapshot.id, ...(snapshot.data() as Video) });
    });
    return () => unsubscribe();
  }, [videoId]);

  useEffect(() => {
    if (!videoId) {
      return;
    }
    const transcriptsRef = collection(db, "videos", videoId, "transcripts");
    const q = query(transcriptsRef, orderBy("createdAt", "desc"), limit(1));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        setTranscriptMeta(null);
        return;
      }
      const data = snapshot.docs[0].data() as TranscriptMeta;
      setTranscriptMeta({
        id: snapshot.docs[0].id,
        ...data,
      });
    });
    return () => unsubscribe();
  }, [videoId]);

  useEffect(() => {
    if (
      !videoId ||
      !transcriptMeta ||
      transcriptMeta.status !== "done" ||
      transcriptMeta.id === loadedTranscriptId
    ) {
      return;
    }

    let active = true;
    const loadTranscript = async () => {
      try {
        setIsTranscriptLoading(true);
        setTranscriptError(null);
        const response: TranscriptResponse = await getTranscriptUrl(
          videoId,
          transcriptMeta.id,
        );
        const transcriptResponse = await fetch(response.url);
        if (!transcriptResponse.ok) {
          throw new Error("Transcript download failed");
        }
        const json = (await transcriptResponse.json()) as TranscriptPayload;
        if (active) {
          setTranscriptData(json);
          setLoadedTranscriptId(transcriptMeta.id);
        }
      } catch (error) {
        if (active) {
          setTranscriptError("Unable to load transcript");
          setTranscriptData(null);
        }
      } finally {
        if (active) {
          setIsTranscriptLoading(false);
        }
      }
    };

    loadTranscript();
    return () => {
      active = false;
    };
  }, [videoId, transcriptMeta, loadedTranscriptId]);

  const transcriptStatusLabel = useMemo(() => {
    if (!transcriptMeta) {
      return "Waiting for transcription job to start";
    }
    switch (transcriptMeta.status) {
      case "pending":
        return "Transcription queued";
      case "running":
        return "Transcription in progress";
      case "failed":
        return "Transcription failed";
      case "done":
        return "Transcript ready";
      default:
        return "Transcription status unknown";
    }
  }, [transcriptMeta]);

  if (!videoId) {
    return <div className="p-6">Missing video identifier.</div>;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <section>
        <h1 className="text-2xl font-semibold mb-4">Watch</h1>
        {video?.filename ? (
          <video
            controls
            preload="metadata"
            className="w-full rounded border border-gray-300"
          >
            <source src={`${PROCESSED_BASE}${video.filename}`} type="video/mp4" />
            Your browser does not support HTML5 video.
          </video>
        ) : (
          <div>Loading video metadata...</div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Transcript</h2>
          <span className="text-sm text-gray-600">{transcriptStatusLabel}</span>
        </div>
        {isTranscriptLoading && <p>Loading transcript...</p>}
        {transcriptError && <p className="text-red-600">{transcriptError}</p>}
        {transcriptMeta?.status === "failed" && (
          <p className="text-red-600">
            Transcription failed. Please retry the upload.
          </p>
        )}
        {transcriptMeta?.status !== "done" && !transcriptError && (
          <p className="text-gray-600">
            Transcript will appear here once processing finishes.
          </p>
        )}
        {transcriptMeta?.status === "done" &&
          transcriptData?.segments &&
          transcriptData.segments.length > 0 && (
            <div className="mt-4 space-y-3">
              {transcriptData.segments.map((segment, index) => (
                <div key={`${segment.startTime}-${index}`}>
                  <span className="text-xs text-gray-500 mr-2">
                    {formatTimestamp(segment.startTime)} -{" "}
                    {formatTimestamp(segment.endTime)}
                  </span>
                  <span>{segment.text}</span>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

export default function Watch() {
  return (
    <Suspense fallback={<div>Loading video...</div>}>
      <WatchContent />
    </Suspense>
  );
}

function formatTimestamp(seconds?: number) {
  if (seconds === undefined) {
    return "00:00";
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}
