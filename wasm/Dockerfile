FROM --platform=linux/amd64 emscripten/emsdk:5.0.7

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
        autoconf automake libtool pkg-config \
        zlib1g-dev libglib2.0-dev-bin \
        python3 python3-pip \
        ninja-build wget unzip xz-utils && \
    pip3 install --break-system-packages meson && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

# --- Dependencies (each is a separate layer for Docker caching) ---
COPY dependencies/fetch-zlib.sh /build/dependencies/
RUN chmod +x dependencies/fetch-zlib.sh && ./dependencies/fetch-zlib.sh

COPY dependencies/fetch-libpng.sh /build/dependencies/
RUN chmod +x dependencies/fetch-libpng.sh && ./dependencies/fetch-libpng.sh

COPY dependencies/fetch-libjpeg-turbo.sh /build/dependencies/
RUN chmod +x dependencies/fetch-libjpeg-turbo.sh && ./dependencies/fetch-libjpeg-turbo.sh

COPY dependencies/fetch-zstd.sh /build/dependencies/
RUN chmod +x dependencies/fetch-zstd.sh && ./dependencies/fetch-zstd.sh

COPY dependencies/fetch-libffi.sh /build/dependencies/
RUN chmod +x dependencies/fetch-libffi.sh && ./dependencies/fetch-libffi.sh

COPY patches/glib.patch /build/patches/
COPY dependencies/fetch-glib.sh /build/dependencies/
RUN chmod +x dependencies/fetch-glib.sh && ./dependencies/fetch-glib.sh

COPY dependencies/fetch-pixman.sh /build/dependencies/
RUN chmod +x dependencies/fetch-pixman.sh && ./dependencies/fetch-pixman.sh

COPY dependencies/fetch-freetype.sh /build/dependencies/
RUN chmod +x dependencies/fetch-freetype.sh && ./dependencies/fetch-freetype.sh

COPY dependencies/fetch-libexpat.sh /build/dependencies/
RUN chmod +x dependencies/fetch-libexpat.sh && ./dependencies/fetch-libexpat.sh

COPY dependencies/fetch-fontconfig.sh /build/dependencies/
RUN chmod +x dependencies/fetch-fontconfig.sh && ./dependencies/fetch-fontconfig.sh

COPY dependencies/fetch-cairo.sh /build/dependencies/
RUN chmod +x dependencies/fetch-cairo.sh && ./dependencies/fetch-cairo.sh

COPY dependencies/fetch-libtiff.sh /build/dependencies/
RUN chmod +x dependencies/fetch-libtiff.sh && ./dependencies/fetch-libtiff.sh

COPY dependencies/fetch-openjpeg.sh /build/dependencies/
RUN chmod +x dependencies/fetch-openjpeg.sh && ./dependencies/fetch-openjpeg.sh

COPY dependencies/fetch-libxml2.sh /build/dependencies/
RUN chmod +x dependencies/fetch-libxml2.sh && ./dependencies/fetch-libxml2.sh

COPY patches/gdk-pixbuf.patch /build/patches/
COPY dependencies/fetch-gdk-pixbuf.sh /build/dependencies/
RUN chmod +x dependencies/fetch-gdk-pixbuf.sh && ./dependencies/fetch-gdk-pixbuf.sh

COPY dependencies/fetch-sqlite.sh /build/dependencies/
RUN chmod +x dependencies/fetch-sqlite.sh && ./dependencies/fetch-sqlite.sh

COPY patches/openslide.patch /build/patches/
COPY dependencies/fetch-openslide.sh /build/dependencies/
RUN chmod +x dependencies/fetch-openslide.sh && ./dependencies/fetch-openslide.sh

# --- Build (each step is a separate layer for Docker caching) ---
# Shared inputs first: the meson crossfile and common env/helpers are used by
# every step, so editing them correctly invalidates all build layers. The
# build.sh orchestrator is copied for manual one-shot builds but not run here.
COPY emscripten-crossfile.meson build.sh /build/
COPY build-steps/build-common.sh /build/build-steps/

COPY build-steps/build-zlib.sh /build/build-steps/
RUN chmod +x build-steps/build-zlib.sh && ./build-steps/build-zlib.sh

COPY build-steps/build-libpng.sh /build/build-steps/
RUN chmod +x build-steps/build-libpng.sh && ./build-steps/build-libpng.sh

COPY build-steps/build-libjpeg-turbo.sh /build/build-steps/
RUN chmod +x build-steps/build-libjpeg-turbo.sh && ./build-steps/build-libjpeg-turbo.sh

COPY build-steps/build-zstd.sh /build/build-steps/
RUN chmod +x build-steps/build-zstd.sh && ./build-steps/build-zstd.sh

COPY build-steps/build-libffi.sh /build/build-steps/
RUN chmod +x build-steps/build-libffi.sh && ./build-steps/build-libffi.sh

COPY build-steps/build-glib.sh /build/build-steps/
RUN chmod +x build-steps/build-glib.sh && ./build-steps/build-glib.sh

COPY build-steps/build-pixman.sh /build/build-steps/
RUN chmod +x build-steps/build-pixman.sh && ./build-steps/build-pixman.sh

COPY build-steps/build-freetype.sh /build/build-steps/
RUN chmod +x build-steps/build-freetype.sh && ./build-steps/build-freetype.sh

COPY build-steps/build-libexpat.sh /build/build-steps/
RUN chmod +x build-steps/build-libexpat.sh && ./build-steps/build-libexpat.sh

COPY build-steps/build-fontconfig.sh /build/build-steps/
RUN chmod +x build-steps/build-fontconfig.sh && ./build-steps/build-fontconfig.sh

COPY build-steps/build-cairo.sh /build/build-steps/
RUN chmod +x build-steps/build-cairo.sh && ./build-steps/build-cairo.sh

COPY build-steps/build-libtiff.sh /build/build-steps/
RUN chmod +x build-steps/build-libtiff.sh && ./build-steps/build-libtiff.sh

COPY build-steps/build-openjpeg.sh /build/build-steps/
RUN chmod +x build-steps/build-openjpeg.sh && ./build-steps/build-openjpeg.sh

COPY build-steps/build-libxml2.sh /build/build-steps/
RUN chmod +x build-steps/build-libxml2.sh && ./build-steps/build-libxml2.sh

COPY build-steps/build-gdk-pixbuf.sh /build/build-steps/
RUN chmod +x build-steps/build-gdk-pixbuf.sh && ./build-steps/build-gdk-pixbuf.sh

COPY build-steps/build-sqlite.sh /build/build-steps/
RUN chmod +x build-steps/build-sqlite.sh && ./build-steps/build-sqlite.sh

COPY build-steps/build-openslide.sh /build/build-steps/
RUN chmod +x build-steps/build-openslide.sh && ./build-steps/build-openslide.sh

# openslide-api.c is only consumed by the final link — copy it last so editing
# it (or the emcc flags) re-runs only this layer.
COPY openslide-api.c /build/
COPY build-steps/build-wasm.sh /build/build-steps/
RUN chmod +x build-steps/build-wasm.sh && ./build-steps/build-wasm.sh

# Copy output to /output when run
CMD ["cp", "-r", "/build/out/openslide.js", "/build/out/openslide.wasm", "/output/"]
