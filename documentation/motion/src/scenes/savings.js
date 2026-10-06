// 44.1 → 52.9 s. What the sleeps saved, the way the console shows it: today, this month, this year, in all, and what
// the apps asleep right now would cost if they ran. Then the last thirty days, the week ends higher (the fleet
// sleeps all day long), and how a sleep is counted: hours asleep × min instances × the hourly price of its
// flavor, from the public prices of Clever Cloud.

import { E, h, hash, p, set, text } from '../engine.js';
import { icon } from '../ui.js';
import { caption } from './common.js';
import { SCENES } from '../timing.js';
import { APPS, FLEET_HOURLY } from '../fleet.js';
import { BUSY, FOCUS } from '../story.js';

// the fleet after the reaper went through it: the busy apps and shop-staging run, the others sleep
const ASLEEP = APPS.filter((a) => !BUSY.has(a.i) && a.i !== FOCUS);
const NOW = ASLEEP.reduce((s, a) => s + a.hourly, 0);

// thirty days of savings, the last one is today, still running
const DAYS = Array.from({ length: 30 }, (_, i) => {
  const weekend = (i + 2) % 7 >= 5;
  return weekend ? FLEET_HOURLY * (20.6 + 1.6 * hash(i * 3 + 1)) : FLEET_HOURLY * (11.4 + 3.2 * hash(i * 7 + 2));
});
DAYS[29] = 11.86;
const MONTH = DAYS.slice(5).reduce((s, v) => s + v, 0);
const TILES = [11.86, MONTH, 3912.4, 4377.1];

export default function savings({ L }) {
  const N = L.savings;
  const S0 = SCENES.savings[0];
  const root = h('div', { class: 'scene' });
  const cap = caption(N.eyebrow, N.title, { size: 84, eyebrowCls: 'green', grad: 'grad-green' });
  root.appendChild(cap.el);

  // the tiles of the console
  const W = 318;
  const GAP = 22;
  const tiles = [...N.tiles, N.now].map((label, i) => {
    const now = i === 4;
    const v = h('span', {}, '0');
    const el = h('div', { class: `card stile ${now ? 'now' : ''}`, style: { left: `${112 + i * (W + GAP)}px`, top: '352px', width: `${W}px` } }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, h('small', {}, '€'), v, now ? h('small', { style: { marginLeft: '4px', color: 'var(--muted)' } }, '/h') : null), now ? h('div', { class: 'h' }, `${ASLEEP.length} ${N.nowHint}`) : null);
    root.appendChild(el);
    return { el, v, now };
  });

  // the last thirty days
  const CX0 = 112;
  const CX1 = 1808;
  const BASE = 860;
  const MAXH = 250;
  const max = Math.max(...DAYS);
  const bw = (CX1 - CX0) / DAYS.length;
  const chartLabel = h('div', { class: 'col-label abs', style: { left: `${CX0}px`, top: '540px' } }, N.days);
  root.appendChild(chartLabel);
  const axis = h('div', { class: 'abs', style: { left: `${CX0}px`, top: `${BASE}px`, width: `${CX1 - CX0}px`, height: '1px', background: 'rgba(255,255,255,0.14)', transformOrigin: '0 50%' } });
  root.appendChild(axis);
  const bars = DAYS.map((v, i) => {
    const today = i === DAYS.length - 1;
    const hgt = (v / max) * MAXH;
    const el = h('div', {
      class: 'abs',
      style: {
        left: `${CX0 + i * bw + 5}px`,
        top: `${BASE - hgt}px`,
        width: `${bw - 10}px`,
        height: `${hgt}px`,
        borderRadius: '8px 8px 2px 2px',
        transformOrigin: '50% 100%',
        background: today ? 'linear-gradient(180deg, rgba(124,240,192,0.5), rgba(62,226,155,0.12))' : 'linear-gradient(180deg, #7cf0c0 0%, #3ee29b 45%, rgba(62,226,155,0.25) 100%)',
        border: today ? '1.5px dashed rgba(124,240,192,0.8)' : 'none',
        boxShadow: today ? 'none' : '0 0 24px rgba(62,226,155,0.25)',
      },
    });
    root.appendChild(el);
    return el;
  });
  const todayLabel = h('div', { class: 'abs mono', style: { left: `${CX0 + 29 * bw + bw / 2}px`, top: `${BASE - (DAYS[29] / max) * MAXH - 40}px`, transform: 'translateX(-50%)', fontSize: '17px', fontWeight: 700, color: 'var(--green-soft)', whiteSpace: 'nowrap' } }, 'today');
  root.appendChild(todayLabel);

  // how a sleep is counted
  const term = (s) => h('span', { class: 'term2' }, s);
  const formula = h(
    'div',
    { class: 'formula abs', style: { left: `${CX0}px`, top: '902px' } },
    h('span', { style: { color: 'var(--green)', display: 'grid' } }, icon('piggy', { size: 30 })),
    h('span', { class: 'res' }, 'saved'),
    h('span', { class: 'op' }, '='),
    term(N.formula[0]),
    h('span', { class: 'op' }, '×'),
    term(N.formula[1]),
    h('span', { class: 'op' }, '×'),
    term(N.formula[2])
  );
  root.appendChild(formula);
  const note = h('div', { class: 'price-note abs', style: { left: `${CX0 + 2}px`, top: '978px' } }, N.prices, h('span', { class: 'mono', style: { marginLeft: '14px', color: 'var(--muted)' } }, 'XS · par · €0.0222/h'));
  root.appendChild(note);

  const OUT = 8.15;

  return {
    id: 'savings',
    start: S0,
    end: SCENES.savings[1],
    root,
    update(t) {
      cap.update(t, 0.25, OUT);
      const ko = E.inCubic(p(t, OUT, OUT + 0.5));
      tiles.forEach(({ el, v, now }, i) => {
        const k = E.outExpo(p(t, 0.7 + i * 0.09, 1.5 + i * 0.09));
        set(el, { y: (1 - k) * 50, o: k * (1 - ko), blur: (1 - k) * 6 + ko * 8 });
        const kc = E.outExpo(p(t, 0.9 + i * 0.09, 2.6 + i * 0.09));
        const value = now ? NOW * kc : TILES[i] * kc;
        text(v, now ? value.toFixed(2) : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      });
      const ka = E.outExpo(p(t, 1.6, 2.6));
      set(axis, { sx: ka, o: 1 - ko });
      set(chartLabel, { o: ka * (1 - ko) });
      bars.forEach((el, i) => {
        const k = E.outBackSoft(p(t, 1.8 + i * 0.045, 2.6 + i * 0.045));
        set(el, { sy: Math.max(0.001, k), o: p(t, 1.8 + i * 0.045, 1.9 + i * 0.045) * (1 - ko) });
      });
      set(todayLabel, { o: p(t, 3.3, 3.6) * (1 - ko) });
      const kf = E.outExpo(p(t, 3.2, 4.0));
      set(formula, { y: (1 - kf) * 30, o: kf * (1 - ko) });
      const kn = E.outExpo(p(t, 3.6, 4.4));
      set(note, { y: (1 - kn) * 20, o: kn * (1 - ko) });
    },
  };
}
