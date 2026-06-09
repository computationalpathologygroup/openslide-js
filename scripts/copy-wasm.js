import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (target !== 'esm' && target !== 'cjs') {
  console.error('Usage: node scripts/copy-wasm.js <esm|cjs>');
  process.exit(1);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(repoRoot, 'wasm', 'dist');
const destDir = join(repoRoot, 'dist', target, 'wasm');

const files = ['openslide.js', 'openslide.wasm'];
const missing = files.filter((f) => !existsSync(join(srcDir, f)));
if (missing.length > 0) {
  console.error(
    `Missing WASM artifacts in ${srcDir}: ${missing.join(', ')}\n` +
      'Run `npm run build:wasm` first (requires Docker).'
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
for (const f of files) {
  copyFileSync(join(srcDir, f), join(destDir, f));
}
console.log(`Copied WASM artifacts to dist/${target}/wasm/`);

// Single-file glue (`-sSINGLE_FILE=1`, the `.wasm` base64-inlined): optional. It is
// only produced once the Docker WASM build emits it, so copy it when present and warn
// otherwise rather than failing — the standard build must still succeed without it.
// It lands next to the single-file worker (dist/<target>/single/openslide.single.js).
const singleGlue = 'openslide.single.js';
if (existsSync(join(srcDir, singleGlue))) {
  const singleDir = join(repoRoot, 'dist', target, 'single');
  mkdirSync(singleDir, { recursive: true });
  copyFileSync(join(srcDir, singleGlue), join(singleDir, singleGlue));
  console.log(`Copied ${singleGlue} to dist/${target}/single/`);
} else {
  console.warn(
    `Note: ${singleGlue} not found in ${srcDir} — skipping single-file variant.\n` +
      'Run `npm run build:wasm` (with the SINGLE_FILE step) to produce it.'
  );
}
