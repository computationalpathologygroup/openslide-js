#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 14. libxml2 ---
meson_build "$DEPS/libxml2" \
  -Dpython=disabled
