"use client";

// this hook comes from Next.js13 so GPT may not be able to understand it given the cutoff of its training data in 2021
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function WatchContent() {
  const videoPrefix =
    "https://storage.googleapis.com/atmuri-yt-processed-videos/";

  // use the hook to parse the URL and get the video filename
  const videoSrc = useSearchParams().get("v");

  // add the baseURl from the storage bucket to the video filename
  return (
    <div>
      <h1>Watch Page</h1>
      <video controls src={videoPrefix + videoSrc} />
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
