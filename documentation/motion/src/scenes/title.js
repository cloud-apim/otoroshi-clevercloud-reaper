// 7.9 → 13.5 s. The name: the artwork of the project in the dark — the reaper walking through the server racks,
// the Otoroshi on its torii — then the logo slams in with a burst of embers, what it does, and who makes it.

import { E, clamp, h, hash, lerp, p, rise, set, words } from '../engine.js';
import { sceneCanvas, glowAt, RGBS } from './common.js';
import { SCENES } from '../timing.js';

export default function title({ L }) {
  const N = L.title;
  const root = h('div', { class: 'scene' });

  // the artwork, darkened, slowly pushed in
  const art = h('div', { class: 'abs', style: { left: '-390px', top: 0, width: '2700px', height: '1080px', backgroundImage: 'url(assets/img/illustration.webp)', backgroundSize: 'cover', backgroundPosition: '50% 50%', transformOrigin: '62% 45%' } });
  const artShade = h('div', { class: 'abs', style: { inset: 0, background: 'radial-gradient(ellipse 60% 62% at 50% 44%, rgba(6,6,7,0.45) 0%, rgba(6,6,7,0.7) 55%, rgba(6,6,7,0.96) 100%), linear-gradient(180deg, rgba(6,6,7,0.4), rgba(6,6,7,0.2) 40%, rgba(6,6,7,0.95) 100%)' } });
  const artWrap = h('div', { class: 'abs', style: { inset: 0, overflow: 'hidden' } }, art, artShade);
  root.appendChild(artWrap);
  const img = new Image();
  img.src = 'assets/img/illustration.webp';
  window.__track && window.__track(img);

  // embers thrown out when the logo lands, and the shockwave
  const fx = sceneCanvas(root);

  const LOGO = 520;
  const logo = h('img', { class: 'abs', src: 'assets/img/logo.webp', alt: '', style: { left: `${960 - LOGO / 2}px`, top: '70px', width: `${LOGO}px`, height: `${LOGO}px`, filter: 'drop-shadow(0 24px 60px rgba(0,0,0,0.8)) drop-shadow(0 0 70px rgba(255,110,30,0.28))' } });
  window.__track && window.__track(logo);
  // a light running across the metal, masked by the logo itself
  const shine = h('div', { class: 'abs', style: { left: `${960 - LOGO / 2}px`, top: '70px', width: `${LOGO}px`, height: `${LOGO}px`, background: 'linear-gradient(105deg, transparent 38%, rgba(255,236,214,0.0) 42%, rgba(255,236,214,0.75) 50%, rgba(255,236,214,0) 58%, transparent 62%)', backgroundSize: '300% 100%', WebkitMaskImage: 'url(assets/img/logo.webp)', maskImage: 'url(assets/img/logo.webp)', WebkitMaskSize: 'contain', maskSize: 'contain', mixBlendMode: 'screen' } });
  root.append(logo, shine);

  const sub = h('div', { class: 'subtitle abs', style: { left: 0, width: '1920px', top: '628px', textAlign: 'center', fontSize: '52px' } });
  const s1 = h('span', { class: 'line' });
  const s2 = h('span', { class: 'line' });
  sub.append(s1, s2);
  const w1 = words(s1, N.sub[0]);
  const w2 = words(s2, N.sub[1], { cls: 'grad-ember' });
  root.appendChild(sub);

  const oto = h('img', { class: 'oto', src: 'assets/img/otoroshi-logo.svg', alt: '' });
  const ca = h('img', { src: 'assets/img/cloud-apim-logo.svg', alt: '' });
  window.__track && window.__track(oto);
  window.__track && window.__track(ca);
  const by = h('div', { class: 'byline' }, oto, h('span', {}, N.ext), h('span', { class: 'sep' }), h('span', {}, N.by), ca, h('b', {}, 'Cloud APIM'));
  const byWrap = h('div', { class: 'abs', style: { left: 0, width: '1920px', top: '820px', display: 'flex', justifyContent: 'center' } }, by);
  root.appendChild(byWrap);

  const LAND = 0.95;
  const OUT = 5.0;
  const SPARKS = Array.from({ length: 90 }, (_, i) => ({
    ang: hash(i * 7 + 1) * Math.PI * 2,
    v: 380 + 900 * Math.pow(hash(i * 13 + 2), 1.6),
    r: 3 + 9 * hash(i * 5 + 3),
    life: 0.7 + 0.9 * hash(i * 11 + 4),
    up: 120 + 260 * hash(i * 17 + 5),
  }));

  return {
    id: 'title',
    start: SCENES.title[0],
    end: SCENES.title[1],
    root,
    update(t) {
      const ko = E.inCubic(p(t, OUT, OUT + 0.55));
      // the artwork
      const ka = E.outCubic(p(t, 0.2, 1.2));
      set(art, { s: 1.12 - 0.08 * E.outCubic(p(t, 0.2, OUT + 0.5)), o: ka * (1 - ko) * 0.9 });
      set(artShade, { o: 1 });

      // the logo slams in, settles, breathes
      const kl = p(t, LAND - 0.42, LAND);
      const land = t > LAND ? Math.exp(-(t - LAND) * 7) * Math.cos((t - LAND) * 26) : 0;
      const breathe = 1 + 0.012 * Math.sin((t - LAND) * 1.6) * p(t, LAND, LAND + 1);
      set(logo, {
        s: (lerp(1.9, 1, E.inQuad(kl)) + 0.05 * land) * breathe * (1 + ko * 0.15),
        o: E.outCubic(p(t, LAND - 0.42, LAND - 0.2)) * (1 - ko),
        blur: (1 - E.inQuad(kl)) * 16 + ko * 12,
        y: ko * -20,
      });
      const sw = p(t, LAND + 0.45, LAND + 1.6);
      shine.style.backgroundPosition = `${(100 - sw * 100).toFixed(2)}% 0`;
      set(shine, { s: breathe * (1 + ko * 0.15), o: sw > 0 && sw < 1 ? 1 - ko : 0, y: ko * -20 });

      // the burst
      const g = fx.begin();
      const age = t - LAND;
      if (age > 0 && age < 1.8) {
        g.globalCompositeOperation = 'lighter';
        const cx = 960;
        const cy = 330;
        // the shockwave
        const kr = E.outCubic(clamp(age / 0.9));
        g.lineWidth = 10 * (1 - kr) + 1;
        g.strokeStyle = `rgba(255,150,80,${(0.55 * (1 - kr)).toFixed(3)})`;
        g.beginPath();
        g.ellipse(cx, cy + 40, 260 + 700 * kr, (260 + 700 * kr) * 0.62, 0, 0, Math.PI * 2);
        g.stroke();
        glowAt(g, cx, cy, 520 * (0.6 + kr), RGBS.ember, 0.35 * Math.exp(-age * 4));
        for (const s of SPARKS) {
          const a = age / s.life;
          if (a >= 1) continue;
          const d = s.v * (1 - Math.exp(-age * 2.6)) / 2.6;
          const x = cx + Math.cos(s.ang) * d;
          const y = cy + Math.sin(s.ang) * d * 0.75 - s.up * age + 160 * age * age;
          glowAt(g, x, y, s.r * 2.4, RGBS.ember, (1 - a) * 0.9);
        }
        g.globalCompositeOperation = 'source-over';
      }

      rise(w1, t, LAND + 0.35, { stagger: 0.045, dur: 0.8, out: OUT, outStagger: 0.02 });
      rise(w2, t, LAND + 0.6, { stagger: 0.045, dur: 0.8, out: OUT + 0.05, outStagger: 0.02 });
      const kb = E.outExpo(p(t, LAND + 1.0, LAND + 1.8));
      const kbo = E.inCubic(p(t, OUT + 0.1, OUT + 0.5));
      set(byWrap, { y: (1 - kb) * 30 - kbo * 20, o: kb * (1 - kbo) });
    },
  };
}
