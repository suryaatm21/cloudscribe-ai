# YouTube Clone Project Status

This document outlines the current status, architecture, and next steps for the YouTube Clone project.

## 🚀 Current Status

This project is a cloud-native video processing and hosting service. Users can upload videos, which are then processed and made available for viewing. The core functionalities for user authentication, video upload, and video processing are in place.

The project is currently in a state where the main components are functional, but there are opportunities for improvement, especially in error handling, user experience, and feature completeness.

## 🏗️ Project Architecture

<img width="1366" height="768" alt="image" src="https://github.com/user-attachments/assets/fbc9b1eb-180d-424f-91da-e0a17e091d4e" />

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

To test the full application, you need to deploy the backend services and run the web client.

### Prerequisites

- ✅ Video Processing Service is deployed to Cloud Run
- ⏳ API Service (Firebase Functions) needs to be deployed
- ⏳ Web Client needs to be running locally

### 1. Deploy the API Service (Firebase Functions)

Deploy the Firebase Functions to the cloud (not using emulators for production setup).

```bash
cd api-service/functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

### 2. Run the Web Client

This will start the Next.js development server for the frontend.

```bash
cd yt-web-client
npm run dev
```

The web client will be available at [http://localhost:3000](http://localhost:3000).

### 3. Video Processing Service Status

✅ **Already Deployed to Cloud Run!**  
The video processing service is running at: `https://video-processing-service-rfrkdig5jq-uc.a.run.app`

It automatically processes videos when they're uploaded. No manual startup needed!

To redeploy after changes:

```bash
cd video-processing-service
./deploy.sh
```

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
