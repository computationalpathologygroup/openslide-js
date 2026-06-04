#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 9. libexpat ---
echo "========== Building libexpat"
cd "$DEPS/libexpat/expat"
./buildconf.sh
emconfigure ./configure \
  --host="$CHOST" \
  --prefix="$PREFIX" \
  --enable-shared=no \
  --disable-dependency-tracking \
  --without-docbook \
  CFLAGS="$CFLAGS_BASE" LDFLAGS="$LDFLAGS_BASE"
emmake make
emmake make install
