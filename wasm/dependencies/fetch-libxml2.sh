#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching libxml2"
cd "$DEPS"
# Release v2.15.3
git clone https://gitlab.gnome.org/GNOME/libxml2.git
cd libxml2 && git checkout c94eb0210183b9d7cb43f8e7fddc6be55843ef49 && cd ..
