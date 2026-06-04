#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 16. sqlite3 ---
meson_build "$DEPS/sqlite"
