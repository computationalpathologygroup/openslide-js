#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching zstd"
cd "$DEPS"
# Release v1.5.7
git clone --depth 1 --branch v1.5.7 https://github.com/facebook/zstd.git
