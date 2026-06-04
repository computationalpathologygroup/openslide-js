#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 8. freetype ---
CFLAGS_EXTRA="$(pkg-config --cflags pixman-1)" \
LDFLAGS_EXTRA="$(pkg-config --libs pixman-1)" \
meson_build "$DEPS/freetype" \
  -Dtests=disabled
