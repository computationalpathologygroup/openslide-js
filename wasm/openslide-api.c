/**
 * openslide-api.c
 *
 * Thin C glue between Emscripten/JS and the OpenSlide C library.
 * Each function is tagged EMSCRIPTEN_KEEPALIVE so it survives dead-code
 * elimination and is callable from JavaScript via cwrap/ccall.
 *
 * Pixel data returned by os_read_region / os_read_associated_image is
 * pre-multiplied ARGB (OpenSlide native). The JS layer is responsible
 * for converting to straight RGBA before handing it to ImageData.
 */

#include <stdlib.h>
#include <string.h>
#include <openslide/openslide.h>
#include <emscripten/emscripten.h>

/* ---- Lifecycle ---- */

EMSCRIPTEN_KEEPALIVE
openslide_t *os_open(const char *filename) {
    return openslide_open(filename);
}

EMSCRIPTEN_KEEPALIVE
void os_close(openslide_t *osr) {
    openslide_close(osr);
}

/* ---- Error ---- */

EMSCRIPTEN_KEEPALIVE
const char *os_get_error(openslide_t *osr) {
    return openslide_get_error(osr);
}

/* ---- Version / detection ---- */

EMSCRIPTEN_KEEPALIVE
const char *os_get_version(void) {
    return openslide_get_version();
}

EMSCRIPTEN_KEEPALIVE
const char *os_detect_vendor(const char *filename) {
    return openslide_detect_vendor(filename);
}

/* ---- Levels ---- */

EMSCRIPTEN_KEEPALIVE
int32_t os_get_level_count(openslide_t *osr) {
    return openslide_get_level_count(osr);
}

/**
 * Returns a malloc'd int64[2] = [width, height].
 * Caller must free via os_free_result.
 */
EMSCRIPTEN_KEEPALIVE
int64_t *os_get_level_dimensions(openslide_t *osr, int32_t level) {
    int64_t *out = malloc(2 * sizeof(int64_t));
    openslide_get_level_dimensions(osr, level, &out[0], &out[1]);
    return out;
}

EMSCRIPTEN_KEEPALIVE
double os_get_level_downsample(openslide_t *osr, int32_t level) {
    return openslide_get_level_downsample(osr, level);
}

EMSCRIPTEN_KEEPALIVE
int32_t os_get_best_level_for_downsample(openslide_t *osr, double downsample) {
    return openslide_get_best_level_for_downsample(osr, downsample);
}

/* ---- Pixel data ---- */

/**
 * Reads a region and returns a malloc'd ARGB buffer (w*h*4 bytes).
 * Caller must free via os_free_result.
 */
EMSCRIPTEN_KEEPALIVE
uint32_t *os_read_region(openslide_t *osr,
                         int64_t x, int64_t y,
                         int32_t level,
                         int64_t w, int64_t h) {
    uint32_t *buf = malloc((size_t)(w * h * 4));
    if (!buf) return NULL;
    openslide_read_region(osr, buf, x, y, level, w, h);
    return buf;
}

EMSCRIPTEN_KEEPALIVE
void os_free_result(void *ptr) {
    free(ptr);
}

/* ---- Properties ---- */

EMSCRIPTEN_KEEPALIVE
const char *const *os_get_property_names(openslide_t *osr) {
    return openslide_get_property_names(osr);
}

EMSCRIPTEN_KEEPALIVE
const char *os_get_property_value(openslide_t *osr, const char *name) {
    return openslide_get_property_value(osr, name);
}

/* ---- Associated images ---- */

EMSCRIPTEN_KEEPALIVE
const char *const *os_get_associated_image_names(openslide_t *osr) {
    return openslide_get_associated_image_names(osr);
}

/**
 * Returns a malloc'd int64[2] = [width, height].
 * Caller must free via os_free_result.
 */
EMSCRIPTEN_KEEPALIVE
int64_t *os_get_associated_image_dimensions(openslide_t *osr, const char *name) {
    int64_t *out = malloc(2 * sizeof(int64_t));
    openslide_get_associated_image_dimensions(osr, name, &out[0], &out[1]);
    return out;
}

/**
 * Reads an associated image and returns a malloc'd ARGB buffer (w*h*4 bytes).
 * Caller must free via os_free_result.
 */
EMSCRIPTEN_KEEPALIVE
uint32_t *os_read_associated_image(openslide_t *osr, const char *name) {
    int64_t w, h;
    openslide_get_associated_image_dimensions(osr, name, &w, &h);
    if (w <= 0 || h <= 0) return NULL;
    uint32_t *buf = malloc((size_t)(w * h * 4));
    if (!buf) return NULL;
    openslide_read_associated_image(osr, name, buf);
    return buf;
}

/* ---- ICC profiles ---- */

EMSCRIPTEN_KEEPALIVE
int64_t os_get_icc_profile_size(openslide_t *osr) {
    return openslide_get_icc_profile_size(osr);
}

/**
 * Reads the ICC profile into a malloc'd buffer.
 * Caller must free via os_free_result.
 */
EMSCRIPTEN_KEEPALIVE
void *os_read_icc_profile(openslide_t *osr) {
    int64_t size = openslide_get_icc_profile_size(osr);
    if (size <= 0) return NULL;
    void *buf = malloc((size_t)size);
    if (!buf) return NULL;
    openslide_read_icc_profile(osr, buf);
    return buf;
}
