# Monitoring & Alerting Setup

This guide explains how to track Cloud Run reliability for the video processing pipeline.

> **Ingress contradiction (read this first).**
> `video-processing-service` is deployed with `--ingress=internal` (see `video-processing-service/cloudbuild.yaml` and the live service annotation `run.googleapis.com/ingress: internal`). The `.run.app` URL is **not** on the public internet. A browser, `curl` from a laptop, or a Cloud Monitoring **uptime check** against that host gets a Google-frontend **404**. That is expected, not an outage.
>
> Section 2 below still shows the old “create an HTTP uptime check on `/health`” commands. Those commands will create a check that is red forever. Do **not** use them against this service. Use the log-based alert in section 1, Cloud Run request/latency metrics, Pub/Sub backlog, and Cloud Run’s own startup probe (TCP 8080). `/health` remains useful **inside** the project (another Cloud Run job, a VPC client, `gcloud run services proxy`) for dependency debugging — not as a public URL.

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

## 2. Uptime Check for `/health` — do not create this as written

The commands in this section assume a publicly reachable `/health`. That assumption is false for the current service. An external uptime check will fail closed with a frontend 404 even when the revision is healthy.

If you need a synthetic probe later, it has to run **inside** the project (for example a Cloud Scheduler job with OIDC calling `/health`, or Cloud Run uptime checks targeted at a private URL — not `--resource-type=uptime-url` against the `.run.app` host). Until that exists, skip this section.

Historical commands (will not work with `--ingress=internal`):

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

1. Receive alert (email/Slack) from the log-based 5xx metric, Cloud Run revision metrics, or Pub/Sub backlog. Ignore a red *external* uptime check on this service — that check cannot succeed with internal ingress.
2. Confirm the revision is up in Cloud Run (startup probe is TCP 8080, not `/health`). To inspect `/health` itself, use an in-project client (`gcloud run services proxy video-processing-service --region=us-central1`) rather than curling the `.run.app` URL from a laptop.
3. Query Cloud Logging by `jsonPayload.jobId` to trace specific failures.
4. If backlog increasing, throttle uploads and inspect Pub/Sub subscription.

