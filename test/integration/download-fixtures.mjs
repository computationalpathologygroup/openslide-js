#!/usr/bin/env node
/**
 * Downloads all OpenSlide test data from the upstream repository into test/data/.
 * Fetches the remote index.json first and keeps the local copy in sync.
 * Verifies SHA-256 hashes. Skips files already present with a correct hash.
 * ZIPs are extracted into a sibling directory after download.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const INDEX_PATH = join(DATA_DIR, 'index.json');

const BASE_URL = 'https://openslide.cs.cmu.edu/download/openslide-testdata/';
const INDEX_URL = BASE_URL + 'index.json';

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function downloadFile(url, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  await pipeline(response.body, createWriteStream(destPath));
}

async function syncIndex() {
  process.stdout.write('Fetching remote index.json... ');
  const response = await fetch(INDEX_URL);
  if (!response.ok) throw new Error(`Failed to fetch index: HTTP ${response.status}`);
  const remoteText = await response.text();
  const localText = await readFile(INDEX_PATH, 'utf-8').catch(() => '');
  if (remoteText !== localText) {
    mkdirSync(DATA_DIR, { recursive: true });
    await writeFile(INDEX_PATH, remoteText, 'utf-8');
    console.log('updated.');
  } else {
    console.log('already up to date.');
  }
  return JSON.parse(remoteText);
}

async function ensureFile(file, entry, label) {
  const destPath = join(DATA_DIR, file);

  if (existsSync(destPath)) {
    const hash = await sha256File(destPath);
    if (hash === entry.sha256) {
      console.log(`${label} OK (cached): ${file}`);
      return;
    }
    console.log(`${label} STALE (hash mismatch, re-downloading): ${file}`);
  }

  const url = BASE_URL + file;
  console.log(`${label} Downloading: ${file} (${(entry.size / 1e6).toFixed(1)} MB)...`);
  await downloadFile(url, destPath);

  const hash = await sha256File(destPath);
  if (hash !== entry.sha256) {
    throw new Error(
      `Hash mismatch for ${file}:\n  expected ${entry.sha256}\n  got      ${hash}`,
    );
  }
  console.log(`${label} OK: ${file}`);
}

async function extractZip(zipPath, extractDir) {
  if (existsSync(extractDir) && readdirSync(extractDir).length > 0) {
    console.log(`  Already extracted: ${basename(extractDir)}/`);
    return;
  }
  mkdirSync(extractDir, { recursive: true });
  console.log(`  Extracting → ${basename(extractDir)}/...`);
  execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
}

async function main() {
  const index = await syncIndex();
  const entries = Object.entries(index);
  console.log(`Found ${entries.length} files in index.\n`);

  for (let i = 0; i < entries.length; i++) {
    const [file, entry] = entries[i];
    const label = `[${i + 1}/${entries.length}]`;

    await ensureFile(file, entry, label);

    if (file.endsWith('.zip')) {
      const destPath = join(DATA_DIR, file);
      const extractDir = join(dirname(destPath), basename(file, '.zip'));
      await extractZip(destPath, extractDir);
    }
  }

  console.log('\nAll files ready.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
