#!/bin/bash
# Cut a release: bumps manifest.json, tags, and pushes (triggers the
# .github/workflows/publish.yml workflow which uploads to the Chrome Web Store).
# Usage:  bash release.sh v1.0.1
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: bash release.sh v1.0.1" >&2
  exit 1
fi
if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must look like v1.0.1" >&2
  exit 1
fi

node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('manifest.json','utf8'));m.version='${VERSION#v}';fs.writeFileSync('manifest.json',JSON.stringify(m,null,2)+'\n')"

git add manifest.json
git commit -m "Release ${VERSION}"
git tag "$VERSION"
git push origin main
git push origin "$VERSION"

echo "Pushed ${VERSION} — the publish workflow will now run."
