#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 17. openslide ---
CFLAGS_EXTRA="$(pkg-config --cflags sqlite3 gdk-pixbuf-2.0 libtiff-4 libopenjp2 glib-2.0 cairo libjpeg)" \
LDFLAGS_EXTRA="$(pkg-config --libs glib-2.0 cairo libjpeg)" \
meson_build "$DEPS/openslide" \
  -Dtest=disabled
