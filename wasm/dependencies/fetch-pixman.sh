#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching pixman"
cd "$DEPS"
mkdir -p pixman && cd pixman
wget -q https://cairographics.org/releases/pixman-0.46.4.tar.gz
tar -xzf pixman-0.46.4.tar.gz
rm pixman-0.46.4.tar.gz
