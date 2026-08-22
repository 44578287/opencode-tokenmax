#!/bin/sh
# Restore remaining source files next to this script.
set -eu
cd "$(dirname "$0")"
if ls vendor/source.tgz.b64.aa >/dev/null 2>&1; then
  cat vendor/source.tgz.b64.* | tr -d '\n' | base64 -d | tar xz
elif [ -f vendor/source.tgz.b64 ]; then
  base64 -d vendor/source.tgz.b64 | tar xz
else
  echo "missing vendor/source.tgz.b64* — remaining source is still being uploaded" >&2
  exit 1
fi
echo "unpacked into $(pwd)"
