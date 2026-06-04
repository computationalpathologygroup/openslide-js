#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 7. pixman ---
meson_build "$DEPS/pixman/pixman-0.46.4" \
  -Dtests=disabled
