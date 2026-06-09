#!/usr/bin/env sh
. "$(dirname "$0")/build-common.sh"

# --- Final: compile the WASM glue ---
echo "========== Building openslide WASM module"
cd "$DEPS"

# Shared compile. Extra args (e.g. SINGLE_FILE) and the `-o <output>` are passed in,
# so the standard and single-file glues are produced from one identical flag set.
build_glue() {
  emcc -lworkerfs.js \
    -O3 -flto -msimd128 \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="createOpenSlideModule" \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT=web,worker \
    -s ASYNCIFY=1 \
    -s ASYNCIFY_STACK_SIZE=65536 \
    -s ALLOW_MEMORY_GROWTH \
    -s WASM_BIGINT \
    -s USE_PTHREADS=1 \
    -s EXPORTED_FUNCTIONS="[\
      '_malloc','_free',\
      '_os_open','_os_close',\
      '_os_get_level_count','_os_get_level_dimensions',\
      '_os_get_level_downsample','_os_get_best_level_for_downsample',\
      '_os_read_region','_os_free_result',\
      '_os_get_property_names','_os_get_property_value',\
      '_os_get_associated_image_names',\
      '_os_get_associated_image_dimensions',\
      '_os_read_associated_image',\
      '_os_get_error','_os_get_version',\
      '_os_detect_vendor',\
      '_os_get_icc_profile_size','_os_read_icc_profile'\
    ]" \
    -s EXPORTED_RUNTIME_METHODS="['FS','MEMFS','WORKERFS','cwrap','UTF8ToString','HEAPU8','HEAP32','HEAP64']" \
    "$@" \
    $(pkg-config --libs --cflags openslide glib-2.0) \
    /build/openslide-api.c
}

# Standard build: separate openslide.js + openslide.wasm.
build_glue -o "$OUT/openslide.js"

# Single-file build: the .wasm is base64-inlined into the glue, so there is no
# separate binary. Powers the `@.../openslide-js/single` export — consumers need no
# `.wasm` bundler rule and no `wasmBinary` plumbing (trade-off: ~33% larger, slower
# cold start, no streaming compilation).
build_glue -s SINGLE_FILE=1 -o "$OUT/openslide.single.js"

echo "========== Build complete"
ls -lh "$OUT"/openslide.*
