// 13.2 → 24.4 s. The reaper at work. shop-staging has had no request for its grace period (one hour, the default):
// the reaper checks it may stop it, asks Clever Cloud to stop its instances, and it is asleep. Then the scythe goes
// through the whole fleet: every idle app falls asleep, the busy ones stay up, and the bill of the fleet drops.

import { E, h, lerp, p, rise, set, text, words } from '../engine.js';
import { icon } from '../ui.js';
import { caption, cls, eur } from './common.js';
import { SCENES, REAP } from '../timing.js';
import { APPS } from '../fleet.js';
import { FOCUS } from '../story.js';

export default function reap({ L, story }) {
  const N = L.reap;
  const S0 = SCENES.reap[0];
  const root = h('div', { class: 'scene' });
  const cap = caption(N.eyebrow, N.title, { size: 84 });
  root.appendChild(cap.el);

  /* the decision on shop-staging */
  const badge = (k) => h('span', { class: `badge ${k}` }, L.status[k]);
  const bUp = badge('up');
  const bGoing = badge('going');
  const bAsleep = badge('asleep');
  const head = h('div', { class: 'head' }, h('span', {}, APPS[FOCUS].name), h('span', { class: 'badges' }, bUp, bGoing, bAsleep));

  const ago = h('b', {}, '47:00');
  const rowLast = h('div', { class: 'row' }, h('span', {}, N.last), h('span', {}, ago, h('span', { style: { marginLeft: '8px' } }, N.ago)));
  const fill = h('i');
  const bar = h('div', { class: 'bar' }, fill);
  const rowGrace = h('div', { class: 'row', style: { marginTop: '8px', fontSize: '16px' } }, h('span', {}, N.grace), h('span', { style: { fontWeight: 700, color: 'var(--ink-2)' } }, N.hour));

  const checks = N.checks.map((c) => {
    const mk = h('span', { class: 'mk' }, icon('check', { size: 18, stroke: 3 }));
    const el = h('div', { class: 'check' }, mk, h('span', {}, c));
    return { el, mk };
  });
  const checkList = h('div', { class: 'checks' }, ...checks.map((c) => c.el));

  const callText = h('span', {}, '');
  const CALL = '…/applications/app_9c41e2…/instances';
  const done = h('div', { class: 'ok' }, icon('power', { size: 18, stroke: 2.4 }), h('span', {}, N.call));
  const call = h('div', { class: 'call' }, h('div', {}, h('b', {}, 'DELETE '), callText), done);

  const costV = h('span', { class: 'v' }, '');
  const costLine = h('div', { class: 'cost-line' }, h('span', {}, N.cost), costV);

  const card = h('div', { class: 'card decide', style: { left: '112px', top: '330px' } }, head, rowLast, bar, rowGrace, checkList, call, costLine);
  root.appendChild(card);

  /* the bill of the whole fleet, live */
  const mvv = h('span', {}, '');
  const mv = h('div', { class: 'v ember' }, mvv, h('small', {}, N.perHour));
  const ma = h('div', { class: 'v ice' }, '0');
  const mu = h('div', { class: 'v' }, '0');
  const meter = h(
    'div',
    { class: 'card meter', style: { left: '112px', top: '900px' } },
    h('div', {}, h('div', { class: 'lab' }, N.fleet), mv),
    h('div', { class: 'sep' }),
    h('div', {}, h('div', { class: 'lab' }, N.asleep), ma),
    h('div', { class: 'sep' }),
    h('div', {}, h('div', { class: 'lab' }, N.up), mu)
  );
  root.appendChild(meter);

  const OUT = 10.55;
  const at = (x) => x - S0;

  return {
    id: 'reap',
    start: S0,
    end: SCENES.reap[1],
    root,
    update(t, T) {
      cap.update(t, 0.25, OUT);

      // the card
      const ki = E.outExpo(p(t, 0.85, 1.6));
      const ko = E.inCubic(p(t, OUT + 0.05, OUT + 0.5));
      set(card, { x: (1 - ki) * -60, o: ki * (1 - ko), blur: (1 - ki) * 6 + ko * 8 });

      // the last request recedes into the past until the grace period is over
      const kt = E.inOutSine(p(t, 1.4, at(REAP.going) - 1.0));
      const secs = Math.round(lerp(47 * 60, 3600, kt));
      text(ago, `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`);
      set(fill, { sx: lerp(47 / 60, 1, kt) });

      checks.forEach((c, i) => {
        const k = E.outBack(p(t, at(REAP.going) - 0.95 + i * 0.28, at(REAP.going) - 0.65 + i * 0.28));
        set(c.mk, { s: k, o: p(t, at(REAP.going) - 0.95 + i * 0.28, at(REAP.going) - 0.85 + i * 0.28) });
        set(c.el, { o: 0.4 + 0.6 * p(t, at(REAP.going) - 0.95 + i * 0.28, at(REAP.going) - 0.8 + i * 0.28) });
      });

      // the call to clever cloud, typed out, then done
      const kc = p(t, at(REAP.going), at(REAP.going) + 0.5);
      text(callText, CALL.slice(0, Math.round(kc * CALL.length)));
      set(call, { o: p(t, at(REAP.going) - 0.1, at(REAP.going) + 0.1) * 0.75 + 0.25 });
      set(done, { o: p(t, at(REAP.down), at(REAP.down) + 0.2), x: (1 - E.outCubic(p(t, at(REAP.down), at(REAP.down) + 0.4))) * -12 });

      // its state, in the words of the console
      const going = p(T, REAP.going, REAP.going + 0.15);
      const down = p(T, REAP.down, REAP.down + 0.15);
      set(bUp, { o: 1 - going });
      set(bGoing, { o: going * (1 - down), s: 1 + 0.15 * Math.exp(-(T - REAP.going) * 8) * (T > REAP.going ? 1 : 0) });
      set(bAsleep, { o: down, s: 1 + 0.15 * Math.exp(-(T - REAP.down) * 8) * (T > REAP.down ? 1 : 0) });
      const cost = T < REAP.down ? APPS[FOCUS].hourly : 0;
      text(costV, `${eur(cost, cost ? 4 : 2)}${N.perHour}`);
      cls(costV, 'zero', cost === 0);

      // the fleet: what it costs an hour right now, how many sleep
      const kmi = E.outExpo(p(t, at(REAP.slash[0]) - 0.2, at(REAP.slash[0]) + 0.5));
      const kmo = E.inCubic(p(t, OUT + 0.1, OUT + 0.55));
      set(meter, { y: (1 - kmi) * 40, o: kmi * (1 - kmo), blur: kmo * 8 });
      let running = 0;
      let asleep = 0;
      APPS.forEach((a) => {
        const st = story.state(a.i, T);
        running += a.hourly * st.heat;
        if (st.heat < 0.5) asleep++;
      });
      text(mvv, eur(running));
      text(ma, String(asleep));
      text(mu, String(APPS.length - asleep));
    },
  };
}
