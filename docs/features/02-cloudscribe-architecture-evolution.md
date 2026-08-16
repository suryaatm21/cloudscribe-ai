# Cloudscribe Architecture Evolution

This document outlines how the initial YouTube clone architecture is being extended to support Cloudscribe AI features: transcription, semantic summarization (notes), RAG indexing, study chatbot, and live transcription.

## Overview

Cloudscribe extends the YouTube clone with AI-powered features for educational content. The architecture maintains the same serverless, GCP-native approach while adding:
- **Vertex AI Speech-to-Text v2** for transcription
- **Vertex AI Gemini** for semantic summarization and chatbot
- **Vertex AI RAG Engine** for knowledge retrieval
- **Additional GCS buckets** for transcripts, notes, and retrieval artifacts
- **New Cloud Run services** for AI processing
- **Enhanced Pub/Sub topics** for multi-stage pipelines

**Key Principle**: Continue using GCS + Firestore instead of Docker volumes. All state persists in managed services.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Initial YouTube Clone Flow                         │
│  Web Client → API → GCS (raw) → Pub/Sub → Video Processing → GCS      │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ (Video processed)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  Cloudscribe AI Extension Layer                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  1. Transcription Service (Sprint 2)                            │  │
│  │     Video → Speech-to-Text v2 → Transcripts GCS + Firestore     │  │
│  │                                                                  │  │
│  │  2. Notes Service (Sprint 3)                                    │  │
│  │     Transcript → Vertex AI Gemini → Notes GCS + Firestore       │  │
│  │                                                                  │  │
│  │  3. RAG Indexing Pipeline (Sprint 4)                            │  │
│  │     Transcripts/Notes → Chunking → Vertex AI RAG Engine         │  │
│  │                                                                  │  │
│  │  4. Study Chatbot (Sprint 5)                                    │  │
│  │     Query → RAG Retrieval → Gemini → Response + Citations       │  │
│  │                                                                  │  │
│  │  5. Live Transcription (Sprint 6)                               │  │
│  │     Browser Mic → WebSocket → Speech-to-Text Streaming          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Extensions

### 1. Video Processing Service Modifications

**Current Logic**: Converts video to 360p, uploads to processed bucket, updates Firestore.

**Enhanced Logic** (Sprint 2+):

```typescript
async function processVideo(inputFileName, outputFileName, videoId) {
  // Existing: Video processing
  await downloadRawVideo(inputFileName);
  await convertVideo(inputFileName, outputFileName);
  await uploadProcessedVideo(outputFileName);
  await setVideo(videoId, { status: "processed" });

  // NEW: Trigger transcription pipeline
  await publishTranscriptionJob(videoId, {
    rawVideoUri: `gs://${RAW_BUCKET}/${inputFileName}`,
    processedVideoUri: `gs://${PROCESSED_BUCKET}/${outputFileName}`,
    userId: extractUserId(videoId),
  });
}
```

**Changes**:
- After successful video processing, publishes message to `transcription-jobs-topic`
- Does NOT block on transcription completion (async pipeline)
- Adds `transcriptStatus` field to Firestore video document

**Storage Impact**: No change to existing buckets. Transcription service uses new `transcripts/` bucket.

### 2. Transcription Service (NEW - Sprint 2)

**Service**: Cloud Run service (Node.js/Express)  
**Trigger**: Pub/Sub topic `transcription-jobs-topic`  
**Purpose**: Batch transcription using Vertex AI Speech-to-Text v2

**Endpoints**:
- `POST /transcribe`: Pub/Sub push handler
  - Receives job metadata: `{videoId, rawVideoUri, userId, language}`
  - Submits async transcription job to Speech-to-Text v2
  - Polls for completion or uses webhook (if supported)
  - Stores transcript JSON in `transcripts/` GCS bucket
  - Updates Firestore `Transcripts` collection

**Storage Schema**:

**New GCS Bucket**: `transcripts/`
```
transcripts/
  {videoId}/
    transcript.json          (Speech-to-Text output)
    segments.json            (Timestamped segments)
```

**New Firestore Collection**: `transcripts/{transcriptId}`
```typescript
{
  transcriptId: string;
  videoId: string;
  userId: string;
  status: "pending" | "running" | "failed" | "done";
  gcsUri: string;              // gs://transcripts/{videoId}/transcript.json
  language: string;
  model: "long" | "short";     // Speech-to-Text v2 model
  createdAt: Timestamp;
  completedAt?: Timestamp;
  error?: string;
  metadata: {
    duration: number;
    segmentCount: number;
  };
}
```

**Pub/Sub Topics**:
- **Input**: `transcription-jobs-topic` (from video processing service)
- **Output**: `transcription-complete-topic` (triggers notes generation)

**No Docker Volumes**: Transcripts stored in GCS. Firestore tracks job status. Service is stateless.

### 3. Notes Service (NEW - Sprint 3)

**Service**: Cloud Run service (Node.js/Express, Vertex AI SDK)  
**Trigger**: Pub/Sub topic `transcription-complete-topic`  
**Purpose**: Generate study notes from transcripts using Vertex AI Gemini

**Endpoints**:
- `POST /generate-notes`: Pub/Sub push handler
  - Receives transcript metadata: `{transcriptId, videoId, userId}`
  - Fetches transcript JSON from GCS
  - Calls Vertex AI Gemini with prompt template
  - Generates structured notes (outline, key takeaways, action items)
  - Stores markdown in `notes/` GCS bucket
  - Updates Firestore `Notes` collection

**Storage Schema**:

**New GCS Bucket**: `notes/`
```
notes/
  {videoId}/
    notes-v1.md               (Markdown notes)
    notes-v{version}.md       (Versioned notes if regenerated)
```

**New Firestore Collection**: `notes/{noteId}`
```typescript
{
  noteId: string;
  transcriptId: string;
  videoId: string;
  userId: string;
  status: "pending" | "running" | "failed" | "done";
  gcsUri: string;              // gs://notes/{videoId}/notes-v1.md
  promptVersion: string;       // Version ID from prompt template repo
  model: string;               // Gemini model used (e.g., "gemini-1.5-pro")
  createdAt: Timestamp;
  completedAt?: Timestamp;
  error?: string;
  metadata: {
    sectionCount: number;
    actionItemCount: number;
    tokenCount: number;
  };
}
```

**Prompt Template Repository**: Versioned folder in codebase or GCS
```
prompts/
  study-notes-v1.yaml
  study-notes-v2.yaml
```

**Pub/Sub Topics**:
- **Input**: `transcription-complete-topic` (from transcription service)
- **Output**: `notes-complete-topic` (triggers RAG indexing)

**Feature Flag**: `FEATURE_GENERATE_NOTES` in Firestore/Secret Manager
- When disabled, notes job creation is skipped
- Transcript flow continues unaffected

**No Docker Volumes**: Notes stored in GCS. Prompt templates versioned in codebase or GCS. Service is stateless.

### 4. RAG Indexing Pipeline (NEW - Sprint 4)

**Service**: Cloud Run service or Cloud Build job  
**Trigger**: Cloud Scheduler (nightly) + on-demand API endpoint  
**Purpose**: Chunk transcripts/notes and index in Vertex AI RAG Engine

**Components**:

**Chunking Library** (reusable):
```typescript
// Shared utility for token-based chunking
function chunkText(text: string, maxTokens: number, overlap: number): Chunk[] {
  // Token-based chunking with overlap
  // Returns: [{text, startToken, endToken, metadata}]
}
```

**Indexing Service**:
- Reads transcripts/notes from GCS
- Chunks using shared library
- Generates JSONL file for Vertex AI RAG ingestion
- Uploads to `retrieval-artifacts/` bucket
- Submits ingestion job to Vertex AI RAG Engine
- Updates Firestore `RetrievalArtifacts` collection

**Storage Schema**:

**New GCS Bucket**: `retrieval-artifacts/`
```
retrieval-artifacts/
  batch-{timestamp}/
    chunks.jsonl              (Vertex AI RAG format)
  {videoId}/
    chunks.jsonl              (Per-video chunks)
```

**New Firestore Collection**: `retrievalArtifacts/{artifactId}`
```typescript
{
  artifactId: string;
  videoId: string;
  transcriptId?: string;
  noteId?: string;
  userId: string;
  workspaceId: string;
  status: "pending" | "indexing" | "done" | "failed";
  datastoreId: string;        // Vertex AI RAG datastore ID
  batchId?: string;           // Batch ingestion ID
  chunkCount: number;
  gcsUri: string;             // gs://retrieval-artifacts/{...}/chunks.jsonl
  indexedAt: Timestamp;
  lastIndexedAt: Timestamp;   // For reindexing
  metadata: {
    segmentRange?: string;    // e.g., "0-500"
    noteVersionId?: string;
  };
}
```

**Vertex AI RAG Datastore**:
- Managed by Vertex AI (not GCS or Firestore)
- Stores embeddings and metadata
- Queried via Vertex AI Search API

**Scheduling**:
- **Nightly**: Cloud Scheduler triggers indexing job for all eligible transcripts
- **On-demand**: `POST /index/{mediaId}` API endpoint for backfilling

**No Docker Volumes**: Chunks stored as JSONL in GCS. Vertex AI manages the actual embedding datastore.

### 5. Study Chatbot Service (NEW - Sprint 5)

**Service**: Cloud Run service (Node.js/Express, Vertex AI SDK)  
**Trigger**: Web client HTTP requests  
**Purpose**: Answer questions using RAG-retrieved context and Gemini

**Endpoints**:
- `POST /chat`: Chat endpoint
  - Validates Firebase auth token
  - Retrieves relevant chunks from Vertex AI RAG (filtered by `workspaceId` + `userId`)
  - Constructs prompt with context and user question
  - Calls Gemini with citation template
  - Returns response + cited chunk IDs
  - Stores conversation in Firestore

**Storage Schema**:

**New Firestore Collection**: `conversations/{conversationId}`
```typescript
{
  conversationId: string;
  userId: string;
  workspaceId: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: Timestamp;
    citedChunkIds?: string[];  // Chunk IDs from RAG retrieval
  }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**RAG Retrieval Flow**:
1. Query Vertex AI RAG with user question + filters (`workspaceId`, `userId`)
2. Retrieve top-K chunks (configurable, e.g., 5-10)
3. Include chunk IDs in conversation metadata for citation

**Response Format**:
```typescript
{
  response: string;           // Gemini-generated answer
  citations: Array<{
    chunkId: string;
    source: string;           // e.g., "Video: {title}, Segment 0-500"
    relevance: number;        // RAG relevance score
  }>;
  latency: {
    retrievalMs: number;
    generationMs: number;
    totalMs: number;
  };
}
```

**Rate Limiting**: Per-user quota enforcement (e.g., 100 requests/hour) using Firestore or Redis (future)

**No Docker Volumes**: Conversations stored in Firestore. RAG context retrieved from Vertex AI. Service is stateless.

### 6. Live Transcription Service (NEW - Sprint 6)

**Service**: Cloud Run service with WebSocket support  
**Trigger**: Web client WebSocket connection  
**Purpose**: Real-time streaming transcription from browser mic

**Architecture**:
```
Browser Mic → WebSocket → Live Transcription Service → Speech-to-Text v2 Streaming API
                                                              │
                                                              ▼
                                                    Interim Results (WebSocket → Browser)
                                                              │
                                                              ▼
                                                    Final Transcript → GCS + Firestore
                                                              │
                                                              ▼
                                                    Triggers Notes + RAG Pipeline
```

**Endpoints**:
- `WS /live-transcribe`: WebSocket endpoint
  - Receives audio chunks (Opus encoded)
  - Streams to Speech-to-Text v2 streaming API
  - Emits partial transcripts via WebSocket
  - Commits final transcript on session close

**Storage Schema**:

**Firestore Collection**: `liveSessions/{sessionId}`
```typescript
{
  sessionId: string;
  userId: string;
  workspaceId: string;
  status: "connecting" | "streaming" | "closing" | "failed" | "done";
  transcriptId?: string;      // Created when session completes
  startedAt: Timestamp;
  endedAt?: Timestamp;
  duration?: number;
  audioFormat: string;        // e.g., "opus", "pcm"
  metadata: {
    packetLoss: number;
    avgLatency: number;
  };
}
```

**Post-Session Hook**:
- On session close, final transcript stored in `transcripts/` bucket
- Triggers `transcription-complete-topic` → Notes generation → RAG indexing
- Same pipeline as batch transcription

**State Management**: Partial transcripts cached in Redis (or in-memory for MVP) with periodic flush to Firestore for resilience.

**No Docker Volumes**: Final transcripts stored in GCS. Session state in Firestore. Partial transcript cache in Redis (managed service) or in-memory.

## Storage Bucket Summary

### Existing Buckets (YouTube Clone)

1. **`atmuri-yt-raw-videos`**: Raw video uploads (unchanged)
2. **`atmuri-yt-processed-videos`**: Processed 360p videos (unchanged)

### New Buckets (Cloudscribe)

3. **`transcripts/`**: Speech-to-Text v2 output (Sprint 2)
   - Structure: `transcripts/{videoId}/transcript.json`
   - Access: Service account read/write, user read (via API)

4. **`notes/`**: Gemini-generated study notes (Sprint 3)
   - Structure: `notes/{videoId}/notes-v{version}.md`
   - Access: Service account read/write, user read (via API)

5. **`retrieval-artifacts/`**: RAG indexing artifacts (Sprint 4)
   - Structure: `retrieval-artifacts/{batch|videoId}/chunks.jsonl`
   - Access: Service account read/write only

6. **`live-sessions/`** (optional): Temporary live session audio (Sprint 6)
   - Structure: `live-sessions/{sessionId}/audio.opus`
   - Access: Service account read/write only
   - Lifecycle: Delete after 24 hours (if stored at all)

**Total Storage**: All buckets use GCS. No Docker volumes needed.

## Pub/Sub Topic Evolution

### Existing Topics

1. **`video-uploads-topic`**: Cloud Storage notifications (unchanged)

### New Topics

2. **`transcription-jobs-topic`** (Sprint 2)
   - Publisher: Video Processing Service
   - Subscriber: Transcription Service
   - Message: `{videoId, rawVideoUri, processedVideoUri, userId, language}`

3. **`transcription-complete-topic`** (Sprint 2)
   - Publisher: Transcription Service
   - Subscriber: Notes Service
   - Message: `{transcriptId, videoId, userId, gcsUri}`

4. **`notes-complete-topic`** (Sprint 3)
   - Publisher: Notes Service
   - Subscriber: RAG Indexing Service (optional, can also use Scheduler)
   - Message: `{noteId, transcriptId, videoId, userId, gcsUri}`

5. **`live-session-complete-topic`** (Sprint 6)
   - Publisher: Live Transcription Service
   - Subscriber: Notes Service (same as transcription-complete)
   - Message: `{sessionId, transcriptId, userId, gcsUri}`

### Dead Letter Topics

- **`transcription-jobs-dlq`**: Failed transcription jobs
- **`notes-generation-dlq`**: Failed notes generation
- **`rag-indexing-dlq`**: Failed RAG indexing

## Firestore Schema Evolution

### Existing Collections

- `users/{uid}`: User profiles (unchanged)
- `videos/{videoId}`: Video metadata (enhanced with `transcriptStatus`)

### New Collections

- **`transcripts/{transcriptId}`**: Transcript metadata (Sprint 2)
- **`notes/{noteId}`**: Notes metadata (Sprint 3)
- **`retrievalArtifacts/{artifactId}`**: RAG indexing metadata (Sprint 4)
- **`conversations/{conversationId}`**: Chatbot conversations (Sprint 5)
- **`liveSessions/{sessionId}`**: Live transcription sessions (Sprint 6)

### Composite Indexes

- `transcripts`: `userId` + `status`, `videoId` + `status`
- `notes`: `userId` + `status`, `transcriptId`
- `conversations`: `userId` + `workspaceId` + `createdAt`
- `retrievalArtifacts`: `userId` + `workspaceId` + `indexedAt`

## Integration Points

### Video Processing Service → Transcription

```typescript
// After video processing completes
await publishToPubSub("transcription-jobs-topic", {
  videoId,
  rawVideoUri: `gs://${RAW_BUCKET}/${inputFileName}`,
  processedVideoUri: `gs://${PROCESSED_BUCKET}/${outputFileName}`,
  userId: extractUserId(videoId),
  language: "en-US", // TODO: user selection or auto-detect
});

// Update Firestore
await setVideo(videoId, {
  transcriptStatus: "pending",
});
```

### Transcription → Notes

```typescript
// After transcription completes
await publishToPubSub("transcription-complete-topic", {
  transcriptId,
  videoId,
  userId,
  gcsUri: `gs://transcripts/${videoId}/transcript.json`,
});

// Update Firestore
await updateTranscript(transcriptId, { status: "done" });
await setVideo(videoId, { transcriptStatus: "done" });
```

### Notes → RAG Indexing

```typescript
// After notes generation completes
await publishToPubSub("notes-complete-topic", {
  noteId,
  transcriptId,
  videoId,
  userId,
  gcsUri: `gs://notes/${videoId}/notes-v1.md`,
});

// Or: Cloud Scheduler triggers nightly batch indexing
```

### Chatbot → RAG Retrieval

```typescript
// Chatbot service retrieves context
const chunks = await vertexAIRAG.search({
  query: userQuestion,
  filters: {
    workspaceId,
    userId,
  },
  topK: 10,
});

// Generate response with citations
const response = await gemini.generate({
  prompt: buildPromptWithContext(chunks, userQuestion),
  citationTemplate: true,
});
```

## Deployment Strategy

### Service Deployment Order

1. **Transcription Service** (Sprint 2)
   - Deploy to Cloud Run
   - Create Pub/Sub subscription `transcription-jobs-subscription`
   - Update video processing service to publish to topic

2. **Notes Service** (Sprint 3)
   - Deploy to Cloud Run
   - Create Pub/Sub subscription `notes-jobs-subscription`
   - Deploy prompt templates to GCS or codebase

3. **RAG Indexing Service** (Sprint 4)
   - Deploy to Cloud Run
   - Create Cloud Scheduler job for nightly indexing
   - Provision Vertex AI RAG datastore

4. **Chatbot Service** (Sprint 5)
   - Deploy to Cloud Run
   - Configure Vertex AI RAG access
   - Add rate limiting

5. **Live Transcription Service** (Sprint 6)
   - Deploy to Cloud Run with WebSocket support
   - Configure Speech-to-Text v2 streaming quotas
   - Deploy Redis (if using) or use in-memory cache

**All services use Cloud Run** - no Docker Compose needed. Services communicate via Pub/Sub, HTTP/HTTPS, and GCP APIs.

## State Management Summary

### What We DON'T Use

- ❌ **Docker Compose**: Services deployed independently to Cloud Run
- ❌ **Docker Volumes**: All persistence in GCS + Firestore
- ❌ **Shared Filesystem**: Services communicate via APIs
- ❌ **Container Networking**: Services use public/private HTTP endpoints

### What We DO Use

- ✅ **GCS Buckets**: File storage (videos, transcripts, notes, artifacts)
- ✅ **Firestore**: Structured data (metadata, status, conversations)
- ✅ **Pub/Sub**: Asynchronous messaging between services
- ✅ **Cloud Run**: Serverless container execution
- ✅ **Vertex AI**: Managed AI services (Speech-to-Text, Gemini, RAG)
- ✅ **Redis** (optional): In-memory cache for live transcription partial results

## Cost Considerations

### Storage Costs

- **GCS**: Pay per GB stored + egress (predictable)
- **Firestore**: Pay per document read/write (scales with usage)
- **Vertex AI RAG**: Pay per query + storage (managed)

### Compute Costs

- **Cloud Run**: Pay per request + CPU/memory time (serverless)
- **Firebase Functions**: Pay per invocation (serverless)
- **Vertex AI**: Pay per API call (Speech-to-Text, Gemini)

### No Infrastructure Costs

- No VMs to manage
- No container orchestration overhead
- No volume provisioning

## Migration Path

### Phase 1: Sprint 2 (Transcription)
- Add transcription service
- Extend video processing to trigger transcription
- No changes to existing buckets or services

### Phase 2: Sprint 3 (Notes)
- Add notes service
- Extend transcription to trigger notes
- No breaking changes to existing pipeline

### Phase 3: Sprint 4 (RAG)
- Add RAG indexing service
- Can run independently or triggered by notes completion
- Backfills existing transcripts/notes via scheduler

### Phase 4: Sprint 5 (Chatbot)
- Add chatbot service
- Independent service, queries RAG datastore
- No changes to existing pipeline

### Phase 5: Sprint 6 (Live Transcription)
- Add live transcription service
- Separate flow, feeds same notes/RAG pipeline at completion
- No changes to batch processing

**Key Point**: Each sprint adds services without modifying existing ones. All services are independent and communicate via Pub/Sub and GCP APIs.

## Summary

Cloudscribe extends the YouTube clone architecture by:

1. **Adding new Cloud Run services** for AI processing (transcription, notes, RAG, chatbot, live transcription)
2. **Adding new GCS buckets** for transcripts, notes, and retrieval artifacts
3. **Adding new Pub/Sub topics** for multi-stage pipelines
4. **Extending Firestore schema** with new collections for transcripts, notes, conversations, etc.
5. **Integrating Vertex AI services** for Speech-to-Text, Gemini, and RAG

**No Docker Compose or Docker volumes are introduced** - we continue using:
- GCS for file storage
- Firestore for structured data
- Pub/Sub for messaging
- Cloud Run for compute

This maintains the serverless, managed-service architecture while adding powerful AI capabilities for educational content processing.
