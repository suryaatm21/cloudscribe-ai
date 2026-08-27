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
# Usage: scripts/backfill-video-created-at.sh [--apply]
#   (default is a dry run that only reports what would change)

set -euo pipefail

PROJECT="${GCP_PROJECT:-yt-clone-385f4}"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found on PATH" >&2
  exit 1
fi

TOKEN="$(gcloud auth print-access-token)"
BASE="https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents"

echo "Project: ${PROJECT}"
if [[ "${APPLY}" -eq 1 ]]; then
  echo "Mode:    APPLY (documents will be written)"
else
  echo "Mode:    dry run (pass --apply to write)"
fi
echo

# Collect ids that are missing createdAt, newline separated.
MISSING="$(
  curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE}/videos?pageSize=300" \
    | python3 -c '
import sys, json
payload = json.load(sys.stdin)
for doc in payload.get("documents", []):
    fields = doc.get("fields", {})
    if "createdAt" not in fields:
        print(doc["name"].split("/")[-1])
'
)"

if [[ -z "${MISSING}" ]]; then
  echo "Nothing to do: every video already has createdAt."
  exit 0
fi

while IFS= read -r VIDEO_ID; do
  [[ -z "${VIDEO_ID}" ]] && continue

  # Trailing run of >=10 digits is the upload timestamp; anything else we skip
  # rather than guess, so a hand-made id never lands a bogus sort key.
  MILLIS="$(printf '%s' "${VIDEO_ID}" | sed -n 's/.*-\([0-9]\{10,\}\)$/\1/p')"
  if [[ -z "${MILLIS}" ]]; then
    echo "SKIP  ${VIDEO_ID} (no embedded timestamp; set createdAt by hand)"
    continue
  fi

  RFC3339="$(python3 -c "
import datetime, sys
millis = int(sys.argv[1])
moment = datetime.datetime.fromtimestamp(millis / 1000, datetime.timezone.utc)
print(moment.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z')
" "${MILLIS}")"

  if [[ "${APPLY}" -eq 0 ]]; then
    echo "WOULD SET ${VIDEO_ID} -> ${RFC3339}"
    continue
  fi

  # updateMask limits the write to createdAt so no other field is touched.
  HTTP_CODE="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X PATCH \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      "${BASE}/videos/${VIDEO_ID}?updateMask.fieldPaths=createdAt" \
      -d "{\"fields\":{\"createdAt\":{\"timestampValue\":\"${RFC3339}\"}}}"
  )"
  echo "SET   ${VIDEO_ID} -> ${RFC3339} (HTTP ${HTTP_CODE})"
done <<< "${MISSING}"
