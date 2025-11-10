#!/bin/bash

# Exit on error
set -e

# Configuration
PROJECT_ID="yt-clone-385f4"
REGION="us-central1"
REPOSITORY_NAME="yt-web-client-repo"
SERVICE_NAME="yt-web-client"
IMAGE_NAME="web-client"

echo "🚀 Building Docker image..."
docker build --platform linux/amd64 \
  -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$IMAGE_NAME \
  -f Dockerfile .

echo "✅ Build complete!"
echo ""
echo "📤 Pushing image to Artifact Registry..."
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$IMAGE_NAME

echo "✅ Push complete!"
echo ""
echo "🚢 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$IMAGE_NAME \
  --region=$REGION \
  --platform=managed \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --allow-unauthenticated \
  --project=$PROJECT_ID

echo "✅ Deployment complete!"
echo ""
echo "🎉 Web client is now live!"
