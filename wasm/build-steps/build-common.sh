#!/usr/bin/env sh
# Shared environment and helpers for all build-<dep>.sh steps.
# Sourced (not executed) at the top of each step script:
#   . "$(dirname "$0")/build-common.sh"
# Every step communicates with later steps only through $PREFIX, so running
# each step in its own process/Docker layer is equivalent to one shell run.
set -e

DEPS=/build/deps
PREFIX=/build/prefix
CROSS=/build/emscripten-crossfile.meson
OUT=/build/out

mkdir -p "$PREFIX" "$OUT"

export MAKEFLAGS="-j$(nproc)"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PREFIX/lib"
export EM_PKG_CONFIG_PATH="$PKG_CONFIG_PATH"
export EM_PKG_CONFIG_LIBDIR="$PKG_CONFIG_LIBDIR"
export CHOST="wasm32-unknown-linux"
export ax_cv_c_float_words_bigendian=no

CFLAGS_BASE="-O3 -msimd128 -pthread -s USE_PTHREADS=1"
LDFLAGS_BASE="-O3 -lpthread"

# Helper: build a meson project
meson_build() {
  local src="$1"; shift
  echo "========== Building $(basename "$src")"
  cd "$src"
  rm -rf _build
  CFLAGS="$CFLAGS_BASE $CFLAGS_EXTRA" \
  LDFLAGS="$LDFLAGS_BASE $LDFLAGS_EXTRA" \
  meson setup _build \
    --prefix="$PREFIX" \
    --cross-file="$CROSS" \
    --default-library=static \
    --buildtype=release \
    "$@"
  meson install -C _build
  unset CFLAGS_EXTRA LDFLAGS_EXTRA
}
