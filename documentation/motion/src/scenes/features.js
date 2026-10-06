// 52.6 → 58.4 s. Everything the reaper does, as one wall: nine tiles landing in a wave, a light passing over them.

import { E, h, p, rise, set, words } from '../engine.js';
import { icon } from '../ui.js';
import { SCENES } from '../timing.js';

const COLORS = ['#ff8a3d', '#ffb27a', '#6cc8ff', '#3ee29b', '#ffc940', '#c4e9ff'];

export default function features({ L }) {
  const N = L.features;
  const root = h('div', { class: 'scene' });

  const head = h('div', { class: 'headline abs', style: { left: 0, width: '1920px', top: '96px', textAlign: 'center', fontSize: '84px' } });
  const a = h('span', {});
  const b = h('span', {});
  head.append(a, document.createTextNode(' '), b);
  const wa = words(a, N.title[0]);
  const wb = words(b, N.title[1], { cls: 'grad-ember' });
  root.appendChild(head);
  const sub = h('div', { class: 'abs', style: { left: 0, width: '1920px', top: '214px', textAlign: 'center', fontSize: '28px', fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap' } });
  const ws = words(sub, N.sub);
  root.appendChild(sub);

  const COLS = 3;
  const TW = 540;
  const TH = 156;
  const GAP = 24;
  const x0 = (1920 - (COLS * TW + (COLS - 1) * GAP)) / 2;
  const y0 = 310;
  const tiles = N.tiles.map(([ic, t, d], i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const color = COLORS[(col + row * 2) % COLORS.length];
    const ico = h('div', { class: 'ico', style: { color, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}33` } }, icon(ic, { size: 30 }));
    const shine = h('div', { class: 'shine' });
    const el = h('div', { class: 'ftile', style: { left: `${x0 + col * (TW + GAP)}px`, top: `${y0 + row * (TH + GAP)}px`, height: `${TH}px` } }, ico, h('div', {}, h('div', { class: 't' }, t), h('div', { class: 'd' }, d)), shine);
    root.appendChild(el);
    return { el, shine, col, row };
  });

  const OUT = 5.05;

  return {
    id: 'features',
    start: SCENES.features[0],
    end: SCENES.features[1],
    root,
    update(t) {
      rise(wa, t, 0.2, { stagger: 0.07, dur: 0.8, out: OUT });
      rise(wb, t, 0.4, { stagger: 0.07, dur: 0.8, out: OUT + 0.05 });
      rise(ws, t, 0.6, { stagger: 0.025, dur: 0.7, out: OUT + 0.08, outStagger: 0.01 });

      tiles.forEach(({ el, shine, col, row }, i) => {
        const d = (col + row) * 0.08;
        const k = E.outExpo(p(t, 0.45 + d, 1.35 + d));
        const out = E.inCubic(p(t, OUT + d * 0.5, OUT + 0.55 + d * 0.5));
        const float = Math.sin(t * 1.3 + i * 0.9) * 3;
        set(el, { y: (1 - k) * 70 + float * k - out * 30, s: 0.88 + 0.12 * k + out * 0.06, o: k * (1 - out), blur: (1 - k) * 10 + out * 8 });
        const sw = p(t, 2.0 + col * 0.14 + row * 0.06, 2.9 + col * 0.14 + row * 0.06);
        set(shine, { x: sw * 1000, o: sw > 0 && sw < 1 ? 1 : 0 });
      });
    },
  };
}
