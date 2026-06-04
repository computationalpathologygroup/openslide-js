#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 10. fontconfig ---
CFLAGS_EXTRA="$(pkg-config --cflags pixman-1)" \
LDFLAGS_EXTRA="$(pkg-config --libs pixman-1)" \
meson_build "$DEPS/fontconfig" \
  -Dtools=disabled -Dtests=disabled
