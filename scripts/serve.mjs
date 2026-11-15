/**
 * Serves dist/ on http://localhost:8080 for working on the screens in a desktop
 * browser (sample data is shown there; see src/demo.js).
 *
 * Usage: npm run build:dev && npm run serve
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const port = Number(process.env.PORT || 8080);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join('dist', path || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path || 'index.html')] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
