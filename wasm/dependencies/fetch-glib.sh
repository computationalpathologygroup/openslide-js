#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching glib"
cd "$DEPS"
# Release 2.88.1
wget -q https://download.gnome.org/sources/glib/2.88/glib-2.88.1.tar.xz
tar -xf glib-2.88.1.tar.xz && rm glib-2.88.1.tar.xz
mv glib-2.88.1 glib

echo "==> Applying glib patch"
cd "$DEPS/glib" && patch -p1 < /build/patches/glib.patch
