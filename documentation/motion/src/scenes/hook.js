// 0 → 8.3 s. The hook: a week of a staging fleet replayed as a time-lapse, without the reaper. The requests only come
// during office hours, the apps run all week long and burn money all night: the counter runs on what the fleet
// was billed while nobody used it.

import { E, h, lerp, p, rise, set, text, words } from '../engine.js';
import { icon } from '../ui.js';
import { SCENES, LAPSE } from '../timing.js';
import { WEEK, weekHour, activity } from '../story.js';

export default function hook({ L }) {
  const N = L.hook;
  const root = h('div', { class: 'scene' });

  // the time-lapse clock
  const sun = icon('sun', { size: 26, stroke: 2.2 });
  const moon = icon('moon', { size: 24, stroke: 2.2 });
  sun.classList.add('sun');
  moon.classList.add('moon');
  const sky = h('span', { class: 'sky' }, sun, moon);
  const now = h('span', { class: 'time' }, 'Mon 00:00');
  const bar = h('i', { style: { position: 'absolute', left: 0, bottom: 0, height: '3px', width: '100%', background: 'linear-gradient(90deg,#ffb067,#ff8a3d,#f05b1c)', transformOrigin: '0 50%', borderRadius: '2px' } });
  const clock = h('div', { class: 'clock abs', style: { left: '112px', top: '112px', overflow: 'hidden' } }, sky, now, h('span', { class: 'sep' }, '·'), h('span', {}, N.clock), bar);
  root.appendChild(clock);

  // the promise
  const head = h('div', { class: 'headline abs', style: { left: '106px', top: '204px', fontSize: '94px' } });
  const l1 = h('span', { class: 'line' });
  const l2 = h('span', { class: 'line' });
  head.append(l1, l2);
  const w1 = words(l1, N.title[0]);
  const w2 = words(l2, N.title[1], { cls: 'grad-ember' });
  root.appendChild(head);

  // what the idle apps were billed
  const cur = h('span', { class: 'cur' }, '€');
  const num = h('span', {}, '0.00');
  const count = h('div', { class: 'counter abs', style: { left: '104px', top: '520px', transformOrigin: '0 70%' } }, cur, num);
  const countLabel = h('div', { class: 'counter-label abs', style: { left: '114px', top: '660px' } });
  const wl = words(countLabel, N.counter);
  root.append(count, countLabel);

  const mk = (cls, label) => {
    const v = h('div', { class: 'v' }, '0');
    const el = h('div', { class: `stat ${cls}` }, v, h('div', { class: 'l' }, label));
    return { el, v };
  };
  const apps = mk('steel', N.apps);
  const billed = mk('ember', N.billed);
  const idle = mk('ice', N.idle);
  const stats = h('div', { class: 'stats abs', style: { left: '116px', top: '790px' } }, apps.el, billed.el, idle.el);
  root.appendChild(stats);

  const at = (series, x) => {
    const i = Math.min(series.length - 2, Math.floor(x));
    return lerp(series[i], series[i + 1], x - i);
  };
  const OUT = 7.0;

  // the sun is up from 7 to 20, and the night only falls while the week is replayed
  const daylightAt = (t) => {
    const hod = weekHour(t) % 24;
    return t < LAPSE[0] ? 1 : Math.min(1, Math.max(0, Math.min((hod - 6.5) / 1.2, (20.5 - hod) / 1.2)));
  };
  const nightAt = (t) => (1 - daylightAt(t)) * E.inOutCubic(p(t, LAPSE[0] - 0.4, LAPSE[0])) * (1 - E.inOutCubic(p(t, LAPSE[1], LAPSE[1] + 0.5)));

  return {
    id: 'hook',
    start: SCENES.hook[0],
    end: SCENES.hook[1],
    root,
    /** night falls on the fleet when the replayed week does: the requests stop, the money does not */
    fleet(t, s) {
      s.night = nightAt(t);
    },
    update(t) {
      const hour = Math.min(weekHour(t), 167.99);
      const day = Math.min(6, Math.floor(hour / 24));
      const hod = hour % 24;
      const daylight = daylightAt(t);
      set(sun, { o: daylight, r: hour * 2, s: 0.6 + 0.4 * daylight });
      set(moon, { o: 1 - daylight, s: 0.6 + 0.4 * (1 - daylight) });

      // clock
      const ci = E.outExpo(p(t, 0.1, 0.9));
      const co = E.inCubic(p(t, OUT, OUT + 0.5));
      set(clock, { x: (1 - ci) * -40, y: -co * 40, o: ci * (1 - co), blur: co * 6 });
      const hh = Math.floor(hod);
      const mm = Math.floor((hod - hh) * 60);
      text(now, `${N.days[day]} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
      set(bar, { sx: hour / 168, o: 0.9 });

      // headline
      rise(w1, t, 0.25, { stagger: 0.07, dur: 0.9, out: OUT, outStagger: 0.04 });
      rise(w2, t, 0.6, { stagger: 0.07, dur: 0.9, out: OUT + 0.05, outStagger: 0.04 });

      // counter: it keeps climbing at night
      const ki = E.outExpo(p(t, 1.0, 1.8));
      const ko = E.inCubic(p(t, OUT + 0.1, OUT + 0.6));
      const busy = activity(hour);
      const pulse = t > LAPSE[0] && t < LAPSE[1] ? 1 + 0.01 * Math.sin(t * 22) * (1 - busy) : 1;
      set(count, { y: (1 - ki) * 90 - ko * 70, o: ki * (1 - ko), s: (0.92 + 0.08 * ki) * pulse, blur: (1 - ki) * 10 + ko * 8 });
      text(num, at(WEEK.idleCost, hour).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      rise(wl, t, 1.3, { stagger: 0.05, dur: 0.8, out: OUT + 0.12 });

      // stats
      const si = E.outExpo(p(t, 1.7, 2.6));
      const so = E.inCubic(p(t, OUT + 0.18, OUT + 0.7));
      set(stats, { y: (1 - si) * 50 - so * 50, o: si * (1 - so), blur: so * 6 });
      text(apps.v, String(WEEK.apps));
      text(billed.v, String(Math.floor(hour)));
      const share = hour > 0.5 ? at(WEEK.idleHours, hour) / (hour * WEEK.apps) : 1;
      text(idle.v, `${Math.round(share * 100)}%`);
    },
  };
}
