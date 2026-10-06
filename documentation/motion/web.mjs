// Encodes the master render for the landing page of the docs, into documentation/static/video:
//
//   reaper-loop.webm         av1, what most browsers play: the smallest by far
//   reaper-loop.mp4          h.264, for the browsers without av1 (safari on older devices)
//   reaper-loop-poster.jpg   the frame shown before the video plays, or instead of it with reduced motion
//
//   node render.mjs && node web.mjs
//   node web.mjs --fps 30 --poster 10.6

import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const SRC = resolve(ROOT, arg('src', 'out/reaper-loop-1080p60.mp4'));
const DEST = resolve(ROOT, '../static/video');
const FPS = arg('fps', '30');
const POSTER = arg('poster', '10.6');
mkdirSync(DEST, { recursive: true });

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
const size = (f) => `${(statSync(f).size / 1024 / 1024).toFixed(2)} MB`;

const webm = resolve(DEST, 'reaper-loop.webm');
const mp4 = resolve(DEST, 'reaper-loop.mp4');
const poster = resolve(DEST, 'reaper-loop-poster.jpg');

// av1, constant quality: the embers and the € are what costs, the text stays sharp
ffmpeg(['-i', SRC, '-an', '-r', FPS, '-c:v', 'libsvtav1', '-preset', '5', '-crf', arg('av1-crf', '46'), '-g', String(Number(FPS) * 4), '-pix_fmt', 'yuv420p', '-svtav1-params', 'tune=0', webm]);
console.log(`${webm} — ${size(webm)}`);

ffmpeg(['-i', SRC, '-an', '-r', FPS, '-c:v', 'libx264', '-preset', 'slow', '-crf', arg('h264-crf', '28'), '-tune', 'animation', '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-g', String(Number(FPS) * 4), '-movflags', '+faststart', mp4]);
console.log(`${mp4} — ${size(mp4)}`);

ffmpeg(['-ss', POSTER, '-i', SRC, '-frames:v', '1', '-q:v', '4', poster]);
console.log(`${poster} — ${size(poster)}`);
