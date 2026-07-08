# Lamarsh PWR-1000 — Nuclear Reactor Simulator

An educational pressurized-water-reactor simulator in plain HTML/CSS/JavaScript,
built around the reactor theory in **John R. Lamarsh, *Introduction to Nuclear
Reactor Theory***. No dependencies, no build step.

> ⚠️ Educational use only. Parameters are representative, lumped, and tuned for
> teaching — this is not a licensing-grade plant model.

## Run it

Double-click `index.html` (or serve the folder with any static server).

## Operating the reactor

- **Control rod slider** sets the bank's insertion *target* (0 % = fully
  withdrawn, 100 % = fully inserted). Rods drive at 5 %/s, so the actual
  position (shown in the bars and the schematic) lags the target.
- **▲ OUT / ▼ IN** step the target by 1 %.
- **SCRAM** drops the whole bank in ~2 s. After a SCRAM only **RESET**
  restores control.
- **RESET** returns the plant to its critical, 100 %-power reference state.

### Things to try

| Action | What happens | Why |
|---|---|---|
| Withdraw to ~43 % | Power settles slightly above 100 % | Negative Doppler + moderator feedback compensate the added reactivity |
| Withdraw to ~38 % | Power stabilizes near 160 % — DANGEROUS | Feedback still wins, but margins are gone |
| Withdraw below ~33 % | Coolant passes ~345 °C → boiling crisis (DNB) → fuel runs away → **MELTDOWN** | Film boiling collapses fuel→coolant heat transfer, and the damage is irreversible |
| Withdraw to 0 % | Prompt-critical excursion; core melts in seconds | Inserted reactivity exceeds β = 650 pcm — the reactor is critical on prompt neutrons alone |
| SCRAM from any pre-melt state | Power collapses to a few % | −9000 pcm bank worth ≫ excess reactivity |

## The model (Lamarsh)

**Point-reactor kinetics, six delayed-neutron groups** (U-235, Keepin data;
β = 0.006502, Λ = 10⁻⁴ s), integrated semi-implicitly at 5 ms substeps:

```
dn/dt  = ((ρ − β)/Λ)·n + Σ λᵢcᵢ
dcᵢ/dt = (βᵢ/Λ)·n − λᵢcᵢ
```

**Reactivity balance** (pcm): ρ = ρ_rods + ρ_Doppler + ρ_moderator

- Rod bank integral worth follows the classic S-curve
  `W(x) = W_tot·(x − sin 2πx / 2π)` with W_tot = −9000 pcm; the core is exactly
  critical with the bank 45 % inserted at reference temperatures.
- Doppler: −2.7 pcm/°C of fuel temperature (defect capped at −3000 pcm — it
  saturates at high fuel temperature).
- Moderator: −8 pcm/°C of coolant temperature.

**Six-factor formula**, displayed live and kept exactly consistent with ρ:

```
k_eff = 1/(1 − ρ) = ε · p · f · η · P_f · P_t
f = Σa(fuel) / [Σa(fuel) + Σa(moderator) + Σa(rods)]
```

with ε = 1.02, p = 0.87, η = 2.06, P_f = P_t = 0.983, Σa(fuel) = 0.100 cm⁻¹,
Σa(moderator) = 0.060 cm⁻¹. Moving the rods changes Σa(rods), hence f, hence
k — the "absorption coefficient" readouts on the panel.

**Thermal-hydraulics** — two lumped nodes (3000 MWt nominal):

```
C_f·dT_f/dt = P − UA·(T_f − T_c)          C_f = 3.0×10⁷ J/K
C_c·dT_c/dt = UA·(T_f − T_c) − H·(T_c − T_sg)   C_c = 1.65×10⁹ J/K
```

Hot/cold legs split ±18 °C around T_c at full power; pressure tracks coolant
temperature around 155 bar.

**DNB / boiling crisis:** above 345 °C coolant, the fuel→coolant conductance
degrades linearly to 15 % by 352 °C and *latches* (cladding damage is
irreversible until RESET). **Meltdown** latches when fuel reaches UO₂ melting
(2865 °C) — after that, not even a SCRAM helps.

## Safety states

| State | Condition |
|---|---|
| 🟢 SAFE | power ≤ 100.5 %, T_fuel < 1600 °C, T_cool < 335 °C |
| 🟡 WARNING | power > 100.5 % or T_fuel > 1600 °C or T_cool > 335 °C |
| 🔴 DANGEROUS | power > 112 % or T_fuel > 2200 °C or T_cool > 345 °C |
| ☢️ MELTING DOWN!! | T_fuel ≥ 2865 °C (latched — RESET only) |

## Files

| File | Responsibility |
|---|---|
| `index.html` | Page structure + SVG plant schematic |
| `style.css` | Control-room theme, alarm states, animations |
| `physics.js` | Pure simulation engine (no DOM) — also loadable in Node |
| `ui.js` | Renders a state snapshot to the DOM/SVG each frame |
| `main.js` | Controls wiring + requestAnimationFrame loop |
| `test/physics.test.js` | Headless sanity tests: `node test/physics.test.js` |
