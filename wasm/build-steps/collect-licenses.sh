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
#
# copy_license_all: ALL listed paths must exist. Fails the build if any is
# missing. This is the default — use it for every component, so that a
# renamed or removed upstream license file is caught immediately instead of
# silently dropping a candidate while the build stays green.
copy_license_all() {
  name="$1"
  shift
  mkdir -p "$OUT/$name"
  for src in "$@"; do
    if [ ! -f "$DEPS/$src" ]; then
      echo "ERROR: required license file missing for $name: $src" >&2
      echo "       (upstream may have renamed it — update collect-licenses.sh" >&2
      echo "        and NOTICE, then regenerate licenses/)" >&2
      exit 1
    fi
    cp "$DEPS/$src" "$OUT/$name/$(basename "$src")"
  done
  echo "==> collected license for $name ($# file(s))"
}

# copy_license_any: at least ONE listed path must exist; all that exist are
# copied. Use ONLY where upstream genuinely varies the filename between
# releases — none of the current components qualify, so this is unused
# today but kept available rather than removed, since a future dependency
# may legitimately need it.
copy_license_any() {
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

copy_license_all openslide       openslide/COPYING.LESSER
copy_license_all glib            glib/COPYING
# Cairo elects LGPL-2.1-only (not MPL-1.1); ship its own summary
# (COPYING) plus the full LGPL-2.1 text it points to. Both are required:
# losing either would leave the summary pointing at a missing LGPL text.
copy_license_all cairo           cairo/COPYING cairo/COPYING-LGPL-2.1
copy_license_all gdk-pixbuf      gdk-pixbuf/COPYING
copy_license_all fontconfig      fontconfig/COPYING
# pixman extracts into a versioned subdirectory (see fetch-pixman.sh),
# so resolve the directory rather than hard-coding the version.
PIXMAN_DIR=$(cd "$DEPS" && ls -d pixman/pixman-*/ 2>/dev/null | head -1)
if [ -z "$PIXMAN_DIR" ]; then
  echo "ERROR: could not locate extracted pixman source under $DEPS/pixman" >&2
  exit 1
fi
copy_license_all pixman          "${PIXMAN_DIR}COPYING"
# FreeType elects the FTL (not GPL-2.0-or-later); ship the FTL text plus
# the top-level file that documents the dual-license election. Both are
# required for the same reason as Cairo above.
copy_license_all freetype        freetype/LICENSE.TXT freetype/docs/FTL.TXT
copy_license_all libtiff         libtiff/LICENSE.md
copy_license_all libjpeg-turbo   libjpeg-turbo/LICENSE.md libjpeg-turbo/README.ijg
copy_license_all openjpeg        openjpeg/LICENSE
copy_license_all libpng          libpng/LICENSE
copy_license_all libxml2         libxml2/Copyright
copy_license_all expat           libexpat/expat/COPYING
copy_license_all zlib            zlib/LICENSE
# zstd elects BSD-3-Clause (not GPL-2.0-only): only LICENSE is copied,
# COPYING (the GPL-2.0 text) is deliberately NOT shipped.
copy_license_all zstd            zstd/LICENSE
copy_license_all libffi          libffi/LICENSE

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

# Every dependency fetched must have produced a licenses/ entry. Path-level
# checks above still miss a whole component being deleted from this script
# by accident. /build/dependencies holds one fetch-*.sh per component,
# individually COPYed into the final image layer (verified: this Dockerfile
# is single-stage, so nothing here is discarded before this step runs).
expected=$(ls /build/dependencies/fetch-*.sh 2>/dev/null | wc -l)
actual=$(find "$OUT" -mindepth 1 -maxdepth 1 -type d | wc -l)
if [ "$expected" -ne "$actual" ]; then
  echo "ERROR: $expected dependencies fetched but $actual license directories produced" >&2
  find "$OUT" -mindepth 1 -maxdepth 1 -type d -printf '  have: %f\n' >&2
  exit 1
fi
echo "==> license completeness check passed ($actual components)"

echo "==> license collection complete"
ls -R "$OUT"
