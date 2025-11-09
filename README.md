# YouTube Clone Project Status

This document outlines the current status, architecture, and next steps for the YouTube Clone project.

## 🚀 Current Status

This project is a cloud-native video processing and hosting service. Users can upload videos, which are then processed and made available for viewing. The core functionalities for user authentication, video upload, and video processing are in place.

The project is currently in a state where the main components are functional, but there are opportunities for improvement, especially in error handling, user experience, and feature completeness.

## 🏗️ Project Architecture

The project is a monorepo composed of three main services:

1.  **`yt-web-client`**: A [Next.js](https://nextjs.org/) frontend that provides the user interface for video upload and viewing. It handles user authentication via Firebase.
2.  **`api-service`**: A set of [Firebase Functions](https://firebase.google.com/docs/functions) (written in TypeScript) that provide the backend API for the web client. This includes functions for generating signed URLs for video uploads and managing user data.
3.  **`video-processing-service`**: A Node.js service (using Express) that listens for new video uploads via Google Cloud Pub/Sub. When a new video is uploaded to the `raw-videos` bucket, this service is triggered to process it and move it to the `processed-videos` bucket.

These services interact with the following Google Cloud services:

- **Firebase Authentication**: For user sign-in and management.
- **Firebase Functions**: For serverless backend logic.
- **Google Cloud Storage (GCS)**: For storing raw and processed videos.
- **Google Cloud Pub/Sub**: For messaging between the upload and processing services.

## 🧪 Testing Instructions

To run the full application for testing, you will need to run each of the three main services in separate terminals.

### 1. Run the API Service (Firebase Emulators)

This will start the local Firebase emulators for Functions, Firestore, and Authentication.

```bash
cd api-service/functions
npm run dev
```

### 2. Run the Web Client

This will start the Next.js development server for the frontend.

```bash
cd yt-web-client
npm run dev
```

The web client will be available at [http://localhost:3000](http://localhost:3000).

### 3. Run the Video Processing Service

This will start the service that processes uploaded videos.

```bash
cd video-processing-service
npm run start
```

This service runs on port 3001 to avoid conflicts with the web client.

## 🛣️ Next Steps

Here are some potential next steps to continue development:

- **Implement Video Playback**: The `watch` page in the web client is a placeholder. Implement video playback for processed videos.
- **Display User's Videos**: Create a page or component to list all videos uploaded by the currently authenticated user.
- **Improve Error Handling**: Add more robust error handling throughout the application, especially for video upload and processing failures.
- **Add Video Metadata**: Extend the data model to include video titles, descriptions, and other metadata.
- **Secure GCS Buckets**: Currently, the GCS buckets are public. Implement proper security rules to restrict access.
- **Refine UI/UX**: The current UI is basic. Improve the user experience with better styling and more intuitive workflows.

## 🐞 Known Bugs

- **CORS Issues**: There have been some CORS-related issues between the web client and the Firebase Functions. While some fixes have been implemented, it's an area to keep an eye on.
- **Port Conflict**: The video processing service was conflicting with the web client on port 3000. This has been resolved by moving the processing service to port 3001, but it's a good example of the kind of issue to watch for in a multi-service architecture.

This document should give you a clear picture of where the project stands. Let me know if you have any other questions!
