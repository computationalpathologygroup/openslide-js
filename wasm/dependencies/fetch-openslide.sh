#!/usr/bin/env sh
set -e
DEPS=/build/deps
mkdir -p "$DEPS"

echo "==> Fetching openslide"
cd "$DEPS"
# Pinned at v4.0.0 — the same tagged release the upstream OpenSlide
# maintainers ship via openslide-bin (their official binary distribution).
# Pinning to a tagged release is more reproducible than chasing a development
# SHA. Note: vendor support for Zeiss CZI was added in upstream development
# after v4.0.0 and will arrive in the next OpenSlide release.
git clone --depth 1 --branch v4.0.0 https://github.com/openslide/openslide.git

# At v4.0.0 the test/ subdir is already gated by -Dtest=disabled (passed in
# build.sh) and the doc/ subdir auto-skips when doxygen is not present (which
# it isn't in our Emscripten container). Only subdir('tools') is unconditional —
# remove it via sed since Emscripten cannot link the native helper executables
# (openslide-show-properties etc.).
cd "$DEPS/openslide"
sed -i "/^subdir('tools')$/d" meson.build

# Modern GLib (>= 2.76) routes g_list_sort and g_ptr_array_sort through
# their *_with_data variants internally, casting the 2-arg GCompareFunc to
# a 3-arg GCompareDataFunc. Native linkers tolerate this; WebAssembly's
# call_indirect instruction is a VM-level type check that traps on the
# signature mismatch (manifesting as "function signature mismatch" at
# slide-open time). No compiler/linker flag can suppress this — it is
# part of the WASM execution model. Mechanical _with_data thunks at each
# sort callsite are the minimum-cost fix. This patch is original
# openslide-js code: a textbook adapter pattern (merger doctrine).
git apply /build/patches/openslide.patch
