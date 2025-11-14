# Web Client Deployment Guide

### Client-Side Fetching & Caching

**No caching issues!** Client Components (`useEffect`) fetch fresh data on every page load.

- `export const revalidate = 30` is **only for Server Components**
- Your current setup avoids stale data automatically

## Docker Deployment

### Prerequisites

```bash
# Create Artifact Registry repository (one-time)
gcloud artifacts repositories create yt-web-client-repo \
  --repository-format=docker \
  --location=us-central1 \
  --project=yt-clone-385f4
```

### Deployment Script

Run `./deploy.sh` from the `yt-web-client` directory:

```bash
cd yt-web-client
chmod +x deploy.sh
./deploy.sh
```

### Manual Commands

```bash
# 1. Build Docker image
docker build --platform linux/amd64 \
  -t us-central1-docker.pkg.dev/yt-clone-385f4/yt-web-client-repo/web-client .

# 2. Push to Artifact Registry
docker push us-central1-docker.pkg.dev/yt-clone-385f4/yt-web-client-repo/web-client

# 3. Deploy to Cloud Run
gcloud run deploy yt-web-client \
  --image=us-central1-docker.pkg.dev/yt-clone-385f4/yt-web-client-repo/web-client \
  --region=us-central1 \
  --platform=managed \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --allow-unauthenticated \
  --project=yt-clone-385f4
```

## Fixes Applied

### 1. Watch Page Prerendering Error

**Problem:** `useSearchParams()` caused prerendering to fail.

**Solution:** Wrapped in `<Suspense>`:

```tsx
export default function Watch() {
  return (
    <Suspense fallback={<div>Loading video...</div>}>
      <WatchContent />
    </Suspense>
  );
}
```

### 2. Dockerfile Improvements

- Added `next.config.ts` to production stage
- Enhanced `.dockerignore` to exclude `.next`, `.git`, logs

### 3. Case Sensitivity

- Renamed `dockerfile` → `Dockerfile` (Docker expects capital D)

## Verification

After deployment:

1. Get the service URL from Cloud Run console
2. Visit the URL - should see the home page
3. Sign in and upload a video
4. Video should appear in the grid
5. Click to watch the video

## Troubleshooting

- **Build fails:** Check `npm run build` works locally first
- **Image too large:** Build cache may be stale, try `docker system prune`
- **Deployment fails:** Verify project ID and region are correct
