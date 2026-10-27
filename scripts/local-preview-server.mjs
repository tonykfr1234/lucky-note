import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const folder = process.argv[2] || 'dist-local';
if (!['dist-local', 'dist-preview'].includes(folder)) throw new Error('Only a built local preview can be served.');
const root = resolve(folder), port = Number(process.env.LOCAL_PREVIEW_PORT || 4320);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp' };
const server = createServer((request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname); } catch { response.writeHead(400).end(); return; }
  if (folder === 'dist-preview' && pathname.startsWith('/lucky-note/')) pathname = pathname.slice('/lucky-note'.length);
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile() || !['GET','HEAD'].includes(request.method || '')) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
  if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
});
server.listen(port, '127.0.0.1', () => console.log('Local-only preview: http://127.0.0.1:' + port));
