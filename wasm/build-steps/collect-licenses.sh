#!/usr/bin/env sh
# Collects the license text of every bundled dependency from the exact
# source tree that was fetched and compiled, so that the notices shipped
# alongside openslide.wasm always correspond to the pinned sources.
#
# Every path below was confirmed against the pinned tag/commit fetched by
# wasm/dependencies/fetch-*.sh (see NOTICE Section 1 for the pins). If a
# dependency pin changes, re-run this script against the new source tree
# and re-verify the paths still resolve — upstream projects do rename
# these files between releases.
set -e

DEPS=/build/deps
OUT=/build/out/licenses
mkdir -p "$OUT"

# Each entry: <output-name> <path-relative-to-DEPS> [<path-relative-to-DEPS> ...]
# All candidate paths are copied (not just the first match) when a
# component elects among, or is required to reproduce, more than one
# license text (e.g. cairo's LGPL text plus its top-level license
# summary). Fails the build if NONE of a component's candidates exist.
copy_license() {
  name="$1"
  shift
  found=0
  for src in "$@"; do
    if [ -f "$DEPS/$src" ]; then
      mkdir -p "$OUT/$name"
      cp "$DEPS/$src" "$OUT/$name/$(basename "$src")"
      found=1
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "ERROR: no license file found for $name (looked in: $*)" >&2
    exit 1
  fi
  echo "==> collected license for $name"
}

copy_license openslide       openslide/COPYING.LESSER
copy_license glib            glib/COPYING
# Cairo elects LGPL-2.1-only (not MPL-1.1); ship its own summary
# (COPYING) plus the full LGPL-2.1 text it points to.
copy_license cairo           cairo/COPYING cairo/COPYING-LGPL-2.1
copy_license gdk-pixbuf      gdk-pixbuf/COPYING
copy_license fontconfig      fontconfig/COPYING
# pixman extracts into a versioned subdirectory (see fetch-pixman.sh),
# so resolve the directory rather than hard-coding the version.
PIXMAN_DIR=$(cd "$DEPS" && ls -d pixman/pixman-*/ 2>/dev/null | head -1)
if [ -z "$PIXMAN_DIR" ]; then
  echo "ERROR: could not locate extracted pixman source under $DEPS/pixman" >&2
  exit 1
fi
copy_license pixman          "${PIXMAN_DIR}COPYING"
# FreeType elects the FTL (not GPL-2.0-or-later); ship the FTL text
# plus the top-level file that documents the dual-license election.
copy_license freetype        freetype/LICENSE.TXT freetype/docs/FTL.TXT
copy_license libtiff         libtiff/LICENSE.md
copy_license libjpeg-turbo   libjpeg-turbo/LICENSE.md libjpeg-turbo/README.ijg
copy_license openjpeg        openjpeg/LICENSE
copy_license libpng          libpng/LICENSE
copy_license libxml2         libxml2/Copyright
copy_license expat           libexpat/expat/COPYING
copy_license zlib            zlib/LICENSE
# zstd elects BSD-3-Clause (not GPL-2.0-only): only LICENSE is copied,
# COPYING (the GPL-2.0 text) is deliberately NOT shipped.
copy_license zstd            zstd/LICENSE
copy_license libffi          libffi/LICENSE

# SQLite (fetched from https://github.com/frida/sqlite, a Meson-build
# fork, not from sqlite.org — see NOTICE) carries no LICENSE/COPYING
# file of its own. Its amalgamated source dedicates itself to the
# public domain via a "blessing" comment repeated throughout
# sqlite3.c. Extract it verbatim instead of failing the build.
mkdir -p "$OUT/sqlite"
if [ -f "$DEPS/sqlite/sqlite3.c" ]; then
  awk '
    /The author disclaims copyright to this source code/ { p=1 }
    p { print }
    p && /\*\*\*\*\*\*/ { exit }
  ' "$DEPS/sqlite/sqlite3.c" > "$OUT/sqlite/BLESSING.txt"
  if [ ! -s "$OUT/sqlite/BLESSING.txt" ]; then
    echo "ERROR: could not extract SQLite public-domain blessing from sqlite3.c" >&2
    exit 1
  fi
  echo "==> collected license for sqlite"
else
  echo "ERROR: no license file found for sqlite (looked in: sqlite/sqlite3.c)" >&2
  exit 1
fi

echo "==> license collection complete"
ls -R "$OUT"
