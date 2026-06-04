#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching fontconfig"
cd "$DEPS"
# fontconfig 2.17.1: contains upstream commit e3563fa2 (May 2023) which
# migrated src/meson.build to meson's built-in cc.preprocess(), removing the
# `cc.get_id() == 'clang'` if-elif-else block that errored on Emscripten.
# No source patch needed at this version. Strategy validated by
# discere-os/fontconfig.wasm which builds the same upstream cleanly.
git clone --depth 1 --branch 2.17.1 https://gitlab.freedesktop.org/fontconfig/fontconfig.git
