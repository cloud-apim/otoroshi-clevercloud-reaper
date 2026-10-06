// The fleet at the heart of the film: the Clever Cloud apps, as blocks of blackened steel on a dark floor, drawn in
// neon on a 2d canvas.
//
// - a running app glows molten orange and leaks money: embers and € signs rise from it, whether anyone uses it or
//   not;
// - an asleep app is cold: its edges dim to moonlight, a led breathes on its front, a few z drift up;
// - a waking app fills with amber from the bottom up, a scan ring climbing its sides.
//
// The world: x across the fleet, y up, z away from the camera. Everything is a function of the time T of the film
// and of the state the story gives each app at any time (`heat`, `amber`, `boot`, `flash`, see story.js). The
// embers and the z read the state of their app when they were emitted, and the time wraps around the film: the
// particles on screen at the end are the ones on screen at the start, and the loop closes on itself.

import { clamp, h, hash, lerp, set, E } from './engine.js';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const NEAR = 0.3;

export const RGB = {
  ember: [255, 128, 48],
  hot: [255, 214, 160],
  cold: [96, 196, 255],
  frost: [196, 232, 255],
  amber: [255, 196, 64],
  white: [255, 248, 238],
  req: [205, 232, 255],
};

/* ---------- the apps ---------- */

// clever cloud flavors: the height of a block, and the public hourly price of one instance (zone par, eur)
export const FLAVORS = {
  XS: { h: 0.62, price: 0.0222 },
  S: { h: 0.84, price: 0.0444 },
  M: { h: 1.1, price: 0.1056 },
};

const NAMES = [
  // the front row first, left to right
  ['shop-staging', 'S'],
  ['docs-preview', 'XS'],
  ['crm-sandbox', 'XS'],
  ['mobile-api-dev', 'S', 2],
  ['partner-portal-demo', 'XS'],
  ['billing-recette', 'M'],
  ['analytics-dashboard', 'M'],
  ['intranet-dev', 'XS'],
  ['legacy-backoffice', 'S'],
  ['ml-notebooks', 'XS', 2],
  ['hr-portal-dev', 'XS'],
  ['review-app-412', 'XS'],
  ['design-system', 'XS'],
  ['api-sandbox', 'S'],
  ['search-staging', 'S'],
  ['events-demo', 'XS'],
  ['admin-tools', 'XS'],
  ['preview-pr-87', 'XS'],
  ['data-lab', 'M'],
  ['qa-dashboard', 'XS'],
  ['kyc-staging', 'S'],
  ['cms-preview', 'XS', 2],
  ['iot-console-dev', 'XS'],
  ['onboarding-demo', 'XS'],
];

export const COLS = 6;
export const ROWS = 4;
const SP = 1.66;

export const APPS = NAMES.map(([name, flavor, inst = 1], i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return {
    i,
    name,
    flavor,
    inst,
    col,
    row,
    x: (col - (COLS - 1) / 2) * SP,
    z: (row - (ROWS - 1) / 2) * SP,
    hgt: FLAVORS[flavor].h,
    hw: inst > 1 ? 0.47 : 0.4,
    hourly: FLAVORS[flavor].price * inst,
  };
});

/** what the whole fleet costs an hour when it runs */
export const FLEET_HOURLY = APPS.reduce((s, a) => s + a.hourly, 0);

/* ---------- camera ---------- */

/**
 * A camera looking at a target point from a distance, turned by `yaw` around the vertical and tilted down by
 * `pitch`. `k` is how many pixels a unit is worth at the target, `cx, cy` where the target shows on screen.
 */
export function makeCamera(s) {
  const yaw = s.yaw * RAD;
  const pitch = s.pitch * RAD;
  const f = [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const rl = Math.hypot(f[2], f[0]);
  const r = [f[2] / rl, 0, -f[0] / rl];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const tx = s.tx || 0;
  const ty = s.ty || 0;
  const tz = s.tz || 0;
  const e = [tx - s.d * f[0], ty - s.d * f[1], tz - s.d * f[2]];
  const F = s.k * s.d;
  const cam = {
    f,
    r,
    u,
    e,
    F,
    view(p) {
      const vx = p[0] - e[0];
      const vy = p[1] - e[1];
      const vz = p[2] - e[2];
      return [vx * r[0] + vy * r[1] + vz * r[2], vx * u[0] + vy * u[1] + vz * u[2], vx * f[0] + vy * f[1] + vz * f[2]];
    },
    /** world → screen, with the pixels a unit is worth there; null behind the camera */
    project(p) {
      const c = cam.view(p);
      if (c[2] < NEAR) return null;
      return [s.cx + (F * c[0]) / c[2], s.cy - (F * c[1]) / c[2], F / c[2], c[2]];
    },
  };
  return cam;
}

/* ---------- sprites ---------- */

function sprite(size, [r, g, b], stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([at, a]) => gr.addColorStop(at, `rgba(${r},${g},${b},${a})`));
  x.fillStyle = gr;
  x.fillRect(0, 0, size, size);
  return c;
}

const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a).toFixed(3)})`;
const frac = (x) => x - Math.floor(x);

/* ---------- the fleet ---------- */

export class Fleet {
  /** `canvas` for the fleet, `layer` a div above it for the labels, `story` the state of every app over time */
  constructor({ canvas, layer, duration, story, text }) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.layer = layer;
    this.D = duration;
    this.story = story;

    this.glowEmber = sprite(128, RGB.ember, [[0, 0.9], [0.22, 0.42], [0.55, 0.1], [1, 0]]);
    this.glowCold = sprite(128, RGB.cold, [[0, 0.8], [0.25, 0.35], [0.6, 0.06], [1, 0]]);
    this.glowAmber = sprite(128, RGB.amber, [[0, 0.95], [0.25, 0.45], [0.6, 0.08], [1, 0]]);
    this.glowWhite = sprite(64, RGB.white, [[0, 1], [0.3, 0.5], [1, 0]]);
    this.glowReq = sprite(64, RGB.req, [[0, 1], [0.25, 0.5], [1, 0]]);
    this.dotEmber = sprite(32, RGB.hot, [[0, 1], [0.35, 0.65], [1, 0]]);

    // the label of each app: its name, and its state in the reaper's words
    this.labels = APPS.map((a) => {
      const dot = h('i');
      const st = h('b', { class: 'st' });
      const inner = h('div', { class: 'apill' }, dot, h('span', {}, a.name), st);
      const el = h('div', { class: 'apill-pos' }, inner);
      layer.appendChild(el);
      return { el, inner, st, dot, status: null };
    });

    // the gateway the requests come through
    const logo = h('img', { src: 'assets/img/otoroshi-logo.svg', alt: '' });
    window.__track && window.__track(logo);
    this.gw = h('div', { class: 'gw' }, logo, h('div', {}, h('b', {}, 'Otoroshi'), h('span', {}, text.gateway)));
    this.gwPos = h('div', { class: 'gw-pos' }, this.gw);
    layer.appendChild(this.gwPos);

    this.cam = null;
  }

  resize(w, hgt, dpr) {
    if (this.canvas.width !== w * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = hgt * dpr;
    }
    this.dpr = dpr;
  }

  /** the time t wrapped into the film */
  wrap(t) {
    return ((t % this.D) + this.D) % this.D;
  }

  /** where the top of an app is on screen */
  top(i, lift = 0) {
    const a = APPS[i];
    return this.cam ? this.cam.project([a.x, a.hgt + lift, a.z]) : null;
  }

  draw(T, s) {
    const g = this.g;
    const dpr = this.dpr || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 1920, 1080);
    const cam = makeCamera(s);
    this.cam = cam;
    const A = s.alpha;
    if (A <= 0.001) {
      this.labels.forEach((l) => set(l.el, { o: 0 }));
      set(this.gwPos, { o: 0 });
      return;
    }
    const st = APPS.map((a) => this.story.state(a.i, T));

    if (s.floor > 0.01) this.floor(cam, A * s.floor);

    // the pools of light the apps stand in
    g.globalCompositeOperation = 'lighter';
    APPS.forEach((a, i) => this.pool(g, cam, a, st[i], A));
    g.globalCompositeOperation = 'source-over';

    // the blocks, back to front
    const order = APPS.map((a) => ({ a, d: cam.view([a.x, a.hgt / 2, a.z])[2] })).sort((p, q) => q.d - p.d);
    for (const { a } of order) this.block(g, cam, a, st[a.i], A, T);

    // what rises from them
    g.globalCompositeOperation = 'lighter';
    this.embers(g, cam, T, s, A);
    this.zs(g, cam, T, s, A, st);
    g.globalCompositeOperation = 'source-over';

    // the requests, from the gateway
    if (s.gw && s.gw.o > 0.001) this.requests(g, cam, T, s, A);
    set(this.gwPos, s.gw ? { x: s.gw.x, y: s.gw.y, o: A * s.gw.o, s: s.gw.s || 1 } : { o: 0 });

    // the scythe
    if (s.slash) this.slash(g, s.slash, A);

    // the labels
    APPS.forEach((a, i) => {
      const l = this.labels[i];
      const want = s.label ? s.label(i, T) : null;
      const q = want && cam.project([a.x, a.hgt + 0.16, a.z]);
      if (!q || want.o <= 0.001) {
        set(l.el, { o: 0 });
        return;
      }
      const sc = clamp(q[2] / 150, 0.72, 1.12) * (want.s || 1);
      set(l.el, { x: q[0], y: q[1], s: sc, o: A * want.o });
      const status = want.status || '';
      if (l.status !== status) {
        l.st.textContent = status ? this.story.text.status[status] : '';
        l.inner.className = `apill ${status ? `has-st st-${status}` : ''}`;
        l.status = status;
      }
    });
  }

  floor(cam, a) {
    const g = this.g;
    const step = 0.44;
    for (let x = -7.5; x <= 7.501; x += step) {
      for (let z = -6; z <= 6.001; z += step) {
        const q = cam.project([x, 0, z]);
        if (!q) continue;
        const d = Math.hypot(x * 0.62, z * 0.85);
        const k = clamp(1 - d / 5.6);
        if (k <= 0.01) continue;
        const alpha = a * k * k * 0.5;
        const sz = clamp(q[2] * 0.016, 0.8, 3);
        g.fillStyle = `rgba(200,206,222,${alpha.toFixed(3)})`;
        g.fillRect(q[0] - sz / 2, q[1] - sz / 2, sz, sz);
      }
    }
  }

  pool(g, cam, a, st, A) {
    const q = cam.project([a.x, 0.01, a.z]);
    if (!q) return;
    const r = q[2] * 1.25;
    const flat = 0.55;
    const draw = (img, al, rr = r) => {
      if (al <= 0.003) return;
      g.globalAlpha = clamp(al);
      g.drawImage(img, q[0] - rr, q[1] - rr * flat, 2 * rr, 2 * rr * flat);
    };
    draw(this.glowEmber, A * (0.5 * st.heat + 0.25 * st.flash));
    draw(this.glowAmber, A * 0.55 * st.amber);
    draw(this.glowCold, A * 0.16 * (1 - st.heat) * (1 - st.amber), r * 0.9);
    // the heat above a running app
    const t = cam.project([a.x, a.hgt + 0.35, a.z]);
    if (t && st.heat > 0.01) {
      const rr = t[2] * 0.9;
      g.globalAlpha = clamp(A * 0.16 * st.heat);
      g.drawImage(this.glowEmber, t[0] - rr, t[1] - rr, 2 * rr, 2 * rr);
    }
    g.globalAlpha = 1;
  }

  block(g, cam, a, st, A, T) {
    const { x, z, hw } = a;
    const hd = 0.4;
    const y1 = a.hgt;
    const P = [
      [x - hw, 0, z - hd],
      [x + hw, 0, z - hd],
      [x + hw, 0, z + hd],
      [x - hw, 0, z + hd],
      [x - hw, y1, z - hd],
      [x + hw, y1, z - hd],
      [x + hw, y1, z + hd],
      [x - hw, y1, z + hd],
    ];
    const Q = P.map((p) => cam.project(p));
    if (Q.some((q) => !q)) return;
    const e = cam.e;
    const FACES = [
      { id: 'top', v: [4, 5, 6, 7], n: [0, 1, 0], shade: 1 },
      { id: 'front', v: [0, 1, 5, 4], n: [0, 0, -1], shade: 0.66 },
      { id: 'back', v: [2, 3, 7, 6], n: [0, 0, 1], shade: 0.42 },
      { id: 'left', v: [3, 0, 4, 7], n: [-1, 0, 0], shade: 0.5 },
      { id: 'right', v: [1, 2, 6, 5], n: [1, 0, 0], shade: 0.56 },
    ];
    const visible = FACES.filter((f) => {
      const c = f.v.reduce((m, i) => [m[0] + P[i][0] / 4, m[1] + P[i][1] / 4, m[2] + P[i][2] / 4], [0, 0, 0]);
      return f.n[0] * (e[0] - c[0]) + f.n[1] * (e[1] - c[1]) + f.n[2] * (e[2] - c[2]) > 0;
    });

    // the color of its state, and how bright its edges are
    let col = mix(RGB.cold, RGB.ember, st.heat);
    col = mix(col, RGB.amber, st.amber);
    const lit = lerp(0.3, 1, st.heat);
    const I = Math.max(lit, 0.95 * st.amber) + 0.9 * st.flash;
    const edgeCol = mix(mix(col, RGB.hot, 0.35 * st.heat), RGB.white, clamp(st.flash));

    // the faces: blackened steel, warmed or cooled by the state
    const tint = 0.025 + 0.05 * st.heat + 0.1 * st.amber + 0.25 * st.flash;
    for (const f of visible) {
      const pts = f.v.map((i) => Q[i]);
      const base = f.id === 'top' ? [40, 42, 49] : [30 * f.shade + 5, 32 * f.shade + 5, 39 * f.shade + 7];
      const fill = mix(base, col, tint * (f.id === 'top' ? 0.9 : 0.6));
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.closePath();
      if (f.id === 'top') {
        g.fillStyle = rgba(fill, A);
      } else {
        // a little light from above on the sides
        const topMid = [(pts[2][0] + pts[3][0]) / 2, (pts[2][1] + pts[3][1]) / 2];
        const botMid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
        const gr = g.createLinearGradient(topMid[0], topMid[1], botMid[0], botMid[1]);
        gr.addColorStop(0, rgba(mix(fill, [70, 70, 80], 0.18), A));
        gr.addColorStop(1, rgba(mix(fill, [0, 0, 0], 0.35), A));
        g.fillStyle = gr;
      }
      g.fill();
    }

    // the front: vents, and a led
    const front = visible.find((f) => f.id === 'front');
    if (front) this.front(g, Q, a, st, A, T);

    // the edges, each once
    const seen = new Set();
    const edges = [];
    for (const f of visible) {
      for (let k = 0; k < 4; k++) {
        const i0 = f.v[k];
        const i1 = f.v[(k + 1) % 4];
        const key = i0 < i1 ? `${i0}-${i1}` : `${i1}-${i0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([i0, i1]);
      }
    }
    const sc = clamp(Q[4][2] / 130, 0.45, 2.2);
    const neon = (list, c, intensity, from = null) => {
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (const [w, al, cc] of [
        [9 * sc, 0.075, c],
        [3.8 * sc, 0.22, c],
        [1.5 * sc, 0.9, mix(c, RGB.white, 0.3)],
      ]) {
        g.lineWidth = w;
        g.strokeStyle = rgba(cc, al * intensity * A);
        g.beginPath();
        for (const [p0, p1] of list) {
          g.moveTo(p0[0], p0[1]);
          g.lineTo(p1[0], p1[1]);
        }
        g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    };
    const seg = ([i0, i1]) => [Q[i0], Q[i1]];
    neon(edges.map(seg), edgeCol, I);

    // waking up: amber climbs the vertical edges, a ring scans up the sides
    if (st.boot > 0 && st.boot < 1) {
      const b = st.boot;
      const up = edges.filter(([i0, i1]) => Math.abs(i0 - i1) === 4).map(([i0, i1]) => {
        const lo = i0 < 4 ? i0 : i1;
        const p0 = Q[lo];
        const p1 = cam.project([P[lo][0], y1 * b, P[lo][2]]);
        return [p0, p1];
      });
      neon(up, RGB.amber, 1.1);
      const ring = [0, 1, 2, 3].map((i) => cam.project([P[i][0], y1 * b, P[i][2]]));
      const ringEdges = [
        [ring[0], ring[1]],
        [ring[1], ring[2]],
        [ring[2], ring[3]],
        [ring[3], ring[0]],
      ];
      neon(ringEdges, mix(RGB.amber, RGB.white, 0.4), 1.2 * Math.sin(Math.PI * clamp(b * 1.05)));
    }
  }

  /** vents and a led on the front face: lit and busy when the app runs, a led breathing when it sleeps */
  front(g, Q, a, st, A, T) {
    const b0 = Q[0];
    const b1 = Q[1];
    const t0 = Q[4];
    const at = (u, v) => [b0[0] + u * (b1[0] - b0[0]) + v * (t0[0] - b0[0]), b0[1] + u * (b1[1] - b0[1]) + v * (t0[1] - b0[1])];
    const sc = clamp(t0[2] / 130, 0.45, 2.2);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    const vents = a.flavor === 'M' ? [0.78, 0.66, 0.54, 0.42] : a.flavor === 'S' ? [0.76, 0.62, 0.48] : [0.74, 0.56];
    vents.forEach((v, k) => {
      const busy = 0.65 + 0.35 * Math.sin(T * (3 + k) + a.i * 1.7);
      const al = A * (0.05 + st.heat * 0.55 * busy + st.amber * 0.4);
      const c = mix(mix(RGB.cold, RGB.ember, st.heat), RGB.amber, st.amber);
      const p0 = at(0.12, v);
      const p1 = at(0.58, v);
      g.lineWidth = 2.6 * sc;
      g.strokeStyle = rgba(c, al);
      g.beginPath();
      g.moveTo(p0[0], p0[1]);
      g.lineTo(p1[0], p1[1]);
      g.stroke();
    });
    // the led: steady when it runs, breathing when it sleeps (one breath every 4 s)
    const breath = 0.5 + 0.5 * Math.sin((T / 4) * TAU + a.i);
    const ledCol = mix(mix(RGB.cold, RGB.ember, st.heat), RGB.amber, st.amber);
    const ledA = A * (st.heat * 0.95 + (1 - st.heat) * (0.25 + 0.75 * breath) * (1 - st.amber) + st.amber);
    const p = at(0.82, vents[0]);
    const r = 10 * sc;
    g.globalAlpha = clamp(ledA);
    const img = st.heat > 0.5 || st.amber > 0.5 ? (st.amber > 0.5 ? this.glowAmber : this.glowEmber) : this.glowCold;
    g.drawImage(img, p[0] - r, p[1] - r, 2 * r, 2 * r);
    g.drawImage(this.glowWhite, p[0] - r * 0.3, p[1] - r * 0.3, r * 0.6, r * 0.6);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** money rising from the running apps: embers, and € signs */
  embers(g, cam, T, s, A) {
    const euros = s.euros ?? 1;
    const N = 9;
    for (const a of APPS) {
      for (let j = 0; j < N; j++) {
        const n = 22 + Math.floor(hash(a.i * 31 + j * 7) * 9);
        const P = this.D / n;
        const k = frac(T / P + hash(a.i * 13 + j * 101));
        const te = this.wrap(T - k * P);
        const heat = this.story.state(a.i, te).heat;
        if (heat < 0.02) continue;
        const fade = Math.pow(Math.sin(Math.PI * k), 0.8) * (1 - 0.35 * k);
        const sway = Math.sin(T * 1.6 + j * 2.1 + a.i) * 0.07 * k;
        const px = a.x + (hash(a.i * 7 + j * 3) - 0.5) * 0.62 + sway;
        const pz = a.z + (hash(a.i * 11 + j * 5) - 0.5) * 0.62;
        const py = a.hgt + 0.06 + k * (1.15 + hash(a.i + j * 17) * 0.7);
        const q = cam.project([px, py, pz]);
        if (!q) continue;
        const al = A * heat * fade;
        const isEuro = j % 3 === 0;
        if (isEuro && euros > 0.01) {
          const size = q[2] * (0.15 + 0.07 * hash(a.i * 3 + j)) * (1 - 0.25 * k);
          const r = size * 1.3;
          g.globalAlpha = clamp(al * euros * 0.5);
          g.drawImage(this.glowEmber, q[0] - r, q[1] - r, 2 * r, 2 * r);
          g.globalAlpha = 1;
          g.font = `800 ${size.toFixed(1)}px "Plus Jakarta Sans Variable", sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = rgba(mix(RGB.hot, RGB.ember, k), al * euros);
          g.fillText('€', q[0], q[1]);
        } else {
          const r = q[2] * (0.05 + 0.03 * hash(a.i * 5 + j)) * (1 - 0.4 * k);
          g.globalAlpha = clamp(al * 0.9);
          g.drawImage(this.dotEmber, q[0] - r, q[1] - r, 2 * r, 2 * r);
          g.globalAlpha = clamp(al * 0.35);
          g.drawImage(this.glowEmber, q[0] - r * 3, q[1] - r * 3, r * 6, r * 6);
          g.globalAlpha = 1;
        }
      }
    }
  }

  /** z drifting up from the apps asleep */
  zs(g, cam, T, s, A, st) {
    const zz = s.zz ?? 1;
    if (zz <= 0.01) return;
    for (const a of APPS) {
      const awake = Math.max(st[a.i].heat, st[a.i].amber);
      if (awake > 0.98) continue;
      for (let j = 0; j < 2; j++) {
        const n = 14 + j * 2;
        const P = this.D / n;
        const k = frac(T / P + hash(a.i * 7 + j * 3));
        const te = this.wrap(T - k * P);
        const was = this.story.state(a.i, te);
        const cold = (1 - Math.max(was.heat, was.amber)) * (1 - awake);
        if (cold < 0.02) continue;
        const q = cam.project([a.x + 0.12 + k * 0.32 + Math.sin(k * 6 + j) * 0.05, a.hgt + 0.2 + k * 0.85, a.z - 0.1]);
        if (!q) continue;
        const size = q[2] * (0.13 + 0.12 * k);
        g.font = `800 ${size.toFixed(1)}px "Plus Jakarta Sans Variable", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = rgba(RGB.frost, A * zz * cold * Math.sin(Math.PI * k) * 0.75);
        g.fillText('z', q[0], q[1]);
      }
    }
  }

  /** the requests the gateway sends to the apps: a spark along a curve, a flash when it lands */
  requests(g, cam, T, s, A) {
    const gw = s.gw;
    g.globalCompositeOperation = 'lighter';
    for (const hit of this.story.hits) {
      const travel = hit.tr || 0.5;
      for (const shift of [0, this.D, -this.D]) {
        const t1 = hit.t + shift;
        const k = (T - (t1 - travel)) / travel;
        if (k <= 0 || k >= 1) continue;
        const q = this.top(hit.i, 0.05);
        if (!q) continue;
        const a = [gw.x + (gw.ox || 0), gw.y + (gw.oy || 0)];
        const b = [q[0], q[1]];
        const c = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 90 - Math.abs(b[0] - a[0]) * 0.12];
        const at = (u) => {
          const v = 1 - u;
          return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
        };
        const kk = E.inOutSine(k);
        const al = A * gw.o * (hit.a ?? 1);
        g.lineCap = 'round';
        g.lineWidth = 3;
        g.strokeStyle = rgba(RGB.req, 0.7 * al);
        g.beginPath();
        for (let m = 0; m <= 12; m++) {
          const u = Math.max(0, kk - 0.3) + (kk - Math.max(0, kk - 0.3)) * (m / 12);
          const [x, y] = at(u);
          if (m === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        const [x, y] = at(kk);
        g.globalAlpha = clamp(al);
        g.drawImage(this.glowReq, x - 22, y - 22, 44, 44);
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** the swing of the scythe: a crescent of cold steel with a molten edge, across the screen */
  slash(g, sl, A) {
    const { k, cx, cy, r, a0, a1 } = sl;
    if (k <= 0 || k >= 1.35) return;
    const head = lerp(a0, a1, E.inOutCubic(clamp(k)));
    const dir = Math.sign(a1 - a0);
    const len = 1.25;
    const fade = 1 - E.inCubic(clamp((k - 0.85) / 0.5));
    const N = 64;
    const thick = r * 0.075;
    g.globalCompositeOperation = 'lighter';
    for (const [mul, col, al] of [
      [3.2, RGB.ember, 0.1],
      [1.8, RGB.cold, 0.22],
      [1.0, RGB.frost, 0.55],
      [0.45, RGB.white, 0.95],
    ]) {
      g.beginPath();
      const outer = [];
      const inner = [];
      for (let m = 0; m <= N; m++) {
        const u = m / N;
        const ang = head - dir * len * (1 - u);
        // thin at the tail, full near the head, a sharp tip
        const w = thick * mul * Math.pow(u, 1.6) * (1 - Math.pow(u, 14)) * fade;
        outer.push([cx + Math.cos(ang) * (r + w / 2), cy + Math.sin(ang) * (r + w / 2)]);
        inner.push([cx + Math.cos(ang) * (r - w * 0.9), cy + Math.sin(ang) * (r - w * 0.9)]);
      }
      outer.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      for (let i = inner.length - 1; i >= 0; i--) g.lineTo(inner[i][0], inner[i][1]);
      g.closePath();
      g.fillStyle = rgba(col, al * A * fade);
      g.fill();
    }
    // sparks thrown off the tip
    for (let m = 0; m < 26; m++) {
      const born = hash(m * 7 + 1) * 0.9;
      const age = k - born;
      if (age <= 0 || age > 0.45) continue;
      const ang = lerp(a0, a1, E.inOutCubic(clamp(born)));
      const sx = cx + Math.cos(ang) * r;
      const sy = cy + Math.sin(ang) * r;
      const tang = ang + dir * (Math.PI / 2) + (hash(m * 3 + 2) - 0.5) * 0.9;
      const dist = age * (500 + 600 * hash(m * 5 + 3));
      const x = sx + Math.cos(tang) * dist;
      const y = sy + Math.sin(tang) * dist + age * age * 900;
      const rr = 7 + 8 * hash(m);
      g.globalAlpha = clamp(A * (1 - age / 0.45));
      g.drawImage(m % 2 ? this.glowEmber : this.glowWhite, x - rr, y - rr, 2 * rr, 2 * rr);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
