// Dev server: serves the repo, rebuilds on changes to src/ and demo/, and reloads open pages.
//   npm run dev            then open http://localhost:8080/demo/
//   PORT=3000 npm run dev

import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8080;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
const reloadSnippet = '<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>';
const clients = new Set<ServerResponse>();

let building = false;
let again = false;
function build(): void {
  if (building) { again = true; return; }
  building = true;
  console.log('Rebuilding...');
  spawn(process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'scripts', 'build.ts')], { stdio: 'inherit' })
    .on('exit', (code) => {
      building = false;
      if (code === 0) clients.forEach((c) => c.write('data: reload\n\n'));
      else console.log('Build failed; fix the errors and save again.');
      if (again) { again = false; build(); }
    });
}

let timer: NodeJS.Timeout | undefined;
const changed = (_event: string, name: string | null) => {
  // demo.js and lib/ are build output; watching them would loop.
  if (name && /\.(ts|css|html)$/.test(name) && !name.endsWith('.d.ts')) {
    clearTimeout(timer);
    timer = setTimeout(build, 100);
  }
};
watch(join(root, 'src'), changed);
watch(join(root, 'demo'), changed);

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/') { res.writeHead(302, { Location: '/demo/' }); return res.end(); }
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    let body: Buffer | string = await readFile(file);
    if (extname(file) === '.html') body = body.toString().replace('</body>', reloadSnippet + '</body>');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log('Dev server: http://localhost:' + port + '/demo/ (rebuilds and reloads on changes)'));

build();
