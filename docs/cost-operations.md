# Cost operations (out-of-pocket GCP)

Promo credits on project `yt-clone-385f4` expired (pay-as-you-go). Artifact Registry was ~$0.41/month (19 Aug), then ~$0.59/month (~6.4 GiB) after deleting the legacy `gcr.io` repo (1,162 MiB), applying cleanup policies, and pushing six new images. It should settle near ~$0.16/month after the 7-day untagged / 14-day tagged windows. Cloud Build on this branch uses `E2_STANDARD_2`. Cloud Run min-instances is 0; GCS is under the 5 GB Always Free tier.

This file lists **human-run** bucket and registry commands. Do **not** apply them from CI. Deleting images is irreversible.

## GCS CORS (`utils/gcs-cors.json`)

CORS restricts which browser origins may send HTTP requests (here, resumable uploads) to the bucket. The second array entry used to be a note with `comment`/`todo` keys, which is not a valid CORS rule and would make `gsutil cors set` fail.

Tighten `origin` from `["*"]` to the production domain before going beyond a personal project.

```bash
# Not run from this repo's CI. Example:
# gcloud storage buckets update gs://BUCKET --cors-file=utils/gcs-cors.json
```

## Raw-video lifecycle (not applied)

`deleteRawVideo` only deletes the Cloud Run local temp file. Objects in `atmuri-yt-raw-videos` currently live forever. The policy in `utils/gcs-lifecycle-raw-videos.json` deletes objects 30 days after upload.

**Do not run until reviewed.** This permanently deletes raw uploads older than 30 days.

```bash
gcloud storage buckets update gs://atmuri-yt-raw-videos \
  --lifecycle-file=utils/gcs-lifecycle-raw-videos.json
```

Inspect without changing:

```bash
gcloud storage buckets describe gs://atmuri-yt-raw-videos --format='yaml(lifecycle_config)'
```

## Artifact Registry cleanup policy (applied 20 August 2026; runbook retained)

Policy file: `utils/artifact-registry-cleanup-policy.json`

- Keep anything tagged `latest*`
- Keep the 2 most recent versions per package
- Delete untagged manifests older than 7 days
- Delete tagged versions older than 14 days

Keep policies win when a version matches both keep and delete. `latest` usually aliases the newest SHA, so unique retained digests are typically 2 per live package (current `latest` + one rollback). Bump `keepCount` to `3` if you want `latest` plus two additional SHA tags.

### Dry run (safe — no deletions)

Dry-run still writes the policy, but Artifact Registry only logs what it *would* delete (`validateOnly=true`). Cleanup is a background job; wait about a day, then check Data Access audit logs.

```bash
gcloud artifacts repositories set-cleanup-policies video-processing-service \
  --project=yt-clone-385f4 \
  --location=us-central1 \
  --policy=utils/artifact-registry-cleanup-policy.json \
  --dry-run

gcloud artifacts repositories set-cleanup-policies yt-web-client-repo \
  --project=yt-clone-385f4 \
  --location=us-central1 \
  --policy=utils/artifact-registry-cleanup-policy.json \
  --dry-run
```

### Enforce deletions (destructive)

`--no-dry-run` turns the same policy into real deletes. Irreversible. Changes take effect in about a day.

```bash
gcloud artifacts repositories set-cleanup-policies video-processing-service \
  --project=yt-clone-385f4 \
  --location=us-central1 \
  --policy=utils/artifact-registry-cleanup-policy.json \
  --no-dry-run

gcloud artifacts repositories set-cleanup-policies yt-web-client-repo \
  --project=yt-clone-385f4 \
  --location=us-central1 \
  --policy=utils/artifact-registry-cleanup-policy.json \
  --no-dry-run
```

## Delete dead packages (destructive, not run)

These packages are leftover from older image names. They are not what Cloud Build pushes today (`video-processing-service` and `yt-web-client`). Deleting a package removes **all** tags and digests under that name.

```bash
gcloud artifacts docker images delete \
  us-central1-docker.pkg.dev/yt-clone-385f4/video-processing-service/processor \
  --delete-tags

gcloud artifacts docker images delete \
  us-central1-docker.pkg.dev/yt-clone-385f4/yt-web-client-repo/web-client \
  --delete-tags
```

List first if you want to confirm names:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/yt-clone-385f4/video-processing-service \
  --include-tags

gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/yt-clone-385f4/yt-web-client-repo \
  --include-tags
```
