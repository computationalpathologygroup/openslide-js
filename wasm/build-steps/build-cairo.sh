#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 11. cairo ---
CFLAGS_EXTRA="$(pkg-config --cflags pixman-1 freetype2 fontconfig expat)" \
LDFLAGS_EXTRA="$(pkg-config --libs pixman-1 libpng freetype2 fontconfig expat)" \
meson_build "$DEPS/cairo" \
  -Dtests=disabled
