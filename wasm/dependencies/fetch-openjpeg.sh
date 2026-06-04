#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching openjpeg"
cd "$DEPS"
git clone --depth 1 --branch v2.5.3 https://github.com/uclouvain/openjpeg.git
