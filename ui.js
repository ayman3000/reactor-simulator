/*
 * ui.js — maps a Reactor state snapshot onto the DOM/SVG each frame.
 * Exposes UI.init() and UI.render(state, dtMs).
 */
'use strict';

const UI = (() => {

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const STATUS_TEXT = {
    SAFE: 'REACTOR SAFE',
    WARNING: 'WARNING',
    DANGER: 'DANGEROUS',
    MELTDOWN: '☢ MELTING DOWN!!',
  };

  // bar id -> [state field, max, format]
  const BARS = [
    ['bar-power',    s => s.power * 100,   130,  v => v.toFixed(1) + ' %'],
    ['bar-tfuel',    s => s.Tfuel,         2900, v => v.toFixed(0) + ' °C'],
    ['bar-tcool',    s => s.Tcool,         400,  v => v.toFixed(1) + ' °C'],
    ['bar-pressure', s => s.pressure,      250,  v => v.toFixed(1) + ' bar'],
    ['bar-rods',     s => s.rodInsertion * 100, 100, v => v.toFixed(1) + ' %'],
  ];

  const PARTICLES_PER_PATH = 14;
  const puffs = [];
  let bars = [], particles = [], els = {};

  function makeParticle(path, len, i) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('r', '4.5');
    els.particles.appendChild(el);
    return { el, path, len, dist: (i / PARTICLES_PER_PATH) * len };
  }

  function init() {
    els = {
      status: $('status'),
      rods: $('control-rods'),
      glow: $('core-glow'),
      fuel: $('fuel-rods'),
      corium: $('corium'),
      steam: $('steam'),
      particles: $('particles'),
      flowHot: $('flow-hot'),
      flowCold: $('flow-cold'),
    };
    bars = BARS.map(([id, get, max, fmt]) => ({
      fill: document.querySelector('#' + id + ' .bar-fill'),
      value: document.querySelector('#' + id + ' .bar-value'),
      get, max, fmt,
    }));
    ['keff', 'rho', 'period', 'flux', 'sigma-total', 'sigma-rods',
     'f', 'eps', 'p', 'eta', 'kinf', 'pnl', 'time'].forEach(k => { els['ro-' + k] = $('ro-' + k); });

    const lenHot = els.flowHot.getTotalLength();
    const lenCold = els.flowCold.getTotalLength();
    particles = [];
    for (let i = 0; i < PARTICLES_PER_PATH; i++) {
      particles.push(makeParticle(els.flowHot, lenHot, i));
      particles.push(makeParticle(els.flowCold, lenCold, i));
    }
    Array.from(els.steam.children).forEach((el, i) => {
      puffs.push({ el, t: i / 6, cx: +el.getAttribute('cx') });
    });
  }

  function hotColor(Thot) {
    // orange -> near-white-yellow as the hot leg climbs 320..380 °C
    const t = clamp((Thot - 320) / 60, 0, 1);
    const r = Math.round(lerp(249, 253, t));
    const g = Math.round(lerp(115, 224, t));
    const b = Math.round(lerp(22, 71, t));
    return `rgb(${r},${g},${b})`;
  }

  function fmtPeriod(p) {
    if (!isFinite(p) || Math.abs(p) > 1e4) return '∞';
    return p.toFixed(1) + ' s';
  }

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function render(s, dtMs) {
    // progress bars
    for (const b of bars) {
      const v = b.get(s);
      const pct = clamp(v / b.max * 100, 0, 100);
      b.fill.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      b.value.textContent = b.fmt(v);
    }

    // readouts
    els['ro-keff'].textContent = s.keff.toFixed(5);
    els['ro-rho'].textContent = s.rho.toFixed(0) + ' pcm';
    els['ro-period'].textContent = fmtPeriod(s.period);
    els['ro-flux'].textContent = s.flux.toExponential(2) + ' n/cm²s';
    els['ro-sigma-total'].textContent = s.sigma.total.toFixed(4) + ' cm⁻¹';
    els['ro-sigma-rods'].textContent = s.sigma.rods.toFixed(4) + ' cm⁻¹';
    els['ro-f'].textContent = s.factors.f.toFixed(4);
    els['ro-eps'].textContent = s.factors.eps.toFixed(3);
    els['ro-p'].textContent = s.factors.p.toFixed(3);
    els['ro-eta'].textContent = s.factors.eta.toFixed(3);
    els['ro-kinf'].textContent = s.factors.kinf.toFixed(5);
    els['ro-pnl'].textContent = (s.factors.Pf * s.factors.Pt).toFixed(4);
    els['ro-time'].textContent = fmtTime(s.time);

    // annunciator
    document.body.dataset.state = s.status.toLowerCase();
    els.status.textContent = STATUS_TEXT[s.status] + (s.scramActive && !s.melted ? ' · SCRAM' : '');

    // control rods at actual position
    els.rods.setAttribute('transform', `translate(0, ${(-(1 - s.rodInsertion) * 200).toFixed(1)})`);

    // core glow
    const p = clamp(s.power, 0, 1.5);
    els.glow.setAttribute('opacity', s.melted ? '0.95' : (0.06 + 0.5 * p / 1.3).toFixed(3));
    els.glow.setAttribute('fill', s.melted ? '#ffffff' : (s.power > 1.12 ? '#ff9d00' : '#ff6a00'));

    // meltdown visuals
    els.fuel.classList.toggle('melt', s.melted);
    els.corium.setAttribute('opacity', s.melted ? '0.9' : '0');

    // coolant flow particles
    const speed = 80 + 120 * clamp(s.power, 0, 1.5);
    const hc = hotColor(s.Thot);
    for (const pt of particles) {
      pt.dist = (pt.dist + speed * dtMs / 1000) % pt.len;
      const pos = pt.path.getPointAtLength(pt.dist);
      pt.el.setAttribute('cx', pos.x.toFixed(1));
      pt.el.setAttribute('cy', pos.y.toFixed(1));
      pt.el.setAttribute('fill', pt.path === els.flowHot ? hc : '#60a5fa');
    }

    // steam puffs
    const steamLevel = s.melted ? 0 : clamp(s.power, 0, 1);
    for (const puff of puffs) {
      puff.t = (puff.t + dtMs / 1000 * 0.35) % 1;
      puff.el.setAttribute('cy', (105 - 55 * puff.t).toFixed(1));
      puff.el.setAttribute('cx', (puff.cx + 4 * Math.sin(puff.t * 6.28)).toFixed(1));
      puff.el.setAttribute('r', (6 + 8 * puff.t).toFixed(1));
      puff.el.setAttribute('opacity', steamLevel < 0.05 ? '0' : (0.55 * steamLevel * (1 - puff.t)).toFixed(3));
    }
  }

  return { init, render };
})();
