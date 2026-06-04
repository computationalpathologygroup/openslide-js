#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 2. libpng ---
echo "========== Building libpng"
cd "$DEPS/libpng"
emcmake cmake . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="$CFLAGS_BASE" \
  -DCMAKE_EXE_LINKER_FLAGS="$LDFLAGS_BASE" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DPNG_STATIC=ON -DPNG_SHARED=OFF -DPNG_TESTS=OFF \
  -DZLIB_INCLUDE_DIR="$PREFIX/include" \
  -DZLIB_LIBRARY="$PREFIX/lib/libz.a"
emmake make install
