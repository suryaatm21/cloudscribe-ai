"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getVideos, Video, VideoStatus } from "./firebase/functions";
import styles from "./page.module.css";

const PAGE_SIZE = 12;

function videoIdFromFilename(filename?: string): string | undefined {
  if (!filename) {
    return undefined;
  }
  const segments = filename.split(".");
  if (segments.length <= 1) {
    return filename;
  }
  const candidate = segments.slice(0, -1).join(".");
  return candidate.length > 0 ? candidate : filename;
}

/**
 * Falls back to the stored object name when a video predates titled uploads,
 * stripping the `processed-` prefix and the `{uid}-{timestamp}` scaffolding so
 * the card shows something a human can read.
 */
function displayTitle(video: Video): string {
  if (video.title) {
    return video.title;
  }
  const base = video.filename ?? video.id ?? "Untitled";
  const withoutPrefix = base.replace(/^processed-/, "");
  const withoutExtension = withoutPrefix.replace(/\.[^.]+$/, "");
  // Upload ids look like `{uid}-{epochMillis}`; the uid is noise to the owner.
  const trailingTimestamp = withoutExtension.match(/-(\d{10,})$/);
  if (trailingTimestamp) {
    const uploadedAt = new Date(Number(trailingTimestamp[1]));
    if (!Number.isNaN(uploadedAt.getTime())) {
      return `Untitled lecture — ${uploadedAt.toLocaleDateString()}`;
    }
  }
  return withoutExtension || "Untitled";
}

function statusLabel(status?: VideoStatus): string {
  switch (status) {
    case "processed":
      return "Ready";
    case "processing":
      return "Processing…";
    case "failed":
      return "Processing failed";
    default:
      // The upload landed but the worker has not claimed it yet.
      return "Queued";
  }
}

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getVideos({ limit: PAGE_SIZE });
      setVideos(page.videos);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error("Error fetching videos:", err);
      setError(
        err instanceof Error ? err.message : "Could not load your videos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
    // The upload dialog announces success so a new video shows up without a
    // manual refresh.
    window.addEventListener("cloudscribe:video-uploaded", loadFirstPage);
    return () => {
      window.removeEventListener("cloudscribe:video-uploaded", loadFirstPage);
    };
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (!cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      const page = await getVideos({ limit: PAGE_SIZE, cursor });
      // Guard against a duplicate id slipping in if a page boundary shifts.
      setVideos((current) => {
        const seen = new Set(current.map((video) => video.id));
        return [...current, ...page.videos.filter((v) => !seen.has(v.id))];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      console.error("Error loading more videos:", err);
      setError(
        err instanceof Error ? err.message : "Could not load more videos.",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <main className={styles.main}>
        <p>Loading videos...</p>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      {error && <p className={styles.error}>{error}</p>}

      {videos.length === 0 && !error ? (
        <p>No videos available yet. Upload your first video!</p>
      ) : (
        <>
          <div className={styles.videoGrid}>
            {videos.map((video) => {
              const targetId = video.id || videoIdFromFilename(video.filename);
              if (!targetId) {
                return null;
              }
              const title = displayTitle(video);
              return (
                <Link
                  href={`/watch?id=${encodeURIComponent(targetId)}`}
                  key={targetId}
                  className={styles.videoCard}
                >
                  <Image
                    src={"/thumbnail.png"}
                    alt={title}
                    width={320}
                    height={180}
                    className={styles.thumbnail}
                  />
                  <div className={styles.videoInfo}>
                    <h3 title={title}>{title}</h3>
                    <p>{statusLabel(video.status)}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          {hasMore && (
            <div className={styles.loadMoreRow}>
              <button
                type="button"
                className={styles.loadMoreButton}
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
