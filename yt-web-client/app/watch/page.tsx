"use client";

import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "../firebase/firebase";
import {
  Video,
  getTranscriptUrl,
  TranscriptResponse,
} from "../firebase/functions";
import styles from "./watch.module.css";

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
      setVideo({ ...(snapshot.data() as Video), id: snapshot.id });
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
      const data = snapshot.docs[0].data() as Omit<TranscriptMeta, "id">;
      setTranscriptMeta({
        ...data,
        id: snapshot.docs[0].id,
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
      } catch {
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
    return <div className={styles.page}>Missing video identifier.</div>;
  }

  return (
    <div className={styles.page}>
      <section>
        <h1 className={styles.title}>Watch</h1>
        {video?.filename ? (
          <video
            controls
            preload="metadata"
            className={styles.player}
          >
            <source src={`${PROCESSED_BASE}${video.filename}`} type="video/mp4" />
            Your browser does not support HTML5 video.
          </video>
        ) : (
          <div>Loading video metadata...</div>
        )}
      </section>

      <section>
        <div className={styles.transcriptHeader}>
          <h2 className={styles.transcriptTitle}>Transcript</h2>
          <span className={styles.status}>{transcriptStatusLabel}</span>
        </div>
        {isTranscriptLoading && <p>Loading transcript...</p>}
        {transcriptError && <p className={styles.error}>{transcriptError}</p>}
        {transcriptMeta?.status === "failed" && (
          <p className={styles.error}>
            Transcription failed. Please retry the upload.
          </p>
        )}
        {transcriptMeta?.status !== "done" && !transcriptError && (
          <p className={styles.muted}>
            Transcript will appear here once processing finishes.
          </p>
        )}
        {transcriptMeta?.status === "done" &&
          transcriptData?.segments &&
          transcriptData.segments.length > 0 && (
            <div className={styles.segments}>
              {transcriptData.segments.map((segment, index) => (
                <div key={index}>
                  <span className={styles.timestamp}>
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
