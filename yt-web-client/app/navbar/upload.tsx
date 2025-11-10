'use client';

import { Fragment } from 'react';
import { uploadVideo } from '../firebase/functions';

import styles from './upload.module.css';

export default function Upload() {
  // If the user selects a file, we will call the handleFileChange function
  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.item(0);
    if (file) {
      handleUpload(file);
    }
  };

  // Handle the file upload with the uploadVideo function we created in firebase/functions.ts and error handling
  const handleUpload = async (file: File) => {
    try {
      // Show loading alert
      console.log(`📤 Uploading ${file.name}...`);
      
      const response = await uploadVideo(file);
      
      // Show success alert with details
      alert(
        `✅ ${response.message}\n\n` +
        `📁 File: ${response.fileName}\n` +
        `⏳ Your video is being processed. Check back in a few minutes!`
      );
    } catch (error) {
      // Show detailed error
      console.error('Upload error:', error);
      alert(`❌ Failed to upload file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    // Use a Fragment to wrap the input and label because Typescript only allows one child element to be returned
    <Fragment>
      <input
        id="upload"
        className={styles.uploadInput}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
      />
      <label htmlFor="upload" className={styles.uploadButton}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="size-6">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
          />
        </svg>
      </label>
    </Fragment>
  );
}
