#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 1. zlib ---
echo "========== Building zlib"
cd "$DEPS/zlib"
emconfigure ./configure --static --prefix="$PREFIX"
emmake make
emmake make install
