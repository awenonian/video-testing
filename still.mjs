import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const server = http.createServer((q, s) => { let p = q.url === '/' ? '/scene/index.html' : q.url; const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, {'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html'}); fs.createReadStream(f).pipe(s); }).listen(0);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
pg.on('pageerror', e => console.error(e)); pg.on('console', m => console.log(m.text()));
await pg.goto(`http://localhost:${server.address().port}/`); await pg.waitForFunction(() => window.ready);
for (const t of process.argv.slice(2)) { await pg.evaluate(t => renderAt(t), +t); await pg.screenshot({ path: `${process.env.SP}/still_${t}.png` }); }
await b.close(); server.close();
