// 58.1 → 64 s. The end card beside the fleet, most of it asleep: the logo, the promise, what it is, where to start,
// who makes it. Then the words leave, the fleet wakes back up, and the frame is exactly the one the hook starts on.

import { E, h, p, rise, set, words } from '../engine.js';
import { icon } from '../ui.js';
import { SCENES, LOOP } from '../timing.js';

export default function end({ L }) {
  const N = L.end;
  const S0 = SCENES.end[0];
  const root = h('div', { class: 'scene' });

  const logo = h('img', { class: 'abs', src: 'assets/img/logo.webp', alt: '', style: { left: '84px', top: '34px', width: '360px', height: '360px', filter: 'drop-shadow(0 20px 50px rgba(0,0,0,0.75)) drop-shadow(0 0 50px rgba(255,110,30,0.22))', transformOrigin: '50% 60%' } });
  window.__track && window.__track(logo);
  root.appendChild(logo);

  const head = h('div', { class: 'headline abs', style: { left: '108px', top: '418px', fontSize: '74px' } });
  const l1 = h('span', { class: 'line' });
  const l2 = h('span', { class: 'line' });
  head.append(l1, l2);
  const w1 = words(l1, N.tagline[0]);
  const w2 = words(l2, N.tagline[1], { cls: 'grad-ice' });
  root.appendChild(head);

  const tags = h('div', { class: 'tags abs', style: { left: '114px', top: '596px' } }, N.tags);
  root.appendChild(tags);

  const arrow = h('span', { class: 'arrow' }, '→');
  const cta = h('div', { class: 'cta', style: { left: '108px', top: '652px' } }, h('span', {}, N.cta), arrow);
  root.appendChild(cta);

  const url = h('div', { class: 'url-line abs', style: { left: '114px', top: '772px' } }, h('span', { style: { color: 'var(--ember-soft)', display: 'grid' } }, icon('file', { size: 24 })), N.url);
  root.appendChild(url);

  const ca = h('img', { src: 'assets/img/cloud-apim-logo.svg', alt: '' });
  window.__track && window.__track(ca);
  const by = h('div', { class: 'byline abs', style: { left: '114px', top: '826px', fontSize: '22px', gap: '12px' } }, h('span', {}, N.by), ca, h('b', {}, 'Cloud APIM'), h('span', { class: 'sep' }), h('span', { style: { color: 'var(--muted)' } }, N.clever));
  ca.style.height = '42px';
  ca.style.borderRadius = '10px';
  root.appendChild(by);

  const OUT = LOOP[0] - S0 - 0.1;

  return {
    id: 'end',
    start: S0,
    end: SCENES.end[1],
    root,
    update(t) {
      const ko = E.inCubic(p(t, OUT, OUT + 0.5));
      // the logo lands, a little heavy
      const kl = p(t, 0.5, 0.95);
      const land = t > 0.95 ? Math.exp(-(t - 0.95) * 7) * Math.cos((t - 0.95) * 24) : 0;
      set(logo, { y: (1 - E.inQuad(kl)) * -160, o: p(t, 0.5, 0.7) * (1 - ko), s: (1 + 0.05 * land) * (1 - 0.06 * ko), blur: ko * 10 });

      rise(w1, t, 0.85, { stagger: 0.05, dur: 0.85, out: OUT, outStagger: 0.02 });
      rise(w2, t, 1.1, { stagger: 0.05, dur: 0.85, out: OUT + 0.05, outStagger: 0.02 });
      const kt = E.outExpo(p(t, 1.4, 2.1));
      const kto = E.inCubic(p(t, OUT + 0.1, OUT + 0.5));
      set(tags, { y: (1 - kt) * 20, o: kt * (1 - kto) });

      const kc = E.outBack(p(t, 1.7, 2.4));
      const kco = E.inCubic(p(t, OUT + 0.15, OUT + 0.55));
      const pulse = 0.5 + 0.5 * Math.sin((t - 2.4) * 3.4);
      set(cta, { s: (0.82 + 0.18 * kc) * (1 + 0.015 * pulse * p(t, 2.4, 2.8)), o: p(t, 1.7, 2.0) * (1 - kco), y: kco * -20 });
      cta.style.boxShadow = `0 30px 80px rgba(240,91,28,${(0.28 + 0.28 * pulse).toFixed(2)}), inset 0 1px 0 rgba(255,255,255,0.35)`;
      set(arrow, { x: 6 * Math.max(0, Math.sin((t - 2.4) * 3.4)) });

      const ku = E.outExpo(p(t, 2.1, 2.8));
      const kuo = E.inCubic(p(t, OUT + 0.2, OUT + 0.6));
      set(url, { y: (1 - ku) * 20, o: ku * (1 - kuo) });
      const kb = E.outExpo(p(t, 2.35, 3.05));
      set(by, { y: (1 - kb) * 20, o: kb * (1 - kuo) });
    },
  };
}
