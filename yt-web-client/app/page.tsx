"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getVideos, Video } from "./firebase/functions";
import styles from "./page.module.css";

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const vids = await getVideos();
        setVideos(vids);
      } catch (error) {
        console.error("Error fetching videos:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchVideos();
  }, []);

  if (loading) {
    return (
      <main>
        <p>Loading videos...</p>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      {videos.length === 0 ? (
        <p>No videos available yet. Upload your first video!</p>
      ) : (
        <div className={styles.videoGrid}>
          {videos.map((video) => {
            const targetId = video.id || video.filename?.split(".")[0] || "";
            return (
              <Link
                href={`/watch?id=${targetId}`}
                key={video.id || video.filename}
                className={styles.videoCard}
              >
              <Image
                src={"/thumbnail.png"}
                alt={video.title || "video"}
                width={320}
                height={180}
                className={styles.thumbnail}
              />
              <div className={styles.videoInfo}>
                <h3>{video.title || video.filename}</h3>
                <p>{video.status}</p>
              </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
