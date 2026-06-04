#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 5. libffi ---
echo "========== Building libffi"
cd "$DEPS/libffi"
emconfigure ./configure \
  --host="$CHOST" \
  --prefix="$PREFIX" \
  --enable-static --disable-shared \
  --disable-dependency-tracking --disable-builddir \
  --disable-multi-os-directory --disable-raw-api \
  --disable-structs --disable-docs \
  CFLAGS="$CFLAGS_BASE"
emmake make
emmake make install SUBDIRS='include'
