// The loop. `?t=12.5` opens on a moment (`&pause` to stay there), `?render` is what render.mjs uses: no clock, frames
// are asked for with window.__seek(t).

import { E, h, kf, p, set, W, H, clamp } from './engine.js';
import { Fleet, APPS, makeCamera } from './fleet.js';
import { makeStory, FOCUS, BUSY } from './story.js';
import { TEXT } from './text.js';
import { DURATION, SCENES, REAP, WAKE, LOOP } from './timing.js';

import hook from './scenes/hook.js';
import title from './scenes/title.js';
import reap from './scenes/reap.js';
import wake from './scenes/wake.js';
import awake from './scenes/awake.js';
import savings from './scenes/savings.js';
import features from './scenes/features.js';
import end from './scenes/end.js';

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
const FPS = 60;

if (RENDER) document.body.classList.add('render');

const stage = document.getElementById('stage');
const L = TEXT;

/* ---------- images: a frame is only ready once what it shows is decoded ---------- */

const pending = new Set();
window.__track = (img) => {
  const done = img.decode().catch(() => {});
  pending.add(done);
  done.finally(() => pending.delete(done));
};

/* ---------- background ---------- */

const bg = h('div', { class: 'layer' });
const grid = h('div', { class: 'bg-grid' });
const glowA = h('div', { class: 'bg-glow', style: { background: 'radial-gradient(circle, rgba(255,120,40,0.2) 0%, rgba(255,120,40,0.05) 40%, transparent 70%)' } });
const glowB = h('div', { class: 'bg-glow', style: { background: 'radial-gradient(circle, rgba(70,150,255,0.14) 0%, rgba(70,150,255,0.035) 40%, transparent 70%)' } });
// the night sky of the replayed week
const sky = h('div', { class: 'abs', style: { inset: 0, background: 'radial-gradient(ellipse 90% 70% at 65% 0%, rgba(40,90,200,0.42), rgba(20,40,110,0.16) 50%, transparent 80%)' } });
bg.append(sky, grid, glowA, glowB);
stage.appendChild(bg);

/* ---------- the fleet, shared by the scenes that show it ---------- */

const io = E.inOutCubic;
const D = DURATION;
const S = SCENES;

// where the fleet is over the film: on the right of the hook, far behind the title, close and big when the reaper
// goes through it, on the right again while an app wakes up, gone for the charts, back on the right for the end
// card, exactly where the hook picks it up
const FLEET = {
  cx: [[0, 1350], [7.4, 1350], [8.9, 960, io], [12.9, 960], [14.3, 1300, io], [23.9, 1310], [25.2, 1540, io], [34.6, 1550], [35.6, 1540, io], [58.0, 1440], [59.6, 1350, io], [D, 1350]],
  cy: [[0, 650], [7.4, 650], [8.9, 760, io], [12.9, 760], [14.3, 560, io], [23.9, 560], [25.2, 540, io], [34.6, 540], [35.6, 560, io], [58.0, 620], [59.6, 650, io], [D, 650]],
  k: [[0, 92], [7.4, 92], [8.9, 92, io], [12.9, 92], [14.3, 104, io], [23.9, 108], [25.2, 80, io], [34.6, 82], [35.6, 60, io], [58.0, 80], [59.6, 92, io], [D, 92]],
  yaw: [[0, 36], [7.4, 36], [8.9, 18, io], [12.9, 16], [14.3, 30, io], [23.9, 34], [25.2, 40, io], [34.6, 42], [35.6, 60, io], [58.0, 52], [59.6, 36, io], [D, 36]],
  pitch: [[0, 30], [7.4, 30], [8.9, 18, io], [12.9, 18], [14.3, 34, io], [23.9, 34], [25.2, 32, io], [34.6, 32], [35.6, 40, io], [58.0, 26], [59.6, 30, io], [D, 30]],
  alpha: [[0, 1], [7.4, 1], [8.5, 0, E.inCubic], [12.9, 0], [14.0, 1, E.outCubic], [34.7, 1], [35.5, 0, E.inCubic], [58.3, 0], [59.5, 1, E.outCubic], [D, 1]],
  floor: [[0, 1], [D, 1]],
  euros: [[0, 1], [8, 1], [13.5, 0.8], [D - 6, 0.8], [D - 1, 1], [D, 1]],
  zz: [[0, 1], [D, 1]],
  // the gateway the requests come through
  gwx: [[0, 860], [7.4, 860], [13.6, 860], [13.7, 1690], [24.3, 1690], [24.4, 1090], [34.6, 1090], [35.0, 1090], [58.0, 860], [D, 860]],
  gwy: [[0, 960], [7.4, 960], [13.6, 960], [13.7, 150], [24.3, 150], [24.4, 560], [34.6, 560], [35.0, 560], [58.0, 960], [D, 960]],
  gwo: [[0, 1], [7.2, 1], [7.8, 0], [14.2, 0], [15.0, 1], [23.8, 1], [24.3, 0], [24.6, 0], [25.2, 1], [34.4, 1], [35.0, 0], [59.2, 0], [60.0, 1], [D, 1]],
};

const fleetCanvas = h('canvas', { class: 'layer' });
const fleetLayer = h('div', { class: 'layer', style: { pointerEvents: 'none' } });
stage.append(fleetCanvas, fleetLayer);

function pose(T) {
  const s = {};
  for (const k of Object.keys(FLEET)) s[k] = kf(T, FLEET[k]);
  s.d = 16;
  s.ty = 0.45;
  // a slow orbit, a whole number of turns over the film
  s.yaw += 2.2 * Math.sin((T / D) * Math.PI * 2 * 2);
  // the scythe shakes the frame a little
  const hitAt = (REAP.slash[0] + REAP.slash[1]) / 2;
  const shake = T > hitAt ? Math.exp(-(T - hitAt) * 4.5) : 0;
  s.cx += Math.sin((T - hitAt) * 47) * 9 * shake;
  s.cy += Math.cos((T - hitAt) * 39) * 6 * shake;
  return s;
}

// the swing of the scythe, in screen space, and when it reaches each app
const SLASH = { cx: 1300, cy: -170, r: 820, a0: 30, a1: 150 };
const RAD = Math.PI / 180;
const slashAngle = (t) => SLASH.a0 + (SLASH.a1 - SLASH.a0) * E.inOutCubic(p(t, REAP.slash[0], REAP.slash[1]));
const slashAt = (() => {
  const s = pose((REAP.slash[0] + REAP.slash[1]) / 2);
  const cam = makeCamera(s);
  return APPS.map((a) => {
    const q = cam.project([a.x, a.hgt / 2, a.z]);
    const ang = Math.atan2(q[1] - SLASH.cy, q[0] - SLASH.cx) / RAD;
    for (let t = REAP.slash[0]; t <= REAP.slash[1]; t += 0.005) if (slashAngle(t) >= ang) return t;
    return REAP.slash[1];
  });
})();

const story = makeStory({ text: L, slashAt });
const fleet = new Fleet({ canvas: fleetCanvas, layer: fleetLayer, duration: D, story, text: L });

/* ---------- scenes ---------- */

const ctx = { L, stage, story, fleet, DURATION: D };
const scenes = [hook, title, reap, wake, awake, savings, features, end].map((make) => make(ctx));
scenes.forEach((s) => {
  s.root.style.display = 'none';
  stage.appendChild(s.root);
});

const vignette = h('div', { class: 'vignette' });
stage.appendChild(vignette);

// a light passing across the frame where one scene hands over to the next
const SWEEPS = [S.reap[0] - 0.15, S.wake[0] - 0.15, S.awake[0] - 0.15, S.savings[0] - 0.15, S.features[0] - 0.15];
const sweep = h('div', { class: 'abs', style: { left: 0, top: '-300px', width: '700px', height: '1700px', background: 'linear-gradient(90deg, rgba(255,170,110,0) 0%, rgba(255,170,110,0.09) 30%, rgba(255,226,200,0.32) 50%, rgba(255,170,110,0.09) 70%, rgba(255,170,110,0) 100%)', transform: 'rotate(14deg)', mixBlendMode: 'screen', pointerEvents: 'none' } });
const flashEl = h('div', { class: 'abs', style: { inset: 0, background: '#ffe4cc', mixBlendMode: 'screen', pointerEvents: 'none' } });
stage.append(sweep, flashEl);

/* ---------- one frame ---------- */

function render(T) {
  T = ((T % D) + D) % D;

  // the grid drifts a whole number of cells over the film
  set(grid, { x: -(((T / D) * 64 * 6) % 64), y: -(((T / D) * 64 * 3) % 64), o: kf(T, [[0, 0.7], [12, 0.5], [D - 6, 0.5], [D, 0.7]]) });
  const s = pose(T);
  set(glowA, { x: s.cx, y: s.cy + 40, o: kf(T, [[0, 1], [35, 1], [35.6, 0.5], [58, 0.5], [59.5, 1], [D, 1]]) });
  set(glowB, { x: kf(T, [[0, 380], [8, 380], [13, 1500], [36, 300], [58, 380], [D, 380]]), y: kf(T, [[0, 840], [36, 300], [D, 840]]), o: kf(T, [[0, 0.7], [8, 0.4], [20, 1], [40, 0.9], [D, 0.7]]) });

  // a scene may bend the fleet to what it tells (the hook turns night and day)
  s.night = 0;
  for (const sc of scenes) if (sc.fleet && T >= sc.start && T < sc.end) sc.fleet(T - sc.start, s, T);
  set(sky, { o: s.night });

  const dpr = window.__dpr || 1;
  fleet.resize(W, H, dpr);
  s.gw = { x: s.gwx, y: s.gwy, o: s.gwo, ox: 110, oy: 0 };
  s.slash = T > REAP.slash[0] - 0.05 && T < REAP.slash[1] + 0.6 ? { k: p(T, REAP.slash[0], REAP.slash[1]) + (T > REAP.slash[1] ? (T - REAP.slash[1]) / 1.2 : 0), cx: SLASH.cx, cy: SLASH.cy, r: SLASH.r, a0: SLASH.a0 * RAD, a1: SLASH.a1 * RAD } : null;
  s.label = (i, t) => label(i, t);
  fleet.draw(T, s);

  for (const sc of scenes) {
    const on = T >= sc.start && T < sc.end;
    if (sc.root.__on !== on) {
      sc.root.style.display = on ? '' : 'none';
      sc.root.__on = on;
    }
  }
  for (const sc of scenes) if (T >= sc.start && T < sc.end) sc.update(T - sc.start, T);

  let flash = 0;
  let pos = -1;
  for (const at of SWEEPS) {
    const k = (T - at) / 0.6;
    if (k > 0 && k < 1) {
      pos = k;
      flash = Math.max(flash, Math.sin(Math.PI * k));
    }
  }
  const mid = (REAP.slash[0] + REAP.slash[1]) / 2;
  const cut = T > mid ? Math.exp(-(T - mid) * 6) : 0;
  set(sweep, { x: pos < 0 ? -3000 : -900 + pos * 3700, o: pos < 0 ? 0 : 1 });
  set(flashEl, { o: Math.max(flash * 0.08, cut * 0.09) });
}

/** the labels over the apps, and the state they say */
const HOOK_LABELS = new Set([0, 2, 5, 13, 21]);
function label(i, T) {
  const inOut = (a, b, fi = 0.5, fo = 0.4) => Math.min(E.outCubic(p(T, a, a + fi)), 1 - E.inCubic(p(T, b - fo, b)));
  if (T < S.hook[1] && HOOK_LABELS.has(i)) return { o: inOut(1.6 + i * 0.03, 7.4) };
  if (i === FOCUS && T > S.reap[0] && T < S.wake[1]) {
    const status = T < REAP.going ? 'up' : T < REAP.down ? 'going' : T < WAKE.hit + 0.2 ? 'asleep' : T < WAKE.up ? 'waking' : 'up';
    return { o: inOut(14.6, 34.6), status, s: 1.15 };
  }
  if (T > S.end[0] && (i === FOCUS || i === 1 || i === 3) && T < LOOP[0] + 0.3) {
    const status = i === 1 ? 'asleep' : 'up';
    return { o: inOut(59.6 + i * 0.1, LOOP[0] + 0.3), status };
  }
  return null;
}

async function settle() {
  while (pending.size) await Promise.all([...pending]);
  await new Promise((r) => requestAnimationFrame(() => r()));
}

window.__duration = D;
window.__fps = FPS;
window.__seek = async (T) => {
  render(T);
  await settle();
  render(T);
  await settle();
};

/* ---------- live ---------- */

function fit() {
  if (RENDER) return;
  const sc = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `scale(${sc})`;
}
window.addEventListener('resize', fit);
fit();

await document.fonts.load('800 100px "Plus Jakarta Sans Variable"');
await document.fonts.load('500 20px "Plus Jakarta Sans Variable"');
await document.fonts.ready;

if (!RENDER) {
  const hud = document.getElementById('hud');
  let t0 = performance.now() - (Number(params.get('t')) || 0) * 1000;
  let paused = params.has('t') && params.has('pause');
  let frozen = Number(params.get('t')) || 0;
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      paused = !paused;
      if (!paused) t0 = performance.now() - frozen * 1000;
    }
    if (e.key === 'ArrowRight') {
      t0 -= 2000;
      frozen += 2;
    }
    if (e.key === 'ArrowLeft') {
      t0 += 2000;
      frozen -= 2;
    }
  });
  const loop = (now) => {
    const T = paused ? frozen : (now - t0) / 1000;
    if (!paused) frozen = T;
    render(T);
    hud.textContent = `${(((T % D) + D) % D).toFixed(2)}s  ·  space: pause  ·  ←/→: 2s`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  render(0);
}
window.__ready = true;
