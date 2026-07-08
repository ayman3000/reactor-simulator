'use strict';
const assert = require('assert');
const Reactor = require('../physics.js');

function run(r, seconds) { for (let t = 0; t < seconds; t += 0.05) r.step(0.05); }

// 1. Critical steady state holds
let r = new Reactor();
run(r, 60);
let s = r.getState();
assert(Math.abs(s.power - 1.0) < 0.01, `steady power drifted: ${s.power}`);
assert(Math.abs(s.rho) < 20, `steady rho drifted: ${s.rho} pcm`);
assert.strictEqual(s.status, 'SAFE');

// 2. SCRAM shuts it down
r = new Reactor(); r.scram(); run(r, 10);
s = r.getState();
assert(s.power < 0.06, `post-scram power too high: ${s.power}`);
assert(s.rodInsertion > 0.99, 'rods not fully inserted after scram');
assert(s.rho < -3000, `shutdown margin missing: ${s.rho} pcm`);

// 3. Small withdrawal -> power rises, feedback stabilizes (no DNB)
r = new Reactor(); r.setRodTarget(0.42); run(r, 120);
s = r.getState();
assert(s.power > 1.05, `power did not rise: ${s.power}`);
assert(!s.melted, 'small withdrawal must not melt the core');
const p1 = s.power; run(r, 30);
assert(Math.abs(r.getState().power - p1) < 0.02, 'feedback did not stabilize power');

// 4. Full withdrawal -> DNB -> latched meltdown
r = new Reactor(); r.setRodTarget(0); run(r, 300);
s = r.getState();
assert.strictEqual(s.status, 'MELTDOWN', `expected meltdown, got ${s.status} (Tfuel=${s.Tfuel})`);
assert(s.melted);
r.scram(); run(r, 20);
assert.strictEqual(r.getState().status, 'MELTDOWN', 'meltdown must latch');

// 5. Display consistency: keff<->rho, sigma rods positive & responsive
r = new Reactor(); s = r.getState();
assert(Math.abs(s.keff - 1 / (1 - s.rho / 1e5)) < 1e-6, 'keff inconsistent with rho');
assert(s.sigma.rods > 0, 'sigma_rods must be positive');
const sigmaBefore = s.sigma.rods;
r.setRodTarget(0.6); run(r, 30);
assert(r.getState().sigma.rods > sigmaBefore, 'inserting rods must raise sigma_rods');

console.log('All physics tests passed.');
