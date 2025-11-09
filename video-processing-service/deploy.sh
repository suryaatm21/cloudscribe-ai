#!/bin/bash

# Load environment variables from .env file
if [ -f ../.env ]; then
  export $(cat ../.env | grep -v '^#' | xargs)
else
  echo "Error: .env file not found in parent directory"
  exit 1
fi

# Check if PROJECT_ID is set
if [ -z "$PROJECT_ID" ]; then
  echo "Error: PROJECT_ID not set in .env file"
  exit 1
fi

echo "🚀 Starting deployment process..."
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Image: $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME"

# Build the Docker image for linux/amd64 platform (required for Cloud Run)
echo "📦 Building Docker image for linux/amd64..."
docker build --platform linux/amd64 -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME .

if [ $? -ne 0 ]; then
  echo "❌ Docker build failed"
  exit 1
fi

echo "✅ Docker build successful"

# Push the image to Artifact Registry
echo "⬆️  Pushing image to Artifact Registry..."
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME

if [ $? -ne 0 ]; then
  echo "❌ Docker push failed"
  exit 1
fi

echo "✅ Image pushed successfully"

# Deploy to Cloud Run
echo "☁️  Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY_NAME/$SERVICE_NAME \
  --region=$REGION \
  --platform managed \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=1 \
  --ingress=internal \
  --set-env-vars PROCESSING_MAX_ATTEMPTS=$PROCESSING_MAX_ATTEMPTS \
  --project=$PROJECT_ID

if [ $? -ne 0 ]; then
  echo "❌ Cloud Run deployment failed"
  exit 1
fi

echo "✅ Deployment successful!"
echo "🎉 Video processing service is now live!"
