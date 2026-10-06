// 35.2 → 44.4 s. A week of three apps under the reaper, drawn as a playhead sweeps it: up during their must-be-up
// ranges (started when the range begins, not by the first person who needs them), up for the grace period after
// a request, asleep the rest of the time. The uptime checks hit them every minute all week long and change
// nothing: a monitoring filter answers them and does not count them as traffic.
//
// The states are simulated minute by minute with the reaper's rules: a range starts the app, a request starts it
// or keeps it up, and an app with no request for its grace period (one hour) and outside its ranges goes to sleep.

import { E, h, p, set, text } from '../engine.js';
import { icon } from '../ui.js';
import { caption, sceneCanvas } from './common.js';
import { SCENES } from '../timing.js';

const HOURS = 168;
const GRACE = 1;
const BOOT = 0.35; // drawn longer than the minute or two it takes, so it shows

const at = (day, hh, mm = 0) => day * 24 + hh + mm / 60;
const weekdays = (a, b) => [0, 1, 2, 3, 4].map((d) => [d * 24 + a, d * 24 + b]);

const LANES = [
  {
    ranges: weekdays(8.5, 19),
    requests: [
      ...[0, 1, 2, 3, 4].flatMap((d) => [9.1, 9.6, 10.4, 11.2, 11.8, 14.2, 14.9, 15.6, 16.3, 17.1, 17.9, 18.6].map((x) => d * 24 + x + ((d * 7 + x * 3) % 1) * 0.2)),
      at(5, 15, 10),
      at(5, 15, 32),
    ],
  },
  { ranges: [[at(2, 13, 30), at(2, 15)]], requests: [at(0, 10, 12), at(2, 14, 2), at(2, 14, 20), at(2, 14, 41), at(4, 16, 30)] },
  { ranges: [], requests: [at(1, 11, 5), at(1, 11, 24), at(3, 15, 40), at(4, 10), at(4, 10, 15), at(4, 10, 52)] },
];

/** the states of a lane over the week: [from, to, 'up' | 'asleep' | 'waking'] */
function simulate({ ranges, requests }) {
  const step = 1 / 60;
  const inRange = (x) => ranges.some(([a, b]) => x >= a && x < b);
  const segs = [];
  let state = 'asleep';
  let last = -Infinity;
  let bootUntil = 0;
  let from = 0;
  const push = (to, next) => {
    if (next === state) return;
    segs.push([from, to, state]);
    from = to;
    state = next;
  };
  const reqs = [...requests].sort((a, b) => a - b);
  let ri = 0;
  for (let x = 0; x < HOURS; x += step) {
    let hit = false;
    while (ri < reqs.length && reqs[ri] <= x) {
      hit = true;
      last = reqs[ri];
      ri++;
    }
    if (state === 'asleep' && (hit || inRange(x))) {
      bootUntil = x + BOOT;
      push(x, 'waking');
    } else if (state === 'waking' && x >= bootUntil) {
      push(x, 'up');
    } else if (state === 'up' && !inRange(x) && x - Math.max(last, bootUntil) >= GRACE) {
      push(x, 'asleep');
    }
  }
  segs.push([from, HOURS, state]);
  return segs;
}

export default function awake({ L }) {
  const N = L.awake;
  const S0 = SCENES.awake[0];
  const root = h('div', { class: 'scene' });
  const fx = sceneCanvas(root);
  const cap = caption(N.eyebrow, N.title, { size: 84, eyebrowCls: 'ice' });
  root.appendChild(cap.el);

  const X0 = 600;
  const X1 = 1640;
  const xOf = (hr) => X0 + ((X1 - X0) * hr) / HOURS;
  const LANE_Y = [470, 630, 790];
  const BAR = 44;

  // the days
  const days = h('div', { class: 'week', style: { left: 0, top: '392px', width: '1920px' } });
  N.days.forEach((d, i) => days.appendChild(h('div', { class: `day ${i >= 5 ? 'we' : ''}`, style: { left: `${xOf(i * 24 + 12) - 22}px` } }, d)));
  root.appendChild(days);

  const lanes = LANES.map((lane, i) => {
    const segs = simulate(lane);
    const asleep = (upTo) => segs.reduce((s, [a, b, st]) => s + (st === 'asleep' ? Math.max(0, Math.min(b, upTo) - a) : 0), 0);
    const name = h('div', { class: 'lane-name', style: { left: '112px', top: `${LANE_Y[i] - 8}px` } }, N.lanes[i].name);
    const note = h('div', { class: 'lane-note', style: { left: '112px', top: `${LANE_Y[i] + 26}px` } }, N.lanes[i].note);
    const pv = h('b', {}, '0%');
    const pct = h('div', { class: 'lane-pct', style: { left: '1676px', top: `${LANE_Y[i] - 10}px`, width: '132px' } }, pv, h('span', {}, N.of));
    root.append(name, note, pct);
    return { segs, asleep, name, note, pct, pv, lane };
  });

  // the legend, and the uptime checks
  const sw = (bg, border = 'none') => h('i', { style: { background: bg, border } });
  const legend = h(
    'div',
    { class: 'legend abs', style: { left: `${X0}px`, top: '900px' } },
    h('span', {}, sw('linear-gradient(90deg,#ffb067,#f05b1c)'), N.up),
    h('span', {}, sw('rgba(108,200,255,0.22)', '1px solid rgba(108,200,255,0.7)'), N.asleep),
    h('span', {}, sw('repeating-linear-gradient(135deg, rgba(255,201,64,0.35) 0 3px, transparent 3px 7px)', '1.5px dashed rgba(255,201,64,0.8)'), N.range),
    h('span', {}, h('i', { style: { width: '3px', height: '18px', background: '#fff', borderRadius: '2px' } }), N.request)
  );
  root.appendChild(legend);
  const uptime = h('div', { class: 'chip ice', style: { left: `${X0}px`, top: '958px', fontSize: '21px', padding: '12px 20px' } }, h('span', { style: { color: 'var(--frost)', display: 'grid' } }, icon('activity', { size: 24 })), h('span', {}, N.uptime));
  root.appendChild(uptime);

  // the playhead
  const phLabel = h('div', { class: 'abs mono', style: { top: '430px', fontSize: '16px', fontWeight: 700, color: 'var(--ink)', padding: '3px 9px', borderRadius: '7px', background: 'rgba(255,255,255,0.1)', transform: 'translateX(-50%)', whiteSpace: 'nowrap' } }, '');
  root.appendChild(phLabel);

  const SWEEP = [1.1, 7.6];
  const OUT = 8.6;

  const roundRect = (g, x, y, w, hh, r) => {
    r = Math.min(r, w / 2, hh / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hh, r);
    g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };

  return {
    id: 'awake',
    start: S0,
    end: SCENES.awake[1],
    root,
    update(t) {
      cap.update(t, 0.25, OUT);
      const ki = E.outExpo(p(t, 0.6, 1.4));
      const ko = E.inCubic(p(t, OUT, OUT + 0.5));
      const A = ki * (1 - ko);
      set(days, { o: A, y: (1 - ki) * 20 });
      lanes.forEach((l, i) => {
        const k = E.outExpo(p(t, 0.7 + i * 0.12, 1.5 + i * 0.12));
        set(l.name, { o: k * (1 - ko), x: (1 - k) * -30 });
        set(l.note, { o: k * (1 - ko), x: (1 - k) * -30 });
        set(l.pct, { o: k * (1 - ko) });
      });
      const kl = E.outExpo(p(t, 1.3, 2.1));
      set(legend, { o: kl * (1 - ko), y: (1 - kl) * 20 });
      const ku = E.outExpo(p(t, 2.2, 3.0));
      set(uptime, { o: ku * (1 - ko), y: (1 - ku) * 20 });

      const head = E.inOutSine(p(t, SWEEP[0], SWEEP[1])) * HOURS;
      const hx = xOf(head);
      lanes.forEach((l) => text(l.pv, `${Math.round((l.asleep(head) / HOURS) * 100)}%`));
      const d = Math.min(6, Math.floor(head / 24));
      const hh = Math.floor(head % 24);
      const mm = Math.floor(((head % 24) - hh) * 60);
      text(phLabel, `${N.days[d]} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
      set(phLabel, { x: hx, o: A * p(t, SWEEP[0], SWEEP[0] + 0.2) * (1 - p(t, SWEEP[1], SWEEP[1] + 0.3)) });

      const g = fx.begin();
      if (A <= 0.001) return;
      g.globalAlpha = A;

      // the day grid, the week end a little colder
      for (let dd = 0; dd <= 7; dd++) {
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(xOf(dd * 24) - 0.5, 440, 1, 440);
      }
      g.fillStyle = 'rgba(108,200,255,0.035)';
      g.fillRect(xOf(120), 440, xOf(168) - xOf(120), 440);

      lanes.forEach((l, i) => {
        const y = LANE_Y[i];
        // the track
        g.fillStyle = 'rgba(255,255,255,0.04)';
        roundRect(g, X0, y - BAR / 2, X1 - X0, BAR, 8);
        g.fill();
        // the must-be-up ranges, always shown: they are the settings of the route
        for (const [a, b] of l.lane.ranges) {
          const x = xOf(a);
          const w = xOf(b) - x;
          g.save();
          roundRect(g, x, y - BAR / 2 - 7, w, BAR + 14, 9);
          g.clip();
          g.strokeStyle = 'rgba(255,201,64,0.28)';
          g.lineWidth = 3;
          for (let s = -BAR; s < w + BAR; s += 9) {
            g.beginPath();
            g.moveTo(x + s, y + BAR / 2 + 7);
            g.lineTo(x + s + BAR + 14, y - BAR / 2 - 7);
            g.stroke();
          }
          g.restore();
          g.setLineDash([5, 4]);
          g.strokeStyle = 'rgba(255,201,64,0.75)';
          g.lineWidth = 1.5;
          roundRect(g, x, y - BAR / 2 - 7, w, BAR + 14, 9);
          g.stroke();
          g.setLineDash([]);
        }
        // the states, up to the playhead
        g.save();
        g.beginPath();
        g.rect(X0 - 2, y - BAR, hx - X0 + 2, BAR * 2);
        g.clip();
        for (const [a, b, st] of l.segs) {
          const x = xOf(a);
          const w = Math.max(1.5, xOf(b) - x);
          if (st === 'up') {
            const gr = g.createLinearGradient(0, y - BAR / 2, 0, y + BAR / 2);
            gr.addColorStop(0, '#ffb067');
            gr.addColorStop(1, '#e8541a');
            g.fillStyle = gr;
            g.shadowColor = 'rgba(255,120,40,0.7)';
            g.shadowBlur = 16;
            roundRect(g, x, y - BAR / 2 + 4, w, BAR - 8, 5);
            g.fill();
            g.shadowBlur = 0;
          } else if (st === 'waking') {
            g.fillStyle = 'rgba(255,201,64,0.95)';
            roundRect(g, x, y - BAR / 2 + 4, w, BAR - 8, 3);
            g.fill();
          } else {
            g.fillStyle = 'rgba(108,200,255,0.16)';
            g.strokeStyle = 'rgba(108,200,255,0.55)';
            g.lineWidth = 1;
            roundRect(g, x + 1, y - BAR / 2 + 8, w - 2, BAR - 16, 4);
            g.fill();
            g.stroke();
          }
        }
        // the requests
        for (const r of l.lane.requests) {
          const x = xOf(r);
          g.fillStyle = '#ffffff';
          g.fillRect(x - 1.25, y - BAR / 2 - 14, 2.5, 12);
        }
        // the uptime checks: a dotted line under every lane, all week, that changes nothing
        g.fillStyle = 'rgba(196,233,255,0.5)';
        for (let x = X0; x < hx; x += 6) g.fillRect(x, y + BAR / 2 + 10, 2, 2);
        g.restore();
      });

      // the playhead
      if (t > SWEEP[0] && t < SWEEP[1] + 0.3) {
        const o = 1 - p(t, SWEEP[1], SWEEP[1] + 0.3);
        g.globalAlpha = A * o;
        const gr = g.createLinearGradient(hx, 450, hx, 860);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.15, 'rgba(255,255,255,0.9)');
        gr.addColorStop(1, 'rgba(255,255,255,0.1)');
        g.fillStyle = gr;
        g.fillRect(hx - 1, 450, 2, 410);
      }
      g.globalAlpha = 1;
    },
  };
}
