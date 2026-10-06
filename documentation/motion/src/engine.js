// The whole film is a pure function of time: nothing animates on its own, every frame is computed
// from `t` by the scenes. That is what lets the same page play live in a browser and be rendered frame
// by frame, exactly, by render.mjs.

export const W = 1920;
export const H = 1080;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** progress of t through [a, b], clamped to 0…1 */
export const p = (t, a, b) => clamp((t - a) / (b - a));

export const E = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outBackSoft: (t) => {
    const c1 = 1.1;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  /** a damped spring settling on 1 */
  spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(10.5 * t)),
};

/** value of a tween from `from` to `to` over [a, b] */
export const tw = (t, a, b, from, to, ease = E.outCubic) => lerp(from, to, ease(p(t, a, b)));

/**
 * Keyframes: `[[t0, v0], [t1, v1, ease], …]`, the ease of a key applies to the segment arriving at
 * it. Values may be numbers or arrays of numbers.
 */
export function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = E.inOutCubic] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = ease(p(t, t0, t1));
      return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], k)) : lerp(v0, v1, k);
    }
  }
  return keys[keys.length - 1][1];
}

/** in, hold, out: 0 → 1 over [a, a+fin], 1 until b-fout, → 0 at b */
export const inOut = (t, a, b, fin = 0.4, fout = 0.4, ein = E.outCubic, eout = E.inCubic) =>
  t < a || t > b ? 0 : Math.min(ein(p(t, a, a + fin)), 1 - eout(p(t, b - fout, b)));

/* ---------- deterministic randomness ---------- */

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/** a stable pseudo random number in 0…1 for an integer */
export const hash = (n) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

/* ---------- dom ---------- */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

const n = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Sets the visual state of an element in one go. Only what changed since the previous frame is
 * written, so a still element costs nothing.
 */
export function set(el, o) {
  const tr = [];
  if (o.x !== undefined || o.y !== undefined || o.z !== undefined) tr.push(`translate3d(${n(o.x || 0, 2)}px, ${n(o.y || 0, 2)}px, ${n(o.z || 0, 2)}px)`);
  if (o.rx) tr.push(`rotateX(${n(o.rx)}deg)`);
  if (o.ry) tr.push(`rotateY(${n(o.ry)}deg)`);
  if (o.r) tr.push(`rotate(${n(o.r)}deg)`);
  if (o.s !== undefined && o.s !== 1) tr.push(`scale(${n(o.s, 4)})`);
  if (o.sx !== undefined || o.sy !== undefined) tr.push(`scale(${n(o.sx ?? 1, 4)}, ${n(o.sy ?? 1, 4)})`);
  const next = {};
  next.transform = tr.join(' ');
  if (o.o !== undefined) next.opacity = String(n(clamp(o.o), 4));
  const filters = [];
  if (o.blur) filters.push(`blur(${n(o.blur, 2)}px)`);
  if (o.bright !== undefined && o.bright !== 1) filters.push(`brightness(${n(o.bright)})`);
  if (o.sat !== undefined && o.sat !== 1) filters.push(`saturate(${n(o.sat)})`);
  next.filter = filters.join(' ');
  if (o.clip !== undefined) next.clipPath = o.clip;
  if (o.w !== undefined) next.width = `${n(o.w, 2)}px`;
  if (o.hgt !== undefined) next.height = `${n(o.hgt, 2)}px`;
  const prev = el.__s || (el.__s = {});
  for (const k in next) {
    if (prev[k] !== next[k]) {
      el.style[k] = next[k];
      prev[k] = next[k];
    }
  }
  if (o.o !== undefined) {
    const hidden = o.o <= 0.001;
    if (prev.hidden !== hidden) {
      el.style.visibility = hidden ? 'hidden' : '';
      prev.hidden = hidden;
    }
  }
}

export function text(el, value) {
  if (el.__t !== value) {
    el.textContent = value;
    el.__t = value;
  }
}

export const fmtInt = (v, lang = 'en') => Math.round(v).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US').replace(/ | /g, ' ');

/**
 * Splits the text of an element in words (and optionally letters), each wrapped for a masked
 * reveal: `<span class="w"><span class="wi">word</span></span>`.
 */
export function words(el, str, { letters = false, cls = '' } = {}) {
  el.textContent = '';
  const out = [];
  str.split(/(\s+)/).forEach((part) => {
    if (/^\s+$/.test(part)) {
      el.appendChild(document.createTextNode(' '));
      return;
    }
    if (!part) return;
    const outer = h('span', { class: 'w' });
    if (letters) {
      [...part].forEach((ch) => {
        const inner = h('span', { class: `wi ${cls}` }, ch);
        outer.appendChild(inner);
        out.push(inner);
      });
    } else {
      const inner = h('span', { class: `wi ${cls}` }, part);
      outer.appendChild(inner);
      out.push(inner);
    }
    el.appendChild(outer);
  });
  return out;
}

/** a masked rise of each part, staggered */
export function rise(parts, t, start, { stagger = 0.06, dur = 0.7, dist = 1.1, ease = E.outExpo, out, outDur = 0.35, outStagger = 0.03 } = {}) {
  parts.forEach((el, i) => {
    const k = ease(p(t, start + i * stagger, start + i * stagger + dur));
    let y = (1 - k) * dist * 100;
    let o = k;
    if (out !== undefined) {
      const ko = E.inCubic(p(t, out + i * outStagger, out + i * outStagger + outDur));
      y -= ko * dist * 100;
      o *= 1 - ko;
    }
    const key = `${n(y, 2)}|${n(o, 3)}`;
    if (el.__r !== key) {
      el.style.transform = `translate3d(0, ${n(y, 2)}%, 0)`;
      el.style.opacity = String(n(o, 3));
      el.__r = key;
    }
  });
}
