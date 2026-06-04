#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 4. zstd ---
meson_build "$DEPS/zstd/build/meson"
