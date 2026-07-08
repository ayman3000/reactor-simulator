/*
 * physics.js — Lamarsh point-reactor model of a PWR ("Lamarsh PWR-1000").
 * Pure computation, no DOM. Loaded both by the browser (window.Reactor)
 * and by Node for the headless tests (module.exports).
 *
 * Model, per J. R. Lamarsh, "Introduction to Nuclear Reactor Theory":
 *   - Point kinetics with 6 delayed-neutron groups (U-235, Keepin data)
 *   - Reactivity = rods (S-curve integral worth) + Doppler + moderator feedback
 *   - Six-factor formula displayed via macroscopic absorption cross-sections
 *   - Two-node lumped thermal-hydraulics (fuel, coolant)
 *   - DNB/boiling crisis: heat transfer collapses above coolant saturation
 */
'use strict';

(function (global) {

  // ---- Kinetics: U-235 six delayed-neutron groups (Keepin) ----
  const BETA_I   = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
  const LAMBDA_I = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01]; // s^-1
  const BETA     = 0.006502;
  const GEN_TIME = 1.0e-4;   // prompt-neutron generation time Lambda, s

  const PCM = 1e-5;          // 1 pcm in dk/k

  // ---- Control rods ----
  const ROD_WORTH_TOTAL = -9000 * PCM; // full-bank integral worth
  const ROD_REF   = 0.45;              // insertion at which the core is critical at reference temps
  const ROD_SPEED = 0.05;              // fraction/s, normal drive (20 s full travel)
  const SCRAM_SPEED = 0.5;             // fraction/s (~2 s full insertion)

  // ---- Reactivity feedback ----
  const ALPHA_DOPPLER = -2.7 * PCM;    // per degC fuel
  const ALPHA_MOD     = -8.0 * PCM;    // per degC coolant
  const DOPPLER_CAP   = -3000 * PCM;   // Doppler defect saturates at high fuel temp
  const T_FUEL_REF = 900;              // degC
  const T_COOL_REF = 310;              // degC

  // ---- Thermal-hydraulics (two lumped nodes) ----
  const P_NOMINAL = 3000e6;            // W thermal
  const C_FUEL = 3.0e7;                // J/K, fuel heat capacity
  const C_COOL = 1.65e9;               // J/K, primary coolant heat capacity
  const T_SG   = 270;                  // degC, secondary-side sink
  const UA_FC  = P_NOMINAL / (T_FUEL_REF - T_COOL_REF); // fuel->coolant conductance
  const H_SG   = P_NOMINAL / (T_COOL_REF - T_SG);       // coolant->steam generator
  const MDOT_CP = P_NOMINAL / 36;      // loop m*cp: 36 degC hot/cold split at 100 %

  // ---- Boiling crisis (DNB) and meltdown ----
  const T_DNB_ONSET = 345;             // degC coolant: film boiling begins
  const T_DNB_FULL  = 352;             // degC coolant: heat transfer fully degraded
  const UA_MIN_FRACTION = 0.15;
  const T_MELT = 2865;                 // degC, UO2 melting point
  const T_FUEL_MAX = 3400;             // numeric ceiling once the core has slumped

  // ---- Six-factor display constants ----
  const EPS = 1.02, RES_ESC = 0.87, ETA = 2.06, P_FNL = 0.983, P_TNL = 0.983;
  const SIGMA_A_FUEL = 0.100;          // cm^-1
  const SIGMA_A_MOD  = 0.060;          // cm^-1

  const FLUX_NOMINAL = 3.2e13;         // n/cm^2 s at 100 %
  const SUBSTEP = 0.005;               // s, physics integration step

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function rodWorth(x) {
    return ROD_WORTH_TOTAL * (x - Math.sin(2 * Math.PI * x) / (2 * Math.PI));
  }

  class Reactor {
    constructor() { this.reset(); }

    reset() {
      this.n = 1.0; // neutron density, fraction of nominal
      this.c = BETA_I.map((b, i) => b / (GEN_TIME * LAMBDA_I[i])); // precursor equilibrium
      this.rodInsertion = ROD_REF;
      this.rodTarget = ROD_REF;
      this.scramActive = false;
      this.melted = false;
      this.uaFraction = 1.0; // fuel->coolant heat transfer health; DNB damage latches it low
      this.Tfuel = T_FUEL_REF;
      this.Tcool = T_COOL_REF;
      this.time = 0;
      this.dndt = 0;
    }

    setRodTarget(x) { if (!this.scramActive) this.rodTarget = clamp(x, 0, 1); }

    scram() {
      this.scramActive = true;
      this.rodTarget = 1.0;
    }

    _reactivity() {
      const rods = rodWorth(this.rodInsertion) - rodWorth(ROD_REF);
      const doppler = Math.max(DOPPLER_CAP, ALPHA_DOPPLER * (this.Tfuel - T_FUEL_REF));
      const moderator = ALPHA_MOD * (this.Tcool - T_COOL_REF);
      return rods + doppler + moderator;
    }

    step(dt) {
      let remaining = dt;
      while (remaining > 1e-9) {
        const h = Math.min(SUBSTEP, remaining);
        this._substep(h);
        remaining -= h;
      }
    }

    _substep(h) {
      // Rod drive
      const speed = this.scramActive ? SCRAM_SPEED : ROD_SPEED;
      const dx = this.rodTarget - this.rodInsertion;
      const move = speed * h;
      this.rodInsertion += Math.abs(dx) <= move ? dx : Math.sign(dx) * move;

      // Point kinetics, semi-implicit in the stiff prompt term
      const rho = this._reactivity();
      let sumLc = 0;
      for (let i = 0; i < 6; i++) sumLc += LAMBDA_I[i] * this.c[i];
      let denom = 1 - h * (rho - BETA) / GEN_TIME;
      if (denom < 0.05) denom = 0.05;         // guard super-prompt-critical blowup
      let nNew = (this.n + h * sumLc) / denom;
      nNew = clamp(nNew, 1e-6, 20);           // source level floor, excursion ceiling
      this.dndt = (nNew - this.n) / h;
      this.n = nNew;
      for (let i = 0; i < 6; i++) {
        this.c[i] = (this.c[i] + h * (BETA_I[i] / GEN_TIME) * this.n) / (1 + h * LAMBDA_I[i]);
      }

      // DNB: above saturation the fuel->coolant film degrades; damage latches
      let boil = 1;
      if (this.Tcool >= T_DNB_FULL) boil = UA_MIN_FRACTION;
      else if (this.Tcool > T_DNB_ONSET) {
        boil = 1 - (1 - UA_MIN_FRACTION) * (this.Tcool - T_DNB_ONSET) / (T_DNB_FULL - T_DNB_ONSET);
      }
      this.uaFraction = Math.min(this.uaFraction, boil);

      // Two-node thermal-hydraulics
      const P = P_NOMINAL * this.n;
      const q = UA_FC * this.uaFraction * (this.Tfuel - this.Tcool);
      this.Tfuel = Math.min(T_FUEL_MAX, this.Tfuel + h * (P - q) / C_FUEL);
      this.Tcool += h * (q - H_SG * (this.Tcool - T_SG)) / C_COOL;

      if (this.Tfuel >= T_MELT) this.melted = true;
      this.time += h;
    }

    _status() {
      if (this.melted) return 'MELTDOWN';
      if (this.n > 1.12 || this.Tfuel > 2200 || this.Tcool > T_DNB_ONSET) return 'DANGER';
      if (this.n > 1.005 || this.Tfuel > 1600 || this.Tcool > 335) return 'WARNING';
      return 'SAFE';
    }

    getState() {
      const rho = this._reactivity();
      const keff = 1 / (1 - rho);
      const kinf = keff / (P_FNL * P_TNL);
      const f = kinf / (EPS * RES_ESC * ETA);           // thermal utilization
      const sigmaRods = Math.max(0, SIGMA_A_FUEL * (1 - f) / f - SIGMA_A_MOD);
      const dT = (P_NOMINAL * this.n) / MDOT_CP;        // hot/cold leg split
      return {
        time: this.time,
        power: this.n,
        powerMW: this.n * P_NOMINAL / 1e6,
        keff,
        rho: rho / PCM,                                 // pcm
        period: Math.abs(this.dndt) < 1e-9 ? Infinity : this.n / this.dndt,
        rodInsertion: this.rodInsertion,
        rodTarget: this.rodTarget,
        Tfuel: this.Tfuel,
        Tcool: this.Tcool,
        Thot: this.Tcool + dT / 2,
        Tcold: this.Tcool - dT / 2,
        pressure: clamp(155 + 1.2 * (this.Tcool - T_COOL_REF), 100, 250),
        flux: FLUX_NOMINAL * this.n,
        sigma: {
          fuel: SIGMA_A_FUEL,
          mod: SIGMA_A_MOD,
          rods: sigmaRods,
          total: SIGMA_A_FUEL + SIGMA_A_MOD + sigmaRods,
        },
        factors: { eps: EPS, p: RES_ESC, f, eta: ETA, Pf: P_FNL, Pt: P_TNL, kinf },
        status: this._status(),
        scramActive: this.scramActive,
        melted: this.melted,
      };
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = Reactor;
  else global.Reactor = Reactor;

})(typeof window !== 'undefined' ? window : globalThis);
