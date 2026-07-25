Title: Missing LICENSE file (package.json declares MIT)

Hi maintainers,

Thanks for this project — the meson/Emscripten build pipeline for OpenSlide's
WASM dependencies has been genuinely useful, and openslide-js credits your
work in its own NOTICE file.

While going through our own license-compliance review, we noticed that the
published npm package's `package.json` declares `"license": "MIT"`, but the
GitHub repository itself doesn't appear to have a `LICENSE` file. Under
GitHub's Terms of Service, a public repository without an explicit license
grants no rights beyond viewing and forking the source — so anyone relying on
the npm `package.json` declaration (as we currently do, with an explicit note
in our own NOTICE) is technically in an ambiguous position, even though the
intent seems clearly to be MIT.

Separately, we noticed the `patches/` directory contains modifications to
LGPL-2.1-licensed sources (GLib, gdk-pixbuf, etc.). Those patches are
derivative works of their upstream projects and would carry LGPL-2.1 terms
regardless of the repository's overall license, so a short note in that
directory (or its own license file) would help clarify things for anyone
reusing them directly.

Adding a `LICENSE` file at the repo root, plus a brief note on the licensing
of `patches/`, would resolve both points and let downstream users (including
us) reference your work with full confidence. No urgency — just flagging it
since it came up during our own review, and we're grateful either way.

Thanks again for the work!
