#!/usr/bin/env bash
set -euo pipefail

BUCKET=${1:-"atmuri-yt-notes-prompts"}
SOURCE_DIR="notes-service/prompts"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Prompt directory $SOURCE_DIR not found"
  exit 1
fi

echo "Syncing prompts to gs://$BUCKET"
for file in "$SOURCE_DIR"/*.json; do
  if [[ -f "$file" ]]; then
    gsutil cp "$file" "gs://$BUCKET/"
    echo "Uploaded $(basename "$file")"
  fi
done

echo "Prompt upload complete"
