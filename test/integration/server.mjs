import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEST_DATA = join(__dirname, '..', 'data');
const PORT = process.env.PORT ?? 8090;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

/** Recursively list all files under a directory, returning paths relative to it. */
async function listFilesRecursive(dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await listFilesRecursive(full);
      results.push(...sub.map(f => entry.name + '/' + f));
    } else {
      results.push(entry.name);
    }
  }
  return results;
}

const server = createServer(async (req, res) => {
  // Required for SharedArrayBuffer (pthreads)
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Route /fixtures-manifest/<path> — returns JSON file listing for a directory
  if (url.pathname.startsWith('/fixtures-manifest/')) {
    const dirRel = decodeURIComponent(url.pathname.slice('/fixtures-manifest/'.length));
    const dirPath = join(TEST_DATA, dirRel);
    try {
      const files = await listFilesRecursive(dirPath);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ files }));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Directory not found');
    }
    return;
  }

  let filePath;

  // Route /fixtures/* to test/data/ directory (preserving subdirectory structure)
  if (url.pathname.startsWith('/fixtures/')) {
    filePath = join(
      TEST_DATA,
      decodeURIComponent(url.pathname.slice('/fixtures/'.length)),
    );
  } else {
    filePath = join(ROOT, decodeURIComponent(url.pathname));
  }

  // Serve index.html for directory requests
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    /* fall through to 404 */
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Integration test server on http://localhost:${PORT}`);
});
