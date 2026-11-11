# Pub/Sub Architecture Explanation

## Complete Flow

```
User uploads video via web client
    ↓
Video uploaded to Cloud Storage bucket (atmuri-yt-raw-videos)
    ↓
Cloud Storage sends notification to Pub/Sub topic
    ↓
Pub/Sub subscription receives the message
    ↓
Subscription PUSHES message to Cloud Run endpoint
    ↓
Cloud Run processes video (convert to 360p)
    ↓
Processed video saved to (atmuri-yt-processed-videos)
Firestore updated with status: "processed"
    ↓
✅ User sees success alert
```

---

## 📡 How Pub/Sub Works (Publisher-Subscriber Pattern)

Think of it like a **newspaper delivery system**:

### 1. **Publisher** (Cloud Storage)

- When a video is uploaded, Cloud Storage **publishes** a message to Pub/Sub
- The message contains: `{"name": "user-123-1731234567.mp4", "bucket": "atmuri-yt-raw-videos"}`

### 2. **Topic** (Message Queue)

- The Pub/Sub **topic** (`video-uploads-topic`) is like a **mailbox**
- All notifications go into this mailbox
- Multiple subscribers can listen to the same topic

### 3. **Subscription** (Listener)

- A **subscription** is like **subscribing to a newspaper**
- You tell Pub/Sub: "I want to hear about videos being uploaded"
- Our subscription: `video-processing-subscription` listens to `video-uploads-topic`

### 4. **Push Endpoint** (Delivery)

- Our subscription is configured to **PUSH** messages to Cloud Run
- Instead of Cloud Run asking "any new videos?", Pub/Sub **sends** it the message
- Push endpoint URL: `https://video-processing-service-rfrkdig5jq-uc.a.run.app/process-video`

---

## 🔧 The Actual Implementation

### Step 1: Cloud Storage Detects Upload

```bash
# Cloud Storage has this notification configured:
gcloud storage buckets notifications list gs://atmuri-yt-raw-videos

# Output shows:
topic: //pubsub.googleapis.com/projects/yt-clone-385f4/topics/video-uploads-topic
event_types: [OBJECT_FINALIZE]  # When a file is completely uploaded
```

**What this means:**

- Every time a file is finalized (fully uploaded), Cloud Storage publishes to `video-uploads-topic`
- The notification contains the file metadata (name, size, etc.)

### Step 2: Pub/Sub Topic Receives Message

```
video-uploads-topic receives:
{
  "name": "surya-123-1731234567.mp4",
  "bucket": "atmuri-yt-raw-videos",
  "contentType": "video/mp4",
  "timeCreated": "2025-11-10T15:30:00Z"
}
```

### Step 3: Subscription Pushes to Cloud Run

```
video-processing-subscription (configured with push delivery):
  - Sees new message in topic
  - Sends HTTP POST to: https://video-processing-service-rfrkdig5jq-uc.a.run.app/process-video
  - Body contains the Cloud Storage notification
```

### Step 4: Cloud Run Processes

```typescript
// In video-processing-service/src/index.ts

app.post("/process-video", async (req, res) => {
  // Pub/Sub sends the message here
  const data = decodePubSubMessage(req); // Extract file name

  // Atomically claim the video: only the first delivery gets true
  if (await claimVideoForTranscode(videoId, userId)) {
    // Convert video to 360p
    await processVideo(inputFileName, outputFileName, videoId);

    // Mark as processed in Firestore
    await setVideo(videoId, { status: "processed" });
  }

  // Return 200 OK so Pub/Sub knows message was delivered
  res.status(200).json({ message: "Processing completed" });
});
```

---

## 🐛 What Was Wrong Before

### Before Fix: Missing Subscription

```
Topic exists: video-uploads-topic ✓
Cloud Storage publishes to it ✓
But NOBODY subscribed to receive messages ✗

Messages sit in the topic undelivered
Cloud Run never receives them
Videos never get processed
```

### The Missing Command (We Fixed This)

```bash
# This was MISSING and we created it:
gcloud pubsub subscriptions create video-processing-subscription \
  --topic=video-uploads-topic \
  --push-endpoint=https://video-processing-service-rfrkdig5jq-uc.a.run.app/process-video \
  --push-auth-service-account=yt-clone-385f4@appspot.gserviceaccount.com \
  --project=yt-clone-385f4
```

Now Cloud Run receives the messages!

---

## 📊 Visual Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Application Flow                   │
└─────────────────────────────────────────────────────────────┘

WEB CLIENT                    GOOGLE CLOUD
  (Next.js)
    │
    │ 1. User selects video
    │ 2. Call generateUploadUrl()
    │ 3. Get signed URL from Firebase Function
    │ 4. Upload video file
    │
    └──────────────────→ Cloud Storage (atmuri-yt-raw-videos)
                               │
                               │ 5. File finalized
                               │ 6. Notify Pub/Sub
                               │
                               └──────────→ Pub/Sub Topic
                                          (video-uploads-topic)
                                               │
                                               │ 7. Message queued
                                               │ 8. Send to subscriber
                                               │
                                               └──→ Pub/Sub Subscription
                                                   (video-processing-subscription)
                                                        │
                                                        │ 9. HTTP POST /process-video
                                                        │
                                                        └──→ Cloud Run Service
                                                            (video-processing-service)
                                                                │
                                                    ┌───────────┼───────────┐
                                                    │           │           │
                                                    ▼           ▼           ▼
                                           Extract   Download   Process    Upload
                                           metadata  raw video  to 360p    processed
                                           from msg  from GCS            to GCS
                                                    │           │           │
                                                    └───────────┼───────────┘
                                                                │
                                                                ▼
                                          Update Firestore (status: processed)
                                          Return 200 OK to Pub/Sub
```

---

## 🔐 Why We Needed IAM Permissions

```bash
# We added this permission:
gcloud run services add-iam-policy-binding video-processing-service \
  --member="serviceAccount:yt-clone-385f4@appspot.gserviceaccount.com" \
  --role="roles/run.invoker"
```

**Why?**

- Pub/Sub needs permission to **invoke** (call) your Cloud Run service
- Without this, the HTTP POST from Pub/Sub would be rejected (403 Forbidden)
- Service account `yt-clone-385f4@appspot.gserviceaccount.com` is the identity making the request

---

## 📋 How to Verify It's Working

### Check 1: Topic Exists and Has Notifications

```bash
gcloud storage buckets notifications list gs://atmuri-yt-raw-videos --project=yt-clone-385f4
# Output shows topic: video-uploads-topic
```

### Check 2: Subscription Exists

```bash
gcloud pubsub subscriptions list --project=yt-clone-385f4
# Output includes: video-processing-subscription
```

### Check 3: View Subscription Details

```bash
gcloud pubsub subscriptions describe video-processing-subscription \
  --project=yt-clone-385f4
# Shows:
#   pushConfig:
#     pushEndpoint: https://video-processing-service-rfrkdig5jq-uc.a.run.app/process-video
#     serviceAccountEmail: yt-clone-385f4@appspot.gserviceaccount.com
```

### Check 4: Monitor Pub/Sub Metrics (GCP Console)

```
https://console.cloud.google.com/cloudpubsub/subscription/detail/video-processing-subscription?project=yt-clone-385f4&tab=metrics
```

- **Publish operations**: Count of messages sent to topic
- **Delivered messages**: Count successfully pushed to Cloud Run
- **Acked messages**: Count acknowledged by Cloud Run (200 OK)

---

## 🎓 Alternative: Pull vs Push

### Push (What We Use ✅)

- Pub/Sub **actively sends** message to Cloud Run
- Cloud Run doesn't need to ask "any new videos?"
- Better for event-driven architectures
- Faster delivery
- What we configured:
  ```
  Pub/Sub → HTTP POST → Cloud Run
  ```

### Pull (Alternative - Not Used)

- Cloud Run **periodically asks** Pub/Sub "any new messages?"
- More polling/latency
- Less efficient for high-volume
- Would look like:
  ```
  Cloud Run queries every 5 seconds → "Any new videos?" → Pub/Sub responds
  ```

---

## 💡 Key Takeaway

**Before:** Topic existed but nobody was listening → Videos uploaded but never processed

**After:** Subscription created + IAM permissions → Messages flow automatically

Think of it like a restaurant:

- **Topic** = Order bell ringing when customer orders
- **Subscription** = Chef listening to the bell and cooking
- **Push** = Bell automatically alerts chef (automatic)
- **Pull** = Chef checks bell every minute (manual, slower)

Without the subscription, the bell rings but nobody hears it! 🔔
