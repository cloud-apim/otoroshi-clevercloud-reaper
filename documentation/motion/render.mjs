// Renders the loop frame by frame: every frame is asked for with window.__seek(t), captured, and
// piped into ffmpeg. Workers render contiguous chunks in parallel, the chunks are joined at the end.
//
//   node render.mjs                              out/reaper-loop-1080p60.mp4
//   node render.mjs --scale 2 --fps 30           4k, 30 fps
//   node render.mjs --stills 1.5,4,9.2           a few frames as png, to look at
//   node render.mjs --from 11 --to 19            a part of it
//   node render.mjs --workers 6

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const FPS = Number(arg('fps', 60));
const SCALE = Number(arg('scale', 1));
const WORKERS = Number(arg('workers', 5));
const CRF = Number(arg('crf', 16));
const STILLS = arg('stills', null);
// jpeg at quality 100 is several times faster to capture than png, and indistinguishable once in h.264
const FORMAT = arg('format', 'jpeg');
const PORT = 5190 + Math.floor(Math.random() * 500);
const OUT = resolve(ROOT, 'out');
mkdirSync(OUT, { recursive: true });

const server = await serve(PORT);
const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'] });

async function open() {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/src/index.html?render`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.evaluate((s) => (window.__dpr = s), SCALE);
  return { context, page };
}

async function frame(page, t, type = FORMAT) {
  await page.evaluate((tt) => window.__seek(tt), t);
  return page.screenshot(type === 'png' ? { type: 'png', animations: 'allow', caret: 'initial' } : { type: 'jpeg', quality: 100, animations: 'allow', caret: 'initial' });
}

if (STILLS) {
  const { page } = await open();
  const dir = resolve(OUT, 'stills');
  mkdirSync(dir, { recursive: true });
  for (const s of STILLS.split(',')) {
    const t = Number(s);
    const buf = await frame(page, t, 'png');
    const file = resolve(dir, `${t.toFixed(2)}.png`);
    writeFileSync(file, buf);
    console.log(file);
  }
  await browser.close();
  server.close();
  process.exit(0);
}

const { page: probe, context: probeCtx } = await open();
const duration = await probe.evaluate(() => window.__duration);
await probeCtx.close();
const from = Number(arg('from', 0));
const to = Number(arg('to', duration));
const first = Math.round(from * FPS);
const last = Math.round(to * FPS);
const total = last - first;
const label = SCALE === 2 ? '2160p' : `${1080 * SCALE}p`;
const name = arg('out', `reaper-loop-${label}${FPS}${from || to !== duration ? `-${from}-${to}` : ''}.mp4`);
const chunks = resolve(OUT, `chunks-${process.pid}`);
mkdirSync(chunks, { recursive: true });

console.log(`${total} frames, ${(total / FPS).toFixed(1)} s at ${FPS} fps, ${1920 * SCALE}x${1080 * SCALE}, ${WORKERS} workers → out/${name}`);
const started = Date.now();
let done = 0;

async function worker(index, a, b) {
  const { page, context } = await open();
  const file = resolve(chunks, `${String(index).padStart(3, '0')}.mp4`);
  const ff = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', FORMAT === 'png' ? 'png' : 'mjpeg', '-i', '-', // studio range and level 4.2: what the media player of a stand tv expects from 1080p60
      '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-color_range', 'tv',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CRF), '-tune', 'animation', '-profile:v', 'high', '-level:v', SCALE > 1 ? '5.1' : '4.2', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-g', String(FPS * 2), file],
    { stdio: ['pipe', 'inherit', 'inherit'] }
  );
  for (let f = a; f < b; f++) {
    const buf = await frame(page, f / FPS);
    if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
    done++;
    if (done % 60 === 0) {
      const el = (Date.now() - started) / 1000;
      process.stdout.write(`  ${done}/${total} frames, ${(done / el).toFixed(1)} fps, ~${Math.round(((total - done) / done) * el)} s left   \r`);
    }
  }
  ff.stdin.end();
  await once(ff, 'close');
  await context.close();
  return file;
}

const size = Math.ceil(total / WORKERS);
const files = await Promise.all(
  Array.from({ length: WORKERS }, (_, i) => [first + i * size, Math.min(last, first + (i + 1) * size)])
    .filter(([a, b]) => b > a)
    .map(([a, b], i) => worker(i, a, b))
);
writeFileSync(resolve(chunks, 'list.txt'), files.map((f) => `file '${f}'`).join('\n'));
const cat = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', resolve(chunks, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', resolve(OUT, name)], { stdio: 'inherit' });
await once(cat, 'close');
rmSync(chunks, { recursive: true, force: true });
console.log(`\n✓ out/${name} in ${Math.round((Date.now() - started) / 1000)} s`);
await browser.close();
server.close();
