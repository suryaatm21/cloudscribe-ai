# Monitoring & Alerting Setup

This guide explains how to track Cloud Run reliability for the video processing pipeline.

## 1. Log-Based Error Rate Alert

Alert when HTTP responses with status `>=500` exceed 2% of total requests over 15 minutes.

```bash
gcloud logging metrics create video-processor-error-rate \
  --description="5xx error rate for video-processing-service" \
  --log-filter='resource.type="cloud_run_revision"
    resource.labels.service_name="video-processing-service"
    httpRequest.status>=500'

gcloud logging alerts create video-processor-errors \
  --metric="projects/${PROJECT_ID}/metrics/video-processor-error-rate" \
  --aggregation-alignment-period=900s \
  --aggregation-per-series-aligner=ALIGN_RATE \
  --condition-threshold-value=0.02 \
  --notification-channels="${CHANNEL_ID}" \
  --incident-autoclose-duration=3600s
```

## 2. Uptime Check for `/health`

Create a regional uptime check and alerting policy.

```bash
gcloud monitoring uptime checks create http video-processor-health \
  --display-name="Video Processor Health" \
  --http-path="/health" \
  --http-port=443 \
  --resource-type=uptime-url \
  --period=60s \
  --timeout=10s \
  --host="video-processing-service-<HASH>-uc.a.run.app"

gcloud monitoring policies create \
  --display-name="Video Processor Health Down" \
  --condition-display-name="Health endpoint failure" \
  --condition-filter='metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.label.check_id="video-processor-health"' \
  --condition-duration="60s" \
  --notification-channels="${CHANNEL_ID}" \
  --documentation-content="Health check failing. Inspect Cloud Run logs for jobId provided by structured logging." \
  --auto-close="1800s"
```

## 3. Deployment Traceability

- `video-processing-service/deploy.sh` prints the Git SHA tag deployed. Store this value alongside Cloud Run revision labels.
- Cloud Build adds the `commit` label to Cloud Run revisions for quick blame from Monitoring dashboards.

## 4. Dashboards

Use Cloud Monitoring to pin:

- Error rate (custom log metric)
- Request latency (`run.googleapis.com/request_latencies`)
- CPU and memory utilization
- Pub/Sub subscription backlog (`pubsub.googleapis.com/subscription/num_undelivered_messages`)

## 5. Runbook

1. Receive alert (email/Slack) from log-based metric or uptime check.
2. Use `/health` endpoint to confirm dependency state.
3. Query Cloud Logging by `jsonPayload.jobId` to trace specific failures.
4. If backlog increasing, throttle uploads and inspect Pub/Sub subscription.

