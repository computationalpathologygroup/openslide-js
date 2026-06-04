#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching gdk-pixbuf"
cd "$DEPS"
# Release 2.42.12
git clone --depth 1 --branch 2.42.12 https://github.com/GNOME/gdk-pixbuf.git

echo "==> Applying gdk-pixbuf patch"
cd "$DEPS/gdk-pixbuf" && git apply /build/patches/gdk-pixbuf.patch
