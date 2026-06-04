#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching libexpat"
cd "$DEPS"
git clone --depth 1 --branch R_2_5_0 https://github.com/libexpat/libexpat.git
