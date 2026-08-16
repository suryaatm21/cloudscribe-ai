# Initial YouTube Clone Architecture

This document describes the architecture and design of the initial YouTube clone system built during Sprint 01 - Pipeline Stabilization. This foundation serves as the base for Cloudscribe AI features.

## Overview

The YouTube clone is a cloud-native monorepo application that enables users to upload videos, process them for web playback, and view them through a web interface. The system uses Google Cloud Platform (GCP) services for storage, compute, messaging, and authentication.

**Key Design Principle**: The system is built entirely on serverless/managed GCP services. We do NOT use Docker Compose or Docker volumes. Instead, we use:
- **Cloud Run** for containerized services (serverless, scales to zero)
- **GCS buckets** for persistent file storage
- **Firestore** for structured data and state
- **Pub/Sub** for asynchronous messaging between services

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                           │
│                   (Next.js Web Client)                          │
│                      Port: 3000                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              │ Firebase Auth
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Layer (Firebase Functions)               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ - generateUploadUrl() / getUploadUrl()                   │  │
│  │   → Returns signed GCS URL for direct upload             │  │
│  │ - getVideos()                                            │  │
│  │   → Returns user's video list from Firestore             │  │
│  │ - createUser()                                           │  │
│  │   → Triggered on Firebase Auth user creation             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ GCS API
                              │ (Signed URLs)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloud Storage (GCS)                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Bucket: atmuri-yt-raw-videos                             │  │
│  │   - Receives direct uploads from web client               │  │
│  │   - Triggers Pub/Sub notification on OBJECT_FINALIZE     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Cloud Storage Notification
                              │ (OBJECT_FINALIZE event)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Pub/Sub Messaging                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Topic: video-uploads-topic                               │  │
│  │   - Receives GCS notifications                            │  │
│  │   - Message format: {name, bucket, contentType}          │  │
│  │                                                           │  │
│  │ Subscription: video-processing-subscription               │  │
│  │   - Push delivery to Cloud Run endpoint                  │  │
│  │   - Endpoint: /process-video                             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP POST (Push Delivery)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         Video Processing Service (Cloud Run)                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Endpoints:                                                │  │
│  │   - POST /process-video  (Pub/Sub push handler)          │  │
│  │   - GET  /health         (Health check + dependencies)    │  │
│  │                                                           │  │
│  │ Processing Pipeline:                                      │  │
│  │   1. Decode Pub/Sub message                               │  │
│  │   2. Check Firestore for duplicate processing             │  │
│  │   3. Mark video as "processing" in Firestore              │  │
│  │   4. Download raw video from GCS                          │  │
│  │   5. Convert to 360p using ffmpeg                         │  │
│  │   6. Upload processed video to GCS                        │  │
│  │   7. Update Firestore status to "processed"               │  │
│  │   8. Cleanup local files                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ GCS API (read/write)
                              │ Firestore API (read/write)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Persistent Storage                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ GCS Buckets:                                              │  │
│  │   - atmuri-yt-raw-videos      (input)                    │  │
│  │   - atmuri-yt-processed-videos (output, public read)      │  │
│  │                                                           │  │
│  │ Firestore Collections:                                    │  │
│  │   - users/{uid}            (user profiles)                │  │
│  │   - videos/{videoId}       (video metadata + status)      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Web Client (`yt-web-client`)

**Technology**: Next.js 14, React, TypeScript  
**Deployment**: Cloud Run (containerized)  
**Purpose**: User-facing interface for video upload and viewing

**Key Features**:
- Firebase Authentication integration
- Video upload via signed URLs (direct to GCS)
- Video listing and playback
- Responsive UI

**No Docker Compose**: Deployed independently to Cloud Run. Communicates with Firebase Functions via HTTPS. No local container orchestration needed.

### 2. API Service (`api-service/functions`)

**Technology**: Firebase Functions v2, TypeScript, Express  
**Deployment**: Firebase Functions (serverless)  
**Purpose**: Backend API layer for web client

**Functions**:
- `generateUploadUrl`: Callable function for Firebase SDK clients
- `getUploadUrl`: HTTP endpoint with Bearer token auth (for REST clients)
- `getVideos`: Returns user's video list from Firestore
- `createUser`: Triggered on new Firebase Auth user creation

**State Management**: Uses Firestore for video metadata. No local state or Docker volumes required.

### 3. Video Processing Service (`video-processing-service`)

**Technology**: Node.js, Express, TypeScript, ffmpeg  
**Deployment**: Cloud Run (containerized, serverless)  
**Purpose**: Asynchronous video processing triggered by Pub/Sub

**Endpoints**:
- `POST /process-video`: Pub/Sub push handler
  - Receives Cloud Storage notification via Pub/Sub
  - Downloads raw video from GCS
  - Converts to 360p using ffmpeg
  - Uploads processed video to GCS
  - Updates Firestore status
- `GET /health`: Health check with dependency validation
  - Checks Firestore connectivity
  - Checks GCS bucket access
  - Returns service status, uptime, version

**Processing Logic**:
- Retry mechanism (configurable via `PROCESSING_MAX_ATTEMPTS`)
- Idempotent processing (checks Firestore before starting)
- Structured JSON logging with jobId correlation
- Local file cleanup after processing

**Storage Strategy**: Uses ephemeral local disk for temporary files during processing. No Docker volumes needed - files are cleaned up after each request.

### 4. Pub/Sub Infrastructure

**Topic**: `video-uploads-topic`
- Receives Cloud Storage notifications when files are finalized
- Message schema: `{name: string, bucket: string, contentType: string}`

**Subscription**: `video-processing-subscription`
- Push delivery to Cloud Run `/process-video` endpoint
- Service account authentication
- Automatic retry on HTTP 5xx responses
- Dead letter topic for repeatedly failed messages (planned)

### 5. Cloud Storage (GCS)

**Buckets**:
1. **`atmuri-yt-raw-videos`** (Input)
   - Receives direct uploads from web client via signed URLs
   - Configured with Cloud Storage notification to Pub/Sub
   - Event: `OBJECT_FINALIZE`

2. **`atmuri-yt-processed-videos`** (Output)
   - Stores processed 360p videos
   - Public read access for video playback
   - Used by web client for streaming

**No Docker Volumes**: All files stored in GCS. Services use GCS API to read/write files. No shared filesystem needed.

### 6. Firestore Database

**Collections**:
- `users/{uid}`: User profiles (auto-created on Firebase Auth signup)
- `videos/{videoId}`: Video metadata and processing status
  ```typescript
  {
    id: string;           // Video ID (filename without extension)
    uid: string;          // User ID
    filename: string;     // Processed filename
    status: "processing" | "processed" | "failed";
    title?: string;
    description?: string;
  }
  ```

**Indexes**: Composite indexes on `uid` + `status` for user video queries

**State Management**: All application state stored in Firestore. No in-memory state or Docker volumes for persistence.

## Data Flow

### Upload Flow

1. **User uploads video** (Web Client)
   - Calls `generateUploadUrl()` Firebase Function
   - Receives signed GCS URL (15-minute expiration)
   - Uploads video directly to `atmuri-yt-raw-videos` bucket

2. **Cloud Storage triggers Pub/Sub** (GCS Notification)
   - File finalized → `OBJECT_FINALIZE` event
   - Publishes message to `video-uploads-topic`
   - Message contains: `{name, bucket, contentType}`

3. **Pub/Sub pushes to Cloud Run** (Push Delivery)
   - Subscription `video-processing-subscription` receives message
   - HTTP POST to `/process-video` endpoint
   - Includes Pub/Sub message in request body

4. **Video Processing Service handles request**
   - Decodes Pub/Sub message
   - Checks Firestore for duplicate (idempotency)
   - Marks video as "processing" in Firestore
   - Downloads raw video from GCS to local disk
   - Converts to 360p using ffmpeg
   - Uploads processed video to `atmuri-yt-processed-videos`
   - Updates Firestore status to "processed"
   - Cleans up local files
   - Returns 200 OK to Pub/Sub

5. **User sees success** (Web Client)
   - Polls or listens to Firestore for status change
   - Displays processed video

## Technology Choices

### Why Cloud Run Instead of Docker Compose?

**Docker Compose** would require:
- Running containers locally or on a VM
- Managing container networking and volumes
- Handling service discovery
- Managing local infrastructure

**Cloud Run** provides:
- Serverless scaling (zero to N instances automatically)
- No infrastructure management
- Built-in load balancing and HTTPS
- Pay-per-use pricing
- Integrated with GCP services (IAM, logging, monitoring)

### Why GCS + Firestore Instead of Docker Volumes?

**Docker Volumes** would require:
- Shared filesystem between containers
- Volume lifecycle management
- Backup and disaster recovery setup
- Scaling challenges

**GCS + Firestore** provides:
- Managed persistence with 99.99% availability
- Automatic backups and redundancy
- Unlimited scale
- Fine-grained access control (IAM)
- Direct API access from any service
- Built-in versioning and retention policies

### Why Pub/Sub Instead of Direct Service Calls?

**Direct HTTP calls** would require:
- Service discovery (DNS, service registry)
- Retry logic and circuit breakers
- Queue management for high load

**Pub/Sub** provides:
- Decoupled, asynchronous messaging
- Automatic retries and dead letter queues
- Guaranteed at-least-once delivery
- Built-in message ordering (optional)
- No service discovery needed (push delivery)

## Deployment Architecture

### CI/CD Pipeline

```
GitHub Push → Cloud Build Trigger
                    │
                    ├─→ Build Docker Images
                    ├─→ Push to Artifact Registry
                    ├─→ Run Tests (npm test)
                    └─→ Deploy to Cloud Run
```

**No Docker Compose**: Each service is deployed independently. Services communicate via HTTP/HTTPS and GCP APIs, not container networking.

### Service Isolation

- **Web Client**: Deployed to Cloud Run with `allow-unauthenticated` ingress
- **API Service**: Deployed as Firebase Functions (managed by Firebase)
- **Video Processing Service**: Deployed to Cloud Run with `internal` ingress (only accessible via Pub/Sub or VPC)

Services are isolated but communicate via:
- HTTPS for web client → API
- Pub/Sub for API → video processing
- GCS API for file access
- Firestore API for data access

## Current Limitations

1. **Processing Timeout**: Pub/Sub expects HTTP ack within 600s. Videos >10 min may timeout, requiring pull subscriptions or async processing.

2. **No Adaptive Streaming**: Videos served directly from GCS without HLS/DASH. Global users may experience slow playback.

3. **Limited Error Recovery**: Failed processing retries up to 3 times, then marks as failed. No manual retry UI.

4. **Single Region**: All resources in `us-central1`. No multi-region failover.

These limitations will be addressed in future sprints as we extend the architecture for Cloudscribe AI features.

## Summary

The initial YouTube clone architecture uses **managed GCP services** for all persistence and messaging. We **do NOT use Docker Compose or Docker volumes** because:

1. **Cloud Run** handles container orchestration serverlessly
2. **GCS buckets** provide persistent file storage
3. **Firestore** provides structured data storage
4. **Pub/Sub** provides asynchronous messaging

This serverless architecture provides:
- ✅ Zero infrastructure management
- ✅ Automatic scaling
- ✅ High availability
- ✅ Cost efficiency (pay-per-use)
- ✅ Easy deployment and testing

This foundation enables easy extension for AI features in subsequent sprints without requiring architectural changes to container orchestration or storage patterns.
