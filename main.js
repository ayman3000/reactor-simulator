/*
 * main.js — wires controls to the Reactor and runs the animation loop.
 */
'use strict';

const reactor = new Reactor();
UI.init();

const slider = document.getElementById('rod-slider');
const readout = document.getElementById('rod-readout');

function applySlider() {
  reactor.setRodTarget(slider.value / 100);
  readout.textContent = Number(slider.value).toFixed(1) + ' %';
}

slider.addEventListener('input', applySlider);

document.getElementById('rod-out').addEventListener('click', () => {
  slider.value = Math.max(0, Number(slider.value) - 1);
  applySlider();
});
document.getElementById('rod-in').addEventListener('click', () => {
  slider.value = Math.min(100, Number(slider.value) + 1);
  applySlider();
});

document.getElementById('scram-btn').addEventListener('click', () => {
  reactor.scram();
  slider.value = 100;
  readout.textContent = '100.0 % · SCRAM';
});

document.getElementById('reset-btn').addEventListener('click', () => {
  reactor.reset();
  slider.value = 45;
  applySlider();
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); // clamp away tab-sleep jumps
  last = now;
  reactor.step(dt);
  UI.render(reactor.getState(), dt * 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
