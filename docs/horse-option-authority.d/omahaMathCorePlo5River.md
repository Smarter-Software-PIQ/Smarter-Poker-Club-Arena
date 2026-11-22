# omahaMathCorePlo5River: authority for the live switch

Lane core-repair (PLO-OWNER lead-4, session e9eba0f6-2586-4b5f-bc3d-d9932c36084e), updated 2026-11-22. Evidence NOT MET until serving-build Rule 9 latency verification, real-hand M5 replay, and live shadow staging complete on a build descending from this PR: the option remains default OFF (release-default-off in `OPTION_SWITCH_RELEASE_DEFAULT_OFF` via LIST TRAIN `#11667`). It acts only with `omahaMathCore` on (its companion) and only on PLO5 cash river decisions.

## What it does

With `omahaMathCore` on and a live opponent-lifetime HUD packet (`omahaOpponentLifetimeHud`) installed, Stage 1 of the B3 Math Core Turn and River module (`OmahaMathCoreTurnRiver.ts`) owns PLO5 cash river facing-bet decisions (high only, one board, pot limit; never PLO4, PLO6, a tournament, or a bomb pot) behind a strict `fold -> plain call` boundary: it never bets, never raises, and never folds a baseline call. Public action counters are read exclusively through the seat-only adapter `opponentHud/OmahaMathCoreTurnRiverHud.ts` (zero user IDs, zero person/Horse labels, zero unshown cards, zero DB/clock reads):

- Cumulative tail of size-resolved first wagers (`>= 0.85 * frac` over `fw1` 14-bin counts) and `hudBarrelRecord` triple-barrel rates, choosing the sharpest empirical-Bayes lower bound `fLo` across `line`, `pooled`, and `barrel` (`kFreq = 2`).
- Polarized value-core (`p_base`) plus excess-uniform (`fLo - p_base`) range mixture: opponents with `fLo <= p_base` produce `excessMass = 0` and zero flips (station and nit proof by construction).
- Exact river showdown equity over a deterministic 4,000-hand pool (`K_ev = 5` pool-SE margin on non-committing calls), `K_allin = 25` full-quadrature SE margin on river stack-committing calls (`RIVER-CORE` law), and exact current-nuts call floor (`holdsCurrentNuts`).
- On any other street or game the core does no work for this flag (`OmahaMathCoreOffScopeNoWork.law.test.ts`).

## Receipts

`decision.omahaMathCore` (core receipt: chosen action and amount, incoming decision, EVs, nut floor, timings) plus live fallback telemetry counters `omaha_math_core_fallback_{core_error,value_search_error,equity_collision,tracker_failure}` (`#11683`).

## Tests

`OmahaMathCoreTurnRiverHud.law.test.ts` (13 law tests covering identity-free boundary, `fw1` edge lockstep, station/nit zero-flip proof, cumulative tail anti-dilution, capped turn continuation with cross-street `riverRate`, river `K_allin = 25` stack-commit guard, Stage 1 turn/river fold->call-only boundary, and current-nuts floor), `OmahaMathCoreIdentityFree.law.test.ts`, `OmahaMathCoreOffScopeNoWork.law.test.ts`, `OmahaMathCoreNoCategoricalRules.law.test.ts`, `OmahaMathCoreNutsEveryStreet.law.test.ts`, `OpponentHud.law.test.ts`, `HorseReferenceDecisionSources.test.ts`, `HorseDataLedger.test.ts`.

## Replay

- Replay: NOT RUN (the audited-decision-replay scorer has no PLO5 cash river HUD audit set; evaluated by VERIFIER-10 sealed 24-cell learning-bench confirm grade below, with fresh-window real-hand M5 replay required before live shadow)

## Evidence rows

- Mechanism, scope, identity-free seat-only boundary, off-scope zero work, release-default-OFF classification (`#11667`): **MET**.
- Learning-bench 24-cell formal confirm grade (`CRITERIA-CORE-LEAD4-B3-TR-BENCH.md` sha256 `729d7fa32bce`, candidate `5d77a82c5eb4`, fresh seeds `20261217`/`20261218`, `SPARRING_HUD=1 SPARRING_CONTROL=1`, **VERIFIER-10 V324 EXACT CONFIRM**, `results.jsonl` sha256 `a6d5d97d6809`): **`BENCH-PASS`**:
  - Bar 1 (CTRL `24/24`): **PASS** (`24/24` `handsDiffering = 0`, `|CTRL - BASE| = 0.0000 bb/100`; mirror deal `0/24` nonzero).
  - Bar 2 (Horse hard flags & HUD `refused`): **PASS** (`24/24` `0` Horse illegal/fallback/truncated, `0` HUD refused).
  - Bar 3 (`C1`, `probe:pot_stab_turn_river`): **`C1 HOLDS`** (`46` T+R `fold->call` flips; 4/4 cells negative: `20261217 HU -34.99 +/- 15.65 z=-2.235`, `20261218 HU -37.99 +/- 13.56 z=-2.801`, `20261217 6M -3.02 +/- 5.93 z=-0.510`, `20261218 6M -17.05 +/- 10.57 z=-1.613`; **IV-pooled ALL = `-12.53 +/- 4.62 bb/100 (z = -2.714) <= -2.00`**, `HU pooled -36.70 +/- 10.25 z=-3.581`, `6M pooled -6.38 +/- 5.17 z=-1.234`).
  - Bar 4a (`GUARD-POOLED`, `P = 5`, `z_fam(5) = 1.825`): **5/5 PASS** (`station_turn_river +0.00 z=0.000`, `tell_d4 +0.00 z=0.000`, `check_raise -0.67 z=-0.180`, `aggro_reg +0.19 z=+0.123`, `barrel_air +1.64 z=+0.639`).
  - Bar 4b (`GUARD-CELL`, `m = 20`, `z_fam(20) = 2.382`): **20/20 PASS** (max cell `z = +1.000`).
- Local pre-merge latency check on `5d77a82c5eb4` (300 pairs HU + 6-max): **`0 / 438 (0.000%) > 100 ms`** (`plo5:2 ON|river p50 14.18 ms max 21.49 ms`, `plo5:6 ON|river p50 20.24 ms max 29.41 ms`).
- Remaining activation preconditions: (1) merged & serving build on `engine.smarter.poker/health` descends from this PR, (2) VERIFIER-10 passes serving-build Rule 9 latency gate for `omahaMathCorePlo5River`, (3) real-hand M5 replay & live shadow staging per lead authorization.
