#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching libjpeg-turbo"
cd "$DEPS"
# Release 3.1.4.1
git clone --depth 1 --branch 3.1.4.1 https://github.com/libjpeg-turbo/libjpeg-turbo.git
