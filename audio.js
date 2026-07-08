/*
 * audio.js — synthesized alarm sounds via the Web Audio API (no audio files).
 *   WARNING:  slow single beep
 *   DANGER:   fast two-tone klaxon
 *   MELTDOWN: continuous sweeping siren
 * Browsers only allow audio after a user gesture, so Alarm.arm() must be
 * called from the first click/keypress; until then state changes are silent.
 */
'use strict';

const Alarm = (() => {

  let ctx = null, master = null;
  let mode = 'SAFE', timer = null, siren = null;
  let muted = false, armed = false;

  function beep(freq, dur, type, vol) {
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function stopPattern() {
    if (timer) { clearInterval(timer); timer = null; }
    if (siren) { siren.osc.stop(); siren.lfo.stop(); siren = null; }
  }

  function startPattern() {
    stopPattern();
    if (muted || !ctx || ctx.state !== 'running') return;
    if (mode === 'WARNING') {
      beep(880, 0.18, 'sine', 0.7);
      timer = setInterval(() => beep(880, 0.18, 'sine', 0.7), 1600);
    } else if (mode === 'DANGER') {
      let hi = true;
      beep(950, 0.2, 'square', 0.55);
      timer = setInterval(() => { hi = !hi; beep(hi ? 950 : 700, 0.2, 'square', 0.55); }, 450);
    } else if (mode === 'MELTDOWN') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 750;
      lfo.type = 'triangle';
      lfo.frequency.value = 0.9;      // siren sweep rate
      lfoGain.gain.value = 350;       // sweep depth: 750 ± 350 Hz
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      g.gain.value = 0.5;
      osc.connect(g);
      g.connect(master);
      osc.start();
      lfo.start();
      siren = { osc, lfo };
    }
  }

  function setState(status) {
    if (status === mode) return;
    mode = status;
    startPattern();
  }

  // Must be called from a user gesture (autoplay policy).
  function arm() {
    if (armed) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.12;
      master.connect(ctx.destination);
    }
    const go = () => { armed = true; startPattern(); };
    if (ctx.state === 'running') go();
    else ctx.resume().then(go);
  }

  function toggleMute() {
    muted = !muted;
    if (muted) stopPattern(); else startPattern();
    return muted;
  }

  return {
    setState, arm, toggleMute,
    isMuted: () => muted,
    _debug: () => ({ armed, mode, muted, ctxState: ctx ? ctx.state : 'none', beeping: !!timer, siren: !!siren }),
  };
})();
