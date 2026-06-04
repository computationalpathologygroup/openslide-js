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
