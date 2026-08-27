"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { uploadVideo } from "../firebase/functions";

import styles from "./upload.module.css";

const MAX_TITLE_LENGTH = 200;

/** Suggests a title from the filename so the field is never blank on open. */
function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[_-]+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}

export default function Upload() {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingFile) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [pendingFile]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.item(0);
    if (file) {
      setPendingFile(file);
      setTitle(titleFromFileName(file.name));
      setError(null);
    }
    // Reset so picking the same file again still fires onChange.
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const closeDialog = () => {
    setPendingFile(null);
    setTitle("");
    setError(null);
  };

  const handleUpload = async () => {
    if (!pendingFile) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadVideo(pendingFile, title);
      closeDialog();
      // The home page reads through a callable, so it needs a nudge to refetch.
      window.dispatchEvent(new Event("cloudscribe:video-uploaded"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Fragment>
      <input
        id="upload"
        ref={inputRef}
        className={styles.uploadInput}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
      />
      <label htmlFor="upload" className={styles.uploadButton} title="Upload a lecture">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="size-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
          />
        </svg>
      </label>

      {pendingFile && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-dialog-heading"
          onClick={(event) => {
            if (event.target === event.currentTarget && !uploading) {
              closeDialog();
            }
          }}
        >
          <div className={styles.dialog}>
            <h2 id="upload-dialog-heading" className={styles.dialogHeading}>
              Name this lecture
            </h2>
            <p className={styles.fileName}>{pendingFile.name}</p>

            <label htmlFor="video-title" className={styles.fieldLabel}>
              Title
            </label>
            <input
              id="video-title"
              ref={titleRef}
              className={styles.titleInput}
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              disabled={uploading}
              placeholder="e.g. Linear Algebra, Week 3"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleUpload();
                } else if (event.key === "Escape" && !uploading) {
                  closeDialog();
                }
              }}
            />

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={closeDialog}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Fragment>
  );
}
