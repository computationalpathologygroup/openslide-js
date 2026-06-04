#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching zlib"
cd "$DEPS"
# Release 1.3.2
git clone --depth 1 --branch v1.3.2 https://github.com/madler/zlib.git
