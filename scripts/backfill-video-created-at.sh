#!/usr/bin/env bash
#
# One-time migration: give every existing video document a `createdAt`.
#
# Why this is required, not cosmetic: the home page orders by `createdAt`, and
# Firestore omits documents that are missing the ordered field entirely. A
# pre-existing video without `createdAt` would therefore disappear from the
# owner's list the moment the paginated query ships. Run this BEFORE deploying
# the paginated getVideos.
#
# The value comes from the video id itself. Uploads are named
# `{uid}-{epochMillis}`, so the id records the true upload time and this
# migration is deterministic and safely re-runnable.
#
# Every HTTP response is status-checked and the whole collection is walked via
# nextPageToken. A migration whose job is to stop documents from vanishing must
# not be able to no-op silently: a failed list would otherwise look identical to
# "nothing to do".
#
# Usage: scripts/backfill-video-created-at.sh [--apply]
#   (default is a dry run that only reports what would change)

set -euo pipefail

PROJECT="${GCP_PROJECT:-yt-clone-385f4}"
MODE="dry-run"
if [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found on PATH" >&2
  exit 1
fi

TOKEN="$(gcloud auth print-access-token)"

GCP_PROJECT="${PROJECT}" \
BACKFILL_MODE="${MODE}" \
BACKFILL_TOKEN="${TOKEN}" \
python3 - <<'PYTHON'
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROJECT = os.environ["GCP_PROJECT"]
TOKEN = os.environ["BACKFILL_TOKEN"]
APPLY = os.environ["BACKFILL_MODE"] == "apply"

BASE = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
    "/databases/(default)/documents"
)
# Anything earlier is before the project existed; anything later is a bad id.
EARLIEST_MILLIS = 1420070400000  # 2015-01-01T00:00:00Z
TRAILING_TIMESTAMP = re.compile(r"-(\d{10,})$")

print(f"Project: {PROJECT}")
print(f"Mode:    {'APPLY (documents will be written)' if APPLY else 'dry run (pass --apply to write)'}")
print()


def request(url, method="GET", body=None):
    """Performs a Firestore REST call, raising on any non-2xx response."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as response:
            payload = response.read().decode()
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:400]
        raise SystemExit(
            f"FATAL {method} {url.split('/documents')[-1]} -> HTTP {err.code}\n"
            f"  {detail}\n"
            "Aborting: a partial backfill would leave videos invisible on the "
            "home page."
        ) from err


def iter_video_documents():
    """Walks the whole videos collection, following nextPageToken."""
    page_token = None
    while True:
        query = {"pageSize": "300"}
        if page_token:
            query["pageToken"] = page_token
        payload = request(f"{BASE}/videos?{urllib.parse.urlencode(query)}")
        for doc in payload.get("documents", []):
            yield doc
        page_token = payload.get("nextPageToken")
        if not page_token:
            return


missing = []
total = 0
for doc in iter_video_documents():
    total += 1
    if "createdAt" not in doc.get("fields", {}):
        missing.append(doc["name"].split("/")[-1])

print(f"Scanned {total} video document(s); {len(missing)} missing createdAt.")
print()

if not missing:
    print("Nothing to do: every video already has createdAt.")
    sys.exit(0)

skipped = 0
written = 0
for video_id in missing:
    match = TRAILING_TIMESTAMP.search(video_id)
    if not match:
        print(f"SKIP  {video_id} (no embedded timestamp; set createdAt by hand)")
        skipped += 1
        continue

    millis = int(match.group(1))
    if millis < EARLIEST_MILLIS:
        print(f"SKIP  {video_id} (timestamp {millis} predates the project)")
        skipped += 1
        continue

    moment = datetime.fromtimestamp(millis / 1000, timezone.utc)
    rfc3339 = moment.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    if not APPLY:
        print(f"WOULD SET {video_id} -> {rfc3339}")
        continue

    # updateMask limits the write to createdAt so no other field is touched.
    request(
        f"{BASE}/videos/{urllib.parse.quote(video_id)}"
        "?updateMask.fieldPaths=createdAt",
        method="PATCH",
        body={"fields": {"createdAt": {"timestampValue": rfc3339}}},
    )
    print(f"SET   {video_id} -> {rfc3339}")
    written += 1

print()
if APPLY:
    print(f"Wrote {written} document(s); skipped {skipped}.")
    if skipped:
        print(
            "WARNING: skipped documents still have no createdAt and remain "
            "hidden from the home page."
        )
        sys.exit(1)
else:
    print(f"Dry run complete; {len(missing) - skipped} document(s) would change.")
PYTHON
