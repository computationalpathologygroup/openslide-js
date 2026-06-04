#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 13. openjpeg ---
echo "========== Building openjpeg"
cd "$DEPS/openjpeg"
emcmake cmake . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="$CFLAGS_BASE" \
  -DCMAKE_EXE_LINKER_FLAGS="$LDFLAGS_BASE" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_CODEC=OFF \
  -DBUILD_SHARED_LIBS=OFF \
  -DZLIB_INCLUDE_DIR="$PREFIX/include" \
  -DZLIB_LIBRARY="$PREFIX/lib/libz.a" \
  -DTIFF_INCLUDE_DIR="$PREFIX/include" \
  -DTIFF_LIBRARY="$PREFIX/lib/libtiff.a" \
  -DPNG_PNG_INCLUDE_DIR="$PREFIX/include" \
  -DPNG_LIBRARY="$PREFIX/lib/libpng16.a"
emmake make install
