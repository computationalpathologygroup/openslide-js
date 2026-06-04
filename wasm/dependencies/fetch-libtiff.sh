#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching libtiff (with meson wrap)"
cd "$DEPS"
wget -q https://download.osgeo.org/libtiff/tiff-4.7.0.tar.xz
tar -xf tiff-4.7.0.tar.xz && rm tiff-4.7.0.tar.xz
wget -q https://wrapdb.mesonbuild.com/v2/libtiff_4.7.0-1/get_patch -O patch.zip
unzip -q patch.zip && rm patch.zip
mv tiff-4.7.0 libtiff
