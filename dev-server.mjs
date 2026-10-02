// Local preview: static files + the same /api/freeserp proxy that runs on Vercel.
//   node dev-server.mjs   ->  http://localhost:8765
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleProxy } from './lib/proxy.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8765;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/freeserp') return handleProxy(req, res);

  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || rel.split(sep).includes('..')) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`AI Radar: http://localhost:${PORT}`));
