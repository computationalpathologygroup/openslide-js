#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching cairo"
cd "$DEPS"
git clone --depth 1 --branch 1.18.4 https://gitlab.freedesktop.org/cairo/cairo.git

# No source patch: cairo's util/meson.build gates each helper executable
# (cairo-gobject, cairo-script, cairo-trace, cairo-fdr) on feature_conf flags,
# and the top-level executable loop iterates an empty list when gtk_dep is
# not found. Under Emscripten with our dependency set, none of those targets
# build. Strategy validated by VitoVan/pango-cairo-wasm.
