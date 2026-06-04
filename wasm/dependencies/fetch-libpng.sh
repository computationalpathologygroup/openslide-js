#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching libpng"
cd "$DEPS"
# Release 1.6.58
git clone --depth 1 --branch v1.6.58 https://github.com/pnggroup/libpng.git
