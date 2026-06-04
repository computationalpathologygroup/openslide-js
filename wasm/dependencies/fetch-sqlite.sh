#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching sqlite"
cd "$DEPS"
git clone https://github.com/frida/sqlite.git
cd sqlite && git checkout 9337327 && cd ..
