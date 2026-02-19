#!/usr/bin/env bash
set -euo pipefail

# Usage:
# STITCH_SCREEN1_URL=... STITCH_SCREEN2_URL=... STITCH_SCREEN3_URL=... ./scripts/stitch-fetch.sh

mkdir -p assets/stitch

if [[ -n "${STITCH_SCREEN1_URL:-}" ]]; then
  curl -L "$STITCH_SCREEN1_URL" -o assets/stitch/in-page-word-definition-popover.png
fi
if [[ -n "${STITCH_SCREEN2_URL:-}" ]]; then
  curl -L "$STITCH_SCREEN2_URL" -o assets/stitch/extension-toolbar-popup-menu.png
fi
if [[ -n "${STITCH_SCREEN3_URL:-}" ]]; then
  curl -L "$STITCH_SCREEN3_URL" -o assets/stitch/word-collection-management-dashboard.png
fi

echo "Downloaded Stitch assets into assets/stitch"
