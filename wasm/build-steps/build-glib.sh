#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- 6. glib ---
meson_build "$DEPS/glib" \
  --force-fallback-for=gvdb \
  -Dintrospection=disabled \
  -Dselinux=disabled -Dxattr=false -Dlibmount=disabled \
  -Dsysprof=disabled -Dnls=disabled \
  -Dglib_debug=disabled \
  -Dtests=false -Dglib_assert=false -Dglib_checks=false
