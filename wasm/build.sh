#!/usr/bin/env sh
# Orchestrator: runs every per-dependency build step in order, producing the
# same result as the Docker build (which instead invokes each
# build-steps/build-*.sh as its own cached layer). Use this for a one-shot/
# manual full build.
#
# Each step lives in build-steps/ and sources build-steps/build-common.sh for
# the shared environment and the meson_build helper. State flows between steps
# only via $PREFIX, so the split is functionally identical to one monolithic run.
set -e

DIR="$(dirname "$0")/build-steps"

for s in \
  build-zlib.sh \
  build-libpng.sh \
  build-libjpeg-turbo.sh \
  build-zstd.sh \
  build-libffi.sh \
  build-glib.sh \
  build-pixman.sh \
  build-freetype.sh \
  build-libexpat.sh \
  build-fontconfig.sh \
  build-cairo.sh \
  build-libtiff.sh \
  build-openjpeg.sh \
  build-libxml2.sh \
  build-gdk-pixbuf.sh \
  build-sqlite.sh \
  build-openslide.sh \
  build-wasm.sh
do
  sh "$DIR/$s"
done
