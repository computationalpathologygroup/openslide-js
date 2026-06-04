#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching freetype"
cd "$DEPS"
git clone --depth 1 --branch VER-2-13-0 https://gitlab.freedesktop.org/freetype/freetype.git
