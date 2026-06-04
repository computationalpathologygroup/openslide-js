# Contributing to openslide-js

Thanks for thinking about contributing. This document covers how the project handles licensing for the bundled native dependency stack — which is the part most likely to surprise contributors coming from a typical JS project.

The TypeScript side is normal: open a PR, run `npm test` and `npm run test:integration`, and you're done.

The WASM build is more constrained, because everything we bundle into `wasm/dist/openslide.wasm` carries its own license and we ship it as one LGPL-2.1-only artifact. The rest of this file is about working within those constraints.

## License model

- **The project as a whole is `LGPL-2.1-only`**, matching upstream OpenSlide.
- **The TypeScript layer** (`src/`) is your work and is distributed under LGPL-2.1-only.
- **The WASM artifact** statically links the OpenSlide C library plus ~15 dependencies (GLib, Cairo, libtiff, libdicom, etc.). Every one of them has its own upstream license; the combined binary is distributed under LGPL-2.1-only because that's the strongest copyleft of any bundled component.
- `NOTICE` enumerates each component, its pin, its license, and any modifications. **If you change which deps are bundled, change their versions, or modify their sources, you must update `NOTICE` in the same PR.**

For the full list and source-availability statement (LGPL-2.1 §6), see [`NOTICE`](NOTICE).

## The one durable rule

A piece of code is acceptable in this repo if any of the following is true:

1. **You wrote it**, and you're distributing your contribution under LGPL-2.1-only (this is the default when you open a PR).
2. **It's licensed under a clearly compatible license** (MIT, BSD, Apache-2.0, LGPL-2.1, LGPL-2.1+, LGPL-3.0+, public domain), and the license is documented in `NOTICE`.
3. **It's mechanical enough to fall under merger doctrine** — i.e., the C language, an upstream API, or some other constraint forces essentially one way to express the change, so the expression isn't copyrightable. The current `wasm/patches/openslide.patch` thunks are an example; see its commit-message body.

Anything that doesn't fit into one of those buckets should not land in the repo. If you're unsure, ask in the PR — it's much easier to discuss before merge than after.

## Preferred order for handling a build problem in a bundled library

When you need to make a bundled C library build under Emscripten (or fix some other issue), try these approaches in order. Higher options are cleaner; only fall back to a lower option if the higher ones don't apply.

1. **Upgrade the upstream pin.** Many issues we've hit were already fixed upstream in a later release. Check the upstream's tags and release notes first. Examples:
   - Fontconfig's `cc.preprocess()` migration in 2.15+ eliminated a compiler-detection patch entirely.
   - OpenSlide v4.0.0's `-Dtest=disabled` meson option made a multi-line meson hack unnecessary.

2. **Use an upstream meson/cmake option you weren't already passing.** Many things look unconditional but turn out to be gated by an option you didn't know about. Examples:
   - `-Dbuiltin_loaders=all` for gdk-pixbuf collapsed a 75-line patch hunk to zero lines.
   - cairo's `util/meson.build` is internally gated on `CAIRO_HAS_*` feature flags — set none of them, no patch needed.

3. **A single `sed` in the fetch script.** For a one-line removal or substitution, edit the upstream source inline in `wasm/dependencies/fetch-<dep>.sh`. The shell line is unambiguously yours; no patch file needed. Example: `sed -i "/^subdir('tools')$/d" meson.build`.

4. **A small, mechanical source patch.** Only when 1–3 don't work. Keep it minimal — strip every line that isn't strictly required to make the build pass. Examples in the repo: `wasm/patches/openslide.patch` (8 vendor-file thunk hunks, ~24 lines of changes), `wasm/patches/gdk-pixbuf.patch` (one if-block wrap, ~9 lines).

5. **A larger patch derived from a permissively-licensed upstream.** Only when nothing smaller works. The patch must be tagged with the upstream's license and attribution, and `NOTICE` must credit the source. Example in the repo: `wasm/patches/glib.patch` (10-patch mailbox series from `wasm-vips`, MIT, by Kleis Auke Wolthuizen — author lines preserved verbatim).

## When you submit a patch to a bundled library

In the patch file's commit-message body, document:

- **What it does** (one paragraph).
- **Why it's needed** (the upstream behaviour and how it interacts with Emscripten).
- **Why this is the minimum** (what you removed from earlier drafts and why; what you considered and rejected).
- **Where the form is forced** if applicable (merger-doctrine analysis — list which choices are dictated by the language, the upstream API, the cross-compile target, etc.). If your patch is byte-equivalent to a patch in another project because the form is forced, *say so* — that's an honest description of the technical reality, not an admission of copying.
- **Attribution** if any non-trivial structure came from a third party. Use the SPDX identifier for the upstream's license, and add an entry under `NOTICE` Section 3.

## Adding a new bundled dependency

If your change brings a new C library into the WASM build:

1. Add `wasm/dependencies/fetch-<dep>.sh` — clone or download a specific tagged release (avoid floating SHAs when an upstream provides tags).
2. Add `wasm/build-steps/build-<dep>.sh` — the meson/cmake/autotools invocation, sourcing `build-common.sh` for the shared environment.
3. Wire both into `wasm/Dockerfile` as separate `COPY` + `RUN` layers (for cache efficiency).
4. **Add an entry under `NOTICE` Section 1** with upstream URL, pin, license (SPDX identifier), and any modification note.
5. Verify the dep's license is compatible with LGPL-2.1-only. The compatibility hierarchy (this is not legal advice, just the standard reading):
   - **Always compatible:** public domain, MIT/X11, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, FTL.
   - **Compatible with attribution:** Apache-2.0 (but pulls in a notice file requirement), LGPL-2.1+, LGPL-3.0+ (downgrades the combined license).
   - **Incompatible by default:** GPL of any version (would force the whole project to GPL), AGPL, proprietary/no-license.

## Verifying your change locally

```bash
# TypeScript only
npm run typecheck
npm test

# Full WASM rebuild (requires Docker, ~30 min from a cold cache)
npm run build:wasm

# Integration tests against the freshly-built WASM (requires Chromium)
npm run test:integration
```

The integration suite is 292 tests across all supported formats. A green run is the bar for merging WASM changes.

## When in doubt, ask

Open a draft PR with a description of the approach before doing the substantive work, or open an issue. Licensing questions in particular are easier to resolve in conversation than after a commit lands. The maintainers are happy to review approach before code.

## Related upstream projects

- [OpenSlide](https://github.com/openslide/openslide) — the C library this project compiles to WASM.
- [openslide-bin](https://github.com/openslide/openslide-bin) — the OpenSlide team's official native binary distribution; same dependency pins, different compile target.
- [discere-os/gdk-pixbuf.wasm](https://github.com/discere-os/gdk-pixbuf.wasm) — sibling WASM forks; their build choices informed several of our pinning and meson-option decisions.
- [discere-os/fontconfig.wasm](https://github.com/discere-os/fontconfig.wasm) — sibling WASM forks; their build choices informed several of our pinning and meson-option decisions.
