#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 15. gdk-pixbuf ---
# Strategy: rely on upstream meson options to gate WASM-incompatible targets
# rather than patching meson.build heavily.
#   * -Dbuiltin_loaders=all skips the shared_module() loader-plugin loop
#     (the loop is already gated on `builtin_all_loaders` upstream).
#   * USE_GMODULE is gated on GLib's pkg-config-advertised
#     `gmodule_supported` value; GLib built without a dlopen backend
#     reports false, leaving the #ifdef USE_GMODULE block dead at
#     preprocessor time. A defensive override of the pc file below
#     guarantees this even if a future GLib build advertises true.
#   * The gdk-pixbuf-csource/pixdata/query-loaders executables are
#     gated by a tiny upstream-style patch (wasm/patches/gdk-pixbuf.patch)
#     wrapping their foreach in `if not meson.is_cross_build()`.
sed -i 's/^gmodule_supported=.*$/gmodule_supported=false/' \
  "$PREFIX/lib/pkgconfig/gmodule-no-export-2.0.pc" \
  "$PREFIX/lib/pkgconfig/gmodule-2.0.pc" 2>/dev/null || true
CFLAGS_EXTRA="$(pkg-config --cflags libpng libzstd libtiff-4 libopenjp2 glib-2.0 libjpeg)" \
LDFLAGS_EXTRA="$(pkg-config --libs libpng libzstd libtiff-4 libopenjp2 glib-2.0 libjpeg)" \
meson_build "$DEPS/gdk-pixbuf" \
  -Dbuiltin_loaders=all \
  -Dgio_sniffing=false \
  -Dgtk_doc=false \
  -Ddocs=false \
  -Dman=false \
  -Dinstalled_tests=false \
  -Dintrospection=disabled \
  -Dnative_windows_loaders=false \
  -Dtests=false
