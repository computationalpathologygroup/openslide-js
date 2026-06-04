#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 12. libtiff ---
meson_build "$DEPS/libtiff" \
  -Djpeg=enabled
