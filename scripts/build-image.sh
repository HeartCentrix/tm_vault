#!/usr/bin/env bash
# Build + push the tm_vault frontend image with an auto-derived version badge.
#
# Version = v0.1.<commit-count>, computed from git so it updates on every
# commit/build, baked into the bundle via the VITE_APP_VERSION build-arg
# (consumed by src/version.ts → the header version badge).
#
# Also generates public/version-history.json from `git log` (commit count +
# recent commit summaries). Vite copies public/* into dist, so the SPA fetches
# /version-history.json when the badge popover is opened. Generated on the host
# because the Docker build context excludes .git.
#
# Usage: scripts/build-image.sh [tag]   (tag defaults to "pilot")
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

TAG="${1:-pilot}"
REG="harbor.taylormorrison.com/library"
IMG="${REG}/tmvault-frontend:${TAG}"

COUNT="$(git rev-list --count HEAD)"
VERSION="v0.1.${COUNT}"

# Generate the build-history sidecar (safe JSON via python).
python3 - "public/version-history.json" "${VERSION}" <<'PY'
import subprocess, json, sys
out_path, version = sys.argv[1], sys.argv[2]
fmt = "%h%x1f%s%x1f%ad%x1f%an"
raw = subprocess.check_output(
    ["git", "log", "-30", "--date=short", "--pretty=" + fmt]
).decode("utf-8", "replace").strip()
history = []
for line in raw.split("\n"):
    if not line:
        continue
    sha, subject, date, author = line.split("\x1f")
    history.append({"sha": sha, "subject": subject, "date": date, "author": author})
data = {"version": version, "current": history[0] if history else None, "history": history}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
print(f"wrote {out_path} ({len(history)} commits)")
PY

echo "==> Building ${IMG}  (version: ${VERSION})"
docker build --build-arg VITE_APP_VERSION="${VERSION}" -t "${IMG}" -f Dockerfile .
docker push "${IMG}"
echo "==> Pushed ${IMG}  (version: ${VERSION})"
