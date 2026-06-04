#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching libffi"
cd "$DEPS"
wget -q https://github.com/libffi/libffi/releases/download/v3.4.7/libffi-3.4.7.tar.gz
tar -xzf libffi-3.4.7.tar.gz && rm libffi-3.4.7.tar.gz
mv libffi-3.4.7 libffi
