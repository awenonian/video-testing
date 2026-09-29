// Renders stills of scene/theater.html. Usage:
//   node model/shots.mjs <outdir> name:mode:az:el:dist[:tx:ty[:tz]] ...
// PAGE=/scene/viewer.html QUERY='?m=citadel' renders the generic viewer instead.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, s) => {
  const p = q.url === '/' || q.url.startsWith('/?') ? (process.env.PAGE || '/scene/theater.html') : decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
}).listen(0);
const [outDir, ...shots] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1200 } });
pg.on('pageerror', e => console.error(e)); pg.on('console', m => console.log(m.text()));
await pg.goto(`http://localhost:${server.address().port}/${process.env.QUERY || ''}`); await pg.waitForFunction(() => window.ready, null, { timeout: 120000 });
for (const s of shots) {
  const [name, mode, ...v] = s.split(':');
  await pg.evaluate(([m, v]) => { mode(m); view(...v.map(Number)); }, [mode, v]);
  await pg.screenshot({ path: path.join(outDir, name + '.png') });
  console.log('shot', name);
}
await b.close(); server.close();
