#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 3. libjpeg-turbo ---
echo "========== Building libjpeg-turbo"
cd "$DEPS/libjpeg-turbo"
emcmake cmake . \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="$CFLAGS_BASE" \
  -DCMAKE_EXE_LINKER_FLAGS="$LDFLAGS_BASE" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DENABLE_STATIC=ON -DENABLE_SHARED=OFF \
  -DWITH_TURBOJPEG=FALSE \
  -DCMAKE_INSTALL_DEFAULT_COMPONENT_NAME=lib
emmake make -j$(nproc) jpeg-static
emmake make install/local
