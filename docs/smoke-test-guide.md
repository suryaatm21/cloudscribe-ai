# Smoke Test: Token Generation & Execution

The smoke test validates the entire pipeline: upload → Pub/Sub → processing → Firestore. This guide walks through generating the required Firebase ID token and running the test.

## Prerequisites

- `gcloud` CLI installed and authenticated
- `firebase` CLI installed
- Access to the GCP project (`yt-clone-385f4`)
- A test video file (or `ffmpeg` to generate one)

## Step 1: Generate a Firebase ID Token

The smoke test requires a valid Firebase ID token to authenticate with the `getUploadUrl` Firebase Function.

### Option A: Using Firebase Emulator (Easiest for Local Dev)

```bash
# Start Firebase emulators (includes Auth emulator)
firebase emulators:start --only auth

# In another terminal, create a test user:
firebase auth:import users.json --hash-algo=scrypt

# Generate a test token via the emulator API
# The emulator exposes an API on http://localhost:9099
curl -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyDyWJmwtjPl_IxfKI_OvpR3DV8nFU6IKQ" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!",
    "returnSecureToken": true
  }' | jq '.idToken'
```

### Option B: Using Production Firebase (For Staged/Prod Testing)

```bash
# Create a test user in Firebase Console at:
# https://console.firebase.google.com/project/yt-clone-385f4/authentication

# Then use Firebase CLI to get an ID token
firebase auth:export users.json --project=yt-clone-385f4

# Or use the Firebase Admin SDK in a Node.js script:
node -e "
const admin = require('firebase-admin');
const serviceAccount = require('./path/to/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
admin.auth().createUser({
  email: 'smoke-test@cloudscribe-ai.local',
  password: 'SmokeTest123!',
  displayName: 'Smoke Test User'
}).then(user => {
  return admin.auth().createCustomToken(user.uid);
}).then(token => {
  console.log('Custom token:', token);
}).catch(err => console.error(err));
"
```

### Option C: Using gcloud IAM (For Service Account Token)

If you want to test as a service account (not a user):

```bash
# Get the default service account
gcloud iam service-accounts list

# Create a short-lived access token
gcloud auth application-default print-access-token

# Use the access token as Bearer token
# Note: Service accounts won't pass user auth checks in getUploadUrl function
```

## Step 2: Store the Token for Smoke Test

Once you have an ID token, save it as an environment variable:

```bash
export SMOKE_ID_TOKEN="eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1Njc4OTAiLCJ..."

# Or add to .env.local
echo "SMOKE_ID_TOKEN=$SMOKE_ID_TOKEN" >> .env.local
```

## Step 3: Configure Smoke Test Environment

```bash
# Navigate to video-processing-service
cd video-processing-service

# Create .env.local for smoke test
cat > .env.local << 'EOF'
# Smoke Test Configuration
SMOKE_PROJECT_ID=yt-clone-385f4
SMOKE_REGION=us-central1
SMOKE_FUNCTIONS_URL=https://us-central1-yt-clone-385f4.cloudfunctions.net
SMOKE_ID_TOKEN=<your-token-from-step-2>

# GCS Buckets
RAW_VIDEO_BUCKET_NAME=atmuri-yt-raw-videos
PROCESSED_VIDEO_BUCKET_NAME=atmuri-yt-processed-videos

# ADC Credentials (for gcloud CLI)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/default/adc/credentials.json
EOF

# Set ADC credentials
gcloud auth application-default login
```

## Step 4: Run the Smoke Test

```bash
# From video-processing-service directory
chmod +x scripts/smoke-test.sh
./scripts/smoke-test.sh

# Or with environment variable override
SMOKE_ID_TOKEN="$YOUR_TOKEN" ./scripts/smoke-test.sh
```

### Expected Output

```
✓ Retrieved signed upload URL
✓ Uploaded test video to GCS
✓ Detected Pub/Sub message delivery
✓ Cloud Run processing started (jobId: job-abc123-1700000000)
✓ Processed video found in gs://atmuri-yt-processed-videos/processed-test-video.mp4
✓ Firestore document created with status: processed
✅ Smoke test passed!
```

## Troubleshooting

### Error: "Invalid ID token"

**Cause:** Token has expired or is malformed.  
**Fix:** Generate a fresh token (tokens expire after 1 hour).

### Error: "getUploadUrl not found"

**Cause:** Firebase Functions not deployed or wrong region.  
**Fix:** Deploy functions: `cd api-service/functions && firebase deploy --only functions`

### Error: "Processed file not found"

**Cause:** Cloud Run processing failed or took >30s (smoke test timeout).  
**Fix:** Check Cloud Run logs:
```bash
gcloud run logs read video-processing-service --region=us-central1 --limit=50
```

### Error: "Permission denied on GCS bucket"

**Cause:** Service account lacks permissions.  
**Fix:** Verify IAM bindings:
```bash
gcloud projects get-iam-policy yt-clone-385f4 \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/storage.admin"
```

## Automation: Run Smoke Test in Cloud Build

The smoke test runs automatically after every deployment via Cloud Build. To manually trigger:

```bash
gcloud builds submit --config=cloudbuild.yaml
```

The `cloudbuild.yaml` includes:
```yaml
# After deployment
- name: "gcr.io/cloud-builders/gke-deploy"
  entrypoint: bash
  args:
    - -c
    - |
      ./scripts/smoke-test.sh
```

## CI/CD Integration

In your GitHub workflow or Cloud Build pipeline:

```yaml
- name: Run smoke test
  run: |
    export SMOKE_ID_TOKEN=$(firebase auth:create-custom-token test-user)
    ./scripts/smoke-test.sh
```

---

## Questions?

If smoke test fails:
1. Check Cloud Run logs: `gcloud run logs read video-processing-service`
2. Check Pub/Sub subscriptions: `gcloud pubsub subscriptions list`
3. Check Firestore: https://console.firebase.google.com/project/yt-clone-385f4/firestore
4. Ask on Slack or create a GitHub issue
