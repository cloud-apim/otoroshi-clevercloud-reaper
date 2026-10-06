// What happens to every app of the fleet over the film, as a pure function of time: whether it runs (`heat`), is
// between two states (`amber`), boots (`boot`), flashes (`flash`), and the requests it gets (`hits`).
//
// - the hook replays a week without the reaper: every app runs all week long, the requests only come during
//   office hours;
// - the reaper puts shop-staging to sleep first, then its scythe goes through every idle app, the busy ones stay
//   up;
// - a request wakes shop-staging up again;
// - at the very end the whole fleet wakes back up: the hook starts over.

import { E, clamp, hash, p } from './engine.js';
import { APPS } from './fleet.js';
import { DURATION, LAPSE, LOOP, REAP, WAKE, SCENES } from './timing.js';

export const FOCUS = 0;
// the apps that get traffic after the reap: they stay up
export const BUSY = new Set([3, 8, 13, 16, 20, 9]);

/* ---------- the week of the hook ---------- */

const HOURS = 168;
// how busy an hour of the week is, 0…1: the office hours of the week days, a little in the evening, almost nothing
// on the week end
export function activity(hour) {
  const day = Math.floor(hour / 24) % 7;
  const hod = hour % 24;
  const ramp = (x, a, b) => clamp((x - a) / (b - a));
  if (day >= 5) return 0.03 + 0.05 * ramp(hod, 10, 11) * (1 - ramp(hod, 17, 18));
  const office = ramp(hod, 8, 9.5) * (1 - ramp(hod, 18, 19.5));
  const lunch = 1 - 0.55 * ramp(hod, 12.2, 12.6) * (1 - ramp(hod, 13.6, 14));
  return 0.02 + office * lunch;
}

// how much each app is used, when people work
const USE = APPS.map((a) => 0.25 + 0.75 * hash(a.i * 41 + 7));

/** the week, hour by hour: which apps got a request, and what the idle ones cost */
function week() {
  const idleCost = [0];
  const idleHours = [0];
  for (let hr = 0; hr < HOURS; hr++) {
    let cost = 0;
    let idle = 0;
    for (const a of APPS) {
      const used = hash(hr * 97 + a.i * 13 + 5) < activity(hr + 0.5) * USE[a.i] * 0.8;
      if (!used) {
        cost += a.hourly;
        idle++;
      }
    }
    idleCost.push(idleCost[idleCost.length - 1] + cost);
    idleHours.push(idleHours[idleHours.length - 1] + idle);
  }
  return { idleCost, idleHours, hours: HOURS, apps: APPS.length };
}
export const WEEK = week();

/** the hour of the week the hook shows at time t */
export const weekHour = (t) => E.inOutQuad(p(t, LAPSE[0], LAPSE[1])) * HOURS;

/* ---------- the requests ---------- */

function pick(weights, u) {
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / total;
    if (u <= acc) return i;
  }
  return weights.length - 1;
}

function schedule() {
  const hits = [];
  let n = 0;
  const dt = 1 / 120;
  let acc = 0;
  // the hook: the requests of the week, office hours only
  for (let t = LAPSE[0]; t < LAPSE[1]; t += dt) {
    acc += (0.3 + 40 * activity(weekHour(t))) * dt;
    while (acc >= 1) {
      acc -= 1;
      hits.push({ i: pick(USE, hash(n * 17 + 3)), t: t + 0.22, tr: 0.22 });
      n++;
    }
  }
  // the busy apps, all along the reaper's part
  const busy = [...BUSY];
  const quiet = [[SCENES.reap[0] + 0.6, SCENES.wake[1] - 0.6], [SCENES.end[0] + 0.6, LOOP[0]]];
  for (const [a, b] of quiet) {
    acc = 0;
    for (let t = a; t < b; t += dt) {
      acc += 2.6 * dt;
      while (acc >= 1) {
        acc -= 1;
        hits.push({ i: busy[Math.floor(hash(n * 29 + 7) * busy.length)], t, a: 0.8 });
        n++;
      }
    }
  }
  // the request that wakes shop-staging up, then its page reloading and the api call held until it is up
  hits.push({ i: FOCUS, t: WAKE.hit, a: 1.4 });
  hits.push({ i: FOCUS, t: WAKE.up + 0.55, a: 1.2 });
  hits.push({ i: FOCUS, t: WAKE.up + 0.75, a: 1.2 });
  return hits.sort((x, y) => x.t - y.t);
}

/* ---------- the states ---------- */

export function makeStory({ text, slashAt }) {
  const hits = schedule();
  // the fleet wakes back up from the back to the front, as the loop closes
  const loopAt = APPS.map((a) => LOOP[0] + (LOOP[1] - LOOP[0]) * ((0.9 * (3 - a.row + (5 - a.col) * 0.5)) / 5.5 + 0.1 * hash(a.i * 3)));

  // a request landing makes its app flash, a little
  const byApp = APPS.map(() => []);
  hits.forEach((hh) => byApp[hh.i].push(hh.t));
  const hitFlash = (i, t) => {
    let v = 0;
    for (const at of byApp[i]) {
      const d = t - at;
      if (d > 0 && d < 1) v += Math.exp(-d * 7) * 0.45;
    }
    return v;
  };

  function state(i, t) {
    let heat = 1;
    let amber = 0;
    let boot = 0;
    let flash = hitFlash(i, t);
    const loop = loopAt[i];

    const asleepFrom = i === FOCUS ? REAP.down : BUSY.has(i) ? Infinity : slashAt[i];
    const wakesAt = i === FOCUS ? WAKE.up : loop;

    if (i === FOCUS && t >= REAP.going && t < REAP.down) {
      // going to sleep: the reaper asked clever cloud to stop it
      const k = E.outCubic(p(t, REAP.going, REAP.going + 0.35));
      amber = k;
      heat = 1 - k;
    } else if (t >= asleepFrom && t < wakesAt) {
      heat = i === FOCUS ? 0 : 1 - E.outCubic(p(t, asleepFrom, asleepFrom + 0.4));
      if (i === FOCUS) amber = 1 - E.outCubic(p(t, REAP.down, REAP.down + 0.5));
      if (t - asleepFrom < 1.2) flash += Math.exp(-(t - asleepFrom) * 6) * (i === FOCUS ? 0.6 : 1);
      // waking up: asked to clever cloud, then booting
      const b0 = i === FOCUS ? WAKE.boot[0] : wakesAt - 0.75;
      if (t >= (i === FOCUS ? WAKE.hit + 0.2 : b0)) {
        amber = Math.max(amber, E.outCubic(p(t, i === FOCUS ? WAKE.hit + 0.2 : b0, (i === FOCUS ? WAKE.hit + 0.2 : b0) + 0.3)));
        heat = 0;
        boot = p(t, b0, wakesAt);
      }
    } else if (t >= wakesAt && asleepFrom < wakesAt && t - wakesAt < 1.2) {
      flash += Math.exp(-(t - wakesAt) * 5);
      amber = 1 - E.outCubic(p(t, wakesAt, wakesAt + 0.5));
    }
    return { heat, amber, boot, flash: clamp(flash, 0, 1.4) };
  }

  return { state, hits, text, loopAt };
}
