"use client";

import {
  collection,
  doc,
  FirestoreError,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { db, onAuthStateChangedHelper } from "../firebase/firebase";
import {
  Video,
  getTranscriptUrl,
  TranscriptResponse,
} from "../firebase/functions";
import styles from "./watch.module.css";

interface TranscriptMeta {
  id: string;
  status?:
    | "pending"
    | "running"
    | "failed"
    | "done"
    | "needs_review"
    | "no_audio_detected";
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

type AuthStatus = "loading" | "signed-out" | "signed-in";

type SubscriptionState =
  | "loading"
  | "ready"
  | "not-found"
  | "permission-denied"
  | "error";

const PROCESSED_BASE =
  process.env.NEXT_PUBLIC_PROCESSED_BASE ??
  "https://storage.googleapis.com/atmuri-yt-processed-videos/";

function permissionDeniedMessage(signedIn: boolean, resource: "video" | "transcript") {
  if (!signedIn) {
    return resource === "video"
      ? "Sign in to view this video."
      : "Sign in to view the transcript.";
  }
  return resource === "video"
    ? "You don't have access to this video."
    : "You don't have access to this transcript.";
}

function snapshotErrorState(error: FirestoreError): SubscriptionState {
  if (error.code === "permission-denied") {
    return "permission-denied";
  }
  console.error("Firestore subscription error:", error);
  return "error";
}

function WatchContent() {
  const params = useSearchParams();
  const videoId = params.get("id");

  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [video, setVideo] = useState<Video | null>(null);
  const [videoState, setVideoState] = useState<SubscriptionState>("loading");
  const [transcriptMeta, setTranscriptMeta] = useState<TranscriptMeta | null>(
    null,
  );
  const [transcriptState, setTranscriptState] =
    useState<SubscriptionState>("loading");
  const [transcriptData, setTranscriptData] = useState<TranscriptPayload | null>(
    null,
  );
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [isTranscriptLoading, setIsTranscriptLoading] = useState(false);
  const [loadedTranscriptId, setLoadedTranscriptId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChangedHelper((nextUser) => {
      setAuthStatus(nextUser ? "signed-in" : "signed-out");
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!videoId) {
      return;
    }

    if (authStatus === "loading") {
      return;
    }

    if (authStatus === "signed-out") {
      setVideo(null);
      setVideoState("permission-denied");
      return;
    }

    setVideo(null);
    setVideoState("loading");

    const unsubscribe = onSnapshot(
      doc(db, "videos", videoId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setVideo(null);
          setVideoState("not-found");
          return;
        }
        setVideo({ ...(snapshot.data() as Video), id: snapshot.id });
        setVideoState("ready");
      },
      (error) => {
        setVideo(null);
        setVideoState(snapshotErrorState(error));
      },
    );
    return () => unsubscribe();
  }, [videoId, authStatus]);

  useEffect(() => {
    if (!videoId) {
      return;
    }

    if (authStatus === "loading") {
      return;
    }

    if (authStatus === "signed-out") {
      setTranscriptMeta(null);
      setTranscriptState("permission-denied");
      return;
    }

    setTranscriptMeta(null);
    setTranscriptState("loading");

    const transcriptsRef = collection(db, "videos", videoId, "transcripts");
    const q = query(transcriptsRef, orderBy("createdAt", "desc"), limit(1));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setTranscriptMeta(null);
        } else {
          const data = snapshot.docs[0].data() as Omit<TranscriptMeta, "id">;
          setTranscriptMeta({
            ...data,
            id: snapshot.docs[0].id,
          });
        }
        setTranscriptState("ready");
      },
      (error) => {
        setTranscriptMeta(null);
        setTranscriptState(snapshotErrorState(error));
      },
    );
    return () => unsubscribe();
  }, [videoId, authStatus]);

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

  const signedIn = authStatus === "signed-in";

  const transcriptStatusLabel = useMemo(() => {
    if (transcriptState === "loading") {
      return "Loading transcript status...";
    }
    if (transcriptState === "permission-denied") {
      return permissionDeniedMessage(signedIn, "transcript");
    }
    if (transcriptState === "error") {
      return "Unable to load transcript status";
    }
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
      case "needs_review":
        return "Transcription needs review";
      case "done":
        return "Transcript ready";
      case "no_audio_detected":
        return "No speech detected in this video";
      default:
        return "Transcription status unknown";
    }
  }, [transcriptMeta, transcriptState, signedIn]);

  if (!videoId) {
    return <div className={styles.page}>Missing video identifier.</div>;
  }

  return (
    <div className={styles.page}>
      <section>
        <h1 className={styles.title}>Watch</h1>
        {videoState === "loading" && <div>Loading video metadata...</div>}
        {videoState === "not-found" && (
          <p className={styles.error}>This video could not be found.</p>
        )}
        {videoState === "permission-denied" && (
          <p className={styles.error}>
            {permissionDeniedMessage(signedIn, "video")}
          </p>
        )}
        {videoState === "error" && (
          <p className={styles.error}>Unable to load video metadata.</p>
        )}
        {videoState === "ready" && video?.filename && (
          <video
            controls
            preload="metadata"
            className={styles.player}
          >
            <source src={`${PROCESSED_BASE}${video.filename}`} type="video/mp4" />
            Your browser does not support HTML5 video.
          </video>
        )}
      </section>

      <section>
        <div className={styles.transcriptHeader}>
          <h2 className={styles.transcriptTitle}>Transcript</h2>
          <span className={styles.status}>{transcriptStatusLabel}</span>
        </div>
        {transcriptState === "permission-denied" && (
          <p className={styles.error}>
            {permissionDeniedMessage(signedIn, "transcript")}
          </p>
        )}
        {transcriptState === "error" && (
          <p className={styles.error}>Unable to load transcript status.</p>
        )}
        {isTranscriptLoading && <p>Loading transcript...</p>}
        {transcriptError && <p className={styles.error}>{transcriptError}</p>}
        {transcriptState === "ready" && transcriptMeta?.status === "failed" && (
          <p className={styles.error}>
            Transcription failed. Please retry the upload.
          </p>
        )}
        {transcriptState === "ready" &&
          transcriptMeta?.status === "no_audio_detected" && (
          <p className={styles.muted}>
            No speech detected in this video
          </p>
        )}
        {transcriptState === "ready" &&
          transcriptMeta?.status !== "done" &&
          transcriptMeta?.status !== "no_audio_detected" &&
          !transcriptError && (
          <p className={styles.muted}>
            Transcript will appear here once processing finishes.
          </p>
        )}
        {transcriptState === "ready" &&
          transcriptMeta?.status === "done" &&
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
