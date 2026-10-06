// 24.1 → 35.5 s. Someone opens shop-staging: the request reaches the gateway, asks Clever Cloud to start the app,
// and the browser gets the waiting page of the reaper — the words of the real one — which polls the app and
// reloads itself the moment it answers. Meanwhile an API call to the same app is held at the gateway, and goes
// through once the app is up: to the caller, a slow response, not an error.

import { E, h, lerp, p, set, text } from '../engine.js';
import { icon } from '../ui.js';
import { caption, sceneCanvas, spark, RGBS } from './common.js';
import { SCENES, WAKE } from '../timing.js';

export default function wake({ L }) {
  const N = L.wake;
  const S0 = SCENES.wake[0];
  const root = h('div', { class: 'scene' });
  const fx = sceneCanvas(root);
  const cap = caption(N.eyebrow, N.title, { size: 84 });
  root.appendChild(cap.el);

  /* the browser */
  const urlText = h('span', {}, '');
  const loadIcon = h('span', { class: 'load' }, icon('reload', { size: 18, stroke: 2.4 }));
  const progress = h('i', { style: { position: 'absolute', left: 0, bottom: '-1px', height: '3px', width: '100%', background: 'linear-gradient(90deg,#ffb067,#ff8a3d)', transformOrigin: '0 50%' } });
  const chrome = h('div', { class: 'chrome', style: { position: 'relative' } }, h('div', { class: 'lights' }, h('i'), h('i'), h('i')), h('div', { class: 'url' }, h('span', { class: 'lock' }, icon('lock', { size: 16, stroke: 2.4 })), urlText, loadIcon), progress);

  // the waiting page, in the words of the real one
  const spin = h('div', { class: 'spin' });
  const states = N.page.status.map((s) => h('span', {}, s));
  const wpage = h('div', { class: 'wpage' }, h('div', { class: 'box' }, spin, h('h3', {}, N.page.title), h('p', {}, N.page.p1), h('p', {}, N.page.p2), h('div', { class: 'state' }, ...states)));

  // the app, once up
  const A = N.app;
  const apage = h(
    'div',
    { class: 'apage' },
    h('div', { class: 'top' }, h('div', { class: 'brand' }, h('i'), A.brand), ...A.nav.map((n) => h('span', {}, n)), h('span', { class: 'env' }, A.env)),
    h('div', { class: 'hello' }, A.hello),
    h('div', { class: 'grid' }, ...[0, 1, 2].map(() => h('div', { class: 'tile' }, h('b'), h('s'), h('u'))))
  );
  const blank = h('div', { class: 'abs', style: { inset: 0, background: '#16161b' } });
  const view = h('div', { class: 'view' }, blank, wpage, apage);

  // how long it has been waiting, then how long it took
  const tv = h('span', { class: 'mono' }, '0:00');
  const timer = h('div', { class: 'chip', style: { right: '22px', bottom: '22px', padding: '10px 16px', fontSize: '20px', gap: '10px' } }, h('span', { style: { color: 'var(--amber)', display: 'grid' } }, icon('hourglass', { size: 20, stroke: 2.2 })), tv);
  const doneV = h('span', {}, '');
  const done = h('div', { class: 'chip green', style: { right: '22px', bottom: '22px', padding: '10px 18px', fontSize: '20px', gap: '10px', background: 'rgba(10,24,17,0.96)', color: '#eafff5' } }, h('span', { style: { color: 'var(--green)', display: 'grid' } }, icon('check', { size: 20, stroke: 3 })), doneV);
  const pollRing = h('i', { style: { position: 'absolute', left: '15px', top: '50%', width: '12px', height: '12px', margin: '-6px 0 0 -6px', borderRadius: '50%', border: '2px solid var(--amber)' } });
  const poll = h('div', { class: 'chip', style: { right: '22px', top: '78px', padding: '8px 16px 8px 34px', fontSize: '17px', gap: '8px', color: 'var(--muted)' } }, pollRing, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--amber)', position: 'absolute', left: '17px', top: '50%', marginTop: '-4px' } }), h('span', {}, N.poll));
  const browser = h('div', { class: 'card browser', style: { left: '112px', top: '336px', width: '820px', height: '500px' } }, chrome, view, poll, timer, done);
  root.appendChild(browser);

  /* the api call */
  const cmd = h('span', {}, '');
  const CMD = 'curl https://api.shop-staging.acme.com/orders';
  const heldV = h('span', {}, '0 s');
  const held = h('span', { class: 'held', style: { gridArea: '1 / 1' } }, icon('hourglass', { size: 18, stroke: 2.4 }), h('span', {}, N.held), heldV);
  const ok = h('span', { class: 'ok200', style: { gridArea: '1 / 1' } }, icon('check', { size: 18, stroke: 3 }), h('span', {}, '200 OK'));
  const or = h('span', { class: 'dim' }, `# ${N.or}`);
  const term = h('div', { class: 'card term', style: { left: '112px', top: '862px', width: '820px', height: '160px', padding: '18px 24px' } }, h('div', {}, h('span', { class: 'ps' }, '$ '), cmd), h('div', { class: 'line2' }, h('span', { style: { display: 'grid', justifyItems: 'start' } }, held, ok)), h('div', { style: { marginTop: '6px' } }, or));
  root.appendChild(term);

  const OUT = 10.75;
  const TYPE = [24.95, 25.3];
  const SENT = 25.35;
  const SHOWN = WAKE.hit + 0.05;
  const STARTING = 27.5;
  const RELOAD = WAKE.up + 0.5;
  const API = [26.7, 27.15];
  const HELD = 27.55;
  const BOOT_SECS = 41;

  return {
    id: 'wake',
    start: S0,
    end: SCENES.wake[1],
    root,
    update(t, T) {
      cap.update(t, 0.25, OUT);

      // the browser comes in, someone types the address
      const kb = E.outExpo(p(t, 0.6, 1.4));
      const ko = E.inCubic(p(t, OUT + 0.05, OUT + 0.5));
      set(browser, { y: (1 - kb) * 50, s: 0.96 + 0.04 * kb, o: kb * (1 - ko), blur: (1 - kb) * 6 + ko * 8 });
      text(urlText, N.url.slice(0, Math.round(p(T, TYPE[0], TYPE[1]) * N.url.length)));
      const loading = (T > SENT && T < SHOWN) || (T > RELOAD && T < RELOAD + 0.3);
      set(loadIcon, { r: loading ? (T * 720) % 360 : 0, o: loading ? 1 : 0.35 });
      const lp = T > RELOAD ? p(T, RELOAD, RELOAD + 0.3) : p(T, SENT, SHOWN);
      set(progress, { sx: E.outCubic(lp), o: loading ? 1 : 0 });

      // the waiting page, its state following the app, then the app itself
      set(wpage, { o: p(T, SHOWN, SHOWN + 0.2) * (1 - p(T, RELOAD + 0.15, RELOAD + 0.3)) });
      set(spin, { r: ((T - SHOWN) * 300) % 360 });
      const si = T < STARTING ? 0 : T < WAKE.up ? 1 : 2;
      states.forEach((el, i) => set(el, { o: i === si ? 1 : 0, y: i === si ? 0 : 6 }));
      set(apage, { o: p(T, RELOAD + 0.15, RELOAD + 0.3) });

      // the poll, every five seconds of the real world
      const pk = T > SHOWN + 0.3 && T < RELOAD ? ((T - SHOWN) / 0.62) % 1 : 0;
      set(poll, { o: p(T, SHOWN + 0.3, SHOWN + 0.5) * (1 - p(T, RELOAD, RELOAD + 0.15)) });
      set(pollRing, { s: 1 + pk * 1.8, o: (1 - pk) * (pk > 0 ? 1 : 0) });

      const secs = Math.round(lerp(0, BOOT_SECS, p(T, WAKE.hit, RELOAD)));
      text(tv, `0:${String(secs).padStart(2, '0')}`);
      set(timer, { o: p(T, SHOWN + 0.2, SHOWN + 0.4) * (1 - p(T, RELOAD, RELOAD + 0.15)) });
      text(doneV, `${N.woke} ${BOOT_SECS} s`);
      const kd = E.outBack(p(T, RELOAD + 0.35, RELOAD + 0.75));
      set(done, { o: p(T, RELOAD + 0.35, RELOAD + 0.5), s: 0.8 + 0.2 * kd });

      // the api call: typed, sent, held at the gateway, answered
      const kt = E.outExpo(p(T, API[0] - 0.4, API[0] + 0.3));
      set(term, { y: (1 - kt) * 40, o: kt * (1 - ko), blur: ko * 8 });
      text(cmd, CMD.slice(0, Math.round(p(T, API[0], API[1]) * CMD.length)));
      const answered = T > WAKE.up + 0.85;
      set(held, { o: p(T, HELD, HELD + 0.15) * (answered ? 0 : 1) });
      text(heldV, `${Math.round(lerp(0, BOOT_SECS - 3, p(T, HELD, WAKE.up + 0.85)))} s`);
      const kok = E.outBack(p(T, WAKE.up + 0.85, WAKE.up + 1.2));
      set(ok, { o: answered ? 1 : 0, s: 0.85 + 0.15 * kok });
      set(or, { o: p(T, WAKE.up + 1.3, WAKE.up + 1.7) });

      // what runs between the browser, the terminal and the gateway
      const g = fx.begin();
      const gwx = 1090 - 118;
      const gwy = 560;
      const line = (a, b) => (k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k) - Math.sin(Math.PI * k) * 60];
      if (T > SENT && T < SENT + 0.4) spark(g, line([930, 380], [gwx, gwy]), E.inOutSine(p(T, SENT, SENT + 0.35)), RGBS.frost, 1, { r: 20 });
      if (T > API[1] && T < API[1] + 0.45) spark(g, line([930, 920], [gwx, gwy]), E.inOutSine(p(T, API[1], API[1] + 0.4)), RGBS.frost, 1, { r: 20 });
      // held: a ring of amber around the gateway until the app is up
      if (T > HELD && T < WAKE.up + 0.85) {
        const k = ((T - HELD) / 0.9) % 1;
        g.strokeStyle = `rgba(${RGBS.amber},${(0.7 * (1 - k)).toFixed(3)})`;
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(1090, 560, 130 + 60 * k, 44 + 24 * k, 0, 0, Math.PI * 2);
        g.stroke();
      }
      // the answers, back to the browser and the terminal
      if (T > WAKE.up + 0.55 && T < WAKE.up + 1.0) spark(g, line([gwx, gwy], [930, 400]), E.inOutSine(p(T, WAKE.up + 0.55, WAKE.up + 0.95)), RGBS.green, 1, { r: 20 });
      if (T > WAKE.up + 0.75 && T < WAKE.up + 1.2) spark(g, line([gwx, gwy], [930, 930]), E.inOutSine(p(T, WAKE.up + 0.75, WAKE.up + 1.15)), RGBS.green, 1, { r: 20 });
    },
  };
}
