// What the scenes share: the caption on the top left (eyebrow and headline), chips, a canvas for the wires and
// what runs on them, and the curves those wires follow.

import { E, clamp, h, lerp, p, rise, set, words } from '../engine.js';
import { icon } from '../ui.js';

export function caption(eyebrowText, lines, { top = 92, left = 112, size = 76, accent = 1, eyebrowCls = '', grad = 'grad-ember' } = {}) {
  const el = h('div', { class: 'caption', style: { position: 'absolute', left: `${left}px`, top: `${top}px` } });
  const eb = h('div', { class: `eyebrow ${eyebrowCls}` }, eyebrowText);
  const head = h('div', { class: 'headline', style: { fontSize: `${size}px`, marginTop: '22px' } });
  const parts = [];
  lines.forEach((line, i) => {
    const l = h('span', { class: 'line' });
    head.appendChild(l);
    parts.push(...words(l, line, { cls: i === accent ? grad : '' }));
  });
  el.append(eb, head);
  return {
    el,
    update(t, tin, tout) {
      const ki = E.outExpo(p(t, tin, tin + 0.7));
      const ko = E.inCubic(p(t, tout, tout + 0.45));
      set(eb, { x: (1 - ki) * -30 - ko * 20, o: ki * (1 - ko) });
      rise(parts, t, tin + 0.1, { stagger: 0.05, dur: 0.85, out: tout, outStagger: 0.03 });
    },
  };
}

/** a line of facts, as a chip: an icon, then words */
export function chip(parts, { cls = '', iconName, iconColor = '#ffb27a', left = 0, top = 0 } = {}) {
  const el = h('div', { class: `chip ${cls}`, style: { left: `${left}px`, top: `${top}px` } });
  if (iconName) el.appendChild(h('span', { style: { color: iconColor, display: 'grid' } }, icon(iconName, { size: 28, stroke: 2.2 })));
  parts.forEach((part) => el.appendChild(typeof part === 'string' ? h('span', {}, part) : part));
  return el;
}

/** something coming in at `a` (from `dx`, `dy` away), leaving at `b` */
export function enter(el, t, a, b, { dx = -40, dy = 0, x = 0, y = 0, s0 = 1, dur = 0.7, outDur = 0.4 } = {}) {
  const k = E.outExpo(p(t, a, a + dur));
  const ko = b === undefined ? 0 : E.inCubic(p(t, b, b + outDur));
  set(el, { x: x + (1 - k) * dx, y: y + (1 - k) * dy, o: k * (1 - ko), blur: ko * 6 + (1 - k) * 4, s: s0 + (1 - s0) * k });
  return k * (1 - ko);
}

/** a canvas over the whole frame, cleared and scaled for the frame */
export function sceneCanvas(root) {
  const canvas = h('canvas', { class: 'layer' });
  root.appendChild(canvas);
  const g = canvas.getContext('2d');
  return {
    canvas,
    g,
    begin() {
      const dpr = window.__dpr || 1;
      if (canvas.width !== 1920 * dpr) {
        canvas.width = 1920 * dpr;
        canvas.height = 1080 * dpr;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, 1920, 1080);
      return g;
    },
  };
}

export function glowAt(g, x, y, r, rgb, a) {
  if (a <= 0.003) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(255,255,255,${clamp(a).toFixed(3)})`);
  gr.addColorStop(0.3, `rgba(${rgb},${clamp(0.7 * a).toFixed(3)})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** a horizontal s-curve from a to b: leaves and arrives flat */
export function sCurve(a, b, k, tension = 0.5) {
  const c1 = [lerp(a[0], b[0], tension), a[1]];
  const c2 = [lerp(a[0], b[0], 1 - tension), b[1]];
  const u = 1 - k;
  return [u * u * u * a[0] + 3 * u * u * k * c1[0] + 3 * u * k * k * c2[0] + k * k * k * b[0], u * u * u * a[1] + 3 * u * u * k * c1[1] + 3 * u * k * k * c2[1] + k * k * k * b[1]];
}

/** strokes a curve given as a function of 0…1, up to `upTo` */
export function strokeCurve(g, fn, upTo = 1, steps = 40, from = 0) {
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const k = from + ((upTo - from) * i) / steps;
    const [x, y] = fn(k);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

/** a spark running along a curve, with its trail */
export function spark(g, fn, k, rgb, a, { r = 18, trail = 0.12, width = 3 } = {}) {
  if (k <= 0 || k >= 1 || a <= 0.003) return;
  g.lineCap = 'round';
  const tail = Math.max(0, k - trail);
  g.strokeStyle = `rgba(${rgb},${(0.8 * a).toFixed(3)})`;
  g.lineWidth = width;
  strokeCurve(g, fn, k, 10, tail);
  const [x, y] = fn(k);
  glowAt(g, x, y, r, rgb, a);
}

/** a toggled class, only written when it changes */
export function cls(el, name, on) {
  const key = `__c_${name}`;
  if (el[key] !== on) {
    el.classList.toggle(name, on);
    el[key] = on;
  }
}

export const RGBS = {
  ember: '255,138,61',
  gold: '255,210,154',
  ice: '108,200,255',
  frost: '196,233,255',
  green: '62,226,155',
  amber: '255,201,64',
  red: '255,77,94',
};

/** euros, the french way or the english way: €1,234.56 */
export const eur = (v, digits = 2) => `€${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
