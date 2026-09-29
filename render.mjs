// Renders scene/index.html frame-by-frame in headless Chromium and pipes PNGs into ffmpeg.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const W = 1920, H = 1080, FPS = 30, SECONDS = 10, FRAMES = FPS * SECONDS;
const OUT = process.argv[2] || path.join(ROOT, 'out', 't-pose-orbit.mp4');
const PAGE = process.argv[3] || '/scene/index.html';
const FFMPEG = process.env.FFMPEG ||
  execSync(`python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`).toString().trim();

const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = PAGE;
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.error('[page error]', e));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const ff = spawn(FFMPEG, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT],
  { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate(t => window.renderAt(t), i / FRAMES);
  const png = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 30 === 0) console.log(`frame ${i}/${FRAMES}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await browser.close();
server.close();
console.log('wrote', OUT);
