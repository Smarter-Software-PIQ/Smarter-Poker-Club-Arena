# omahaMathCorePlo4Turn: authority for the live switch

Lane core-repair (PLO-OWNER lead-4, session e9eba0f6-2586-4b5f-bc3d-d9932c36084e), updated 2026-11-22. Evidence NOT MET until serving-build Rule 9 latency verification, real-hand M5 replay, and live shadow staging complete on a build descending from this PR: the option remains default OFF (release-default-off in `OPTION_SWITCH_RELEASE_DEFAULT_OFF` via LIST TRAIN `#11667`). It acts only with `omahaMathCore` on (its companion) and only on PLO4 cash turn decisions.

## What it does

With `omahaMathCore` on and a live opponent-lifetime HUD packet (`omahaOpponentLifetimeHud`) installed, Stage 1 of the B3 Math Core Turn and River module (`OmahaMathCoreTurnRiver.ts`, merged in `#11725`) owns PLO4 cash turn facing-bet decisions (high only, one board, pot limit; never PLO5, PLO6, a tournament, or a bomb pot) behind a strict `fold -> plain call` boundary: it never bets, never raises, never folds a baseline call, and never falls back to uncertified population turn tables while the lifetime HUD packet is active. Public action counters are read exclusively through the seat-only adapter `opponentHud/OmahaMathCoreTurnRiverHud.ts` (zero user IDs, zero person/Horse labels, zero unshown cards, zero DB/clock reads):

- Cumulative tail of size-resolved first wagers (`>= 0.85 * frac` over `fw1` 14-bin counts) and `hudBarrelRecord` double-barrel rates, choosing the sharpest empirical-Bayes lower bound `fLo` across `line`, `pooled`, and `barrel` (`kFreq = 2`).
- Polarized value-core (`p_base`) plus excess-uniform (`fLo - p_base`) range mixture: opponents with `fLo <= p_base` produce `excessMass = 0` and zero flips (station and nit proof by construction).
- Capped turn continuation (`capped: true`, zero phantom river barrel fold credit) using cross-street lifetime `riverRate` via `o.lc` (`hudFirstWagerRecord`), plus `K_ev = 5` pool-SE margin and exact current-nuts call floor (`holdsCurrentNuts`).
- On any other street or game the core does no work for this flag (`OmahaMathCoreOffScopeNoWork.law.test.ts`).

## Receipts

`decision.omahaMathCore` (core receipt: chosen action and amount, incoming decision, EVs, nut floor, timings) plus live fallback telemetry counters `omaha_math_core_fallback_{core_error,value_search_error,equity_collision,tracker_failure}` (`#11683`).

## Tests

`OmahaMathCoreTurnRiverHud.law.test.ts` (16 law tests including PLO4 station/nit zero-flip proof, PLO4 Stage 1 turn/river fold->call-only boundary, PLO4 capped turn continuation, and PLO4 river `K_allin = 25` commit guard), `OmahaMathCoreIdentityFree.law.test.ts`, `OmahaMathCoreOffScopeNoWork.law.test.ts`, `OmahaMathCoreNoCategoricalRules.law.test.ts`, `OmahaMathCoreNutsEveryStreet.law.test.ts`, `OpponentHud.law.test.ts`, `HorseReferenceDecisionSources.test.ts`, `HorseDataLedger.test.ts`.

## Replay

- Replay: NOT RUN (the audited-decision-replay scorer has no PLO4 cash turn HUD audit set; evaluated by VERIFIER-10 sealed 24-cell learning-bench confirm grade below, with fresh-window real-hand M5 replay required before live shadow)

## Evidence rows

- Mechanism, scope, identity-free seat-only boundary, off-scope zero work, release-default-OFF classification (`#11667`): **MET**.
- Learning-bench 24-cell formal confirm grade (`CRITERIA-CORE-LEAD4-B3-PLO4-TR-BENCH.md` sha256 `6da5ae13e93b`, candidate `15b19a40ec78`, fresh seeds `20261219`/`20261220`, `SPARRING_HUD=1 SPARRING_CONTROL=1`, **VERIFIER-10 V328 EXACT CONFIRM**, `results.jsonl` sha256 `12eea797aa5c`): **`BENCH-PASS`**:
  - Bar 1 (CTRL `24/24`): **PASS** (`24/24` `handsDiffering = 0`, `|CTRL - BASE| = 0.0000 bb/100`; mirror deal `0/24` nonzero).
  - Bar 2 (Horse hard flags & HUD `refused`): **PASS** (`24/24` `0` Horse illegal/fallback/truncated, `0` HUD refused).
  - Bar 3 (`C1`, `probe:pot_stab_turn_river` HU `plo4:2:100:6000`): **`C1 HOLDS`** (`86` T+R `fold->call` flips; `20261219 -12.95 +/- 7.12 z=-1.818`, `20261220 -9.86 +/- 6.08 z=-1.621`; **HU IV-pooled = `-11.16 +/- 4.63 bb/100 (z = -2.413) <= -2.00`**; all 4 `pot_stab` cells HU+6M negative, pooled `-8.91 +/- 3.26 z=-2.733`).
  - Bar 4a (`GUARD-POOLED`, `P = 6`, `z_fam(6) = 1.905`): **6/6 PASS** (`pot_stab:6M -6.69 z=-1.456`, `station_turn_river -2.61 z=-0.922`, `barrel_air -0.13 z=-0.441`, `tell_d4 +0.00 z=0.000`, `check_raise +0.00 z=0.000`, `profile:aggro_reg +3.25 +/- 1.72 z=+1.884 <= 1.905`).
  - Bar 4b (`GUARD-CELL`, `m = 22`, `z_fam(22) = 2.417`): **22/22 PASS** (max cell `z = +1.894 <= 2.417`).
- Local pre-merge latency check on `15b19a40ec78` (300 pairs HU + 6-max): **`0 / 429 (0.000%) > 100 ms`** (`plo4:2 ON|turn p50 26.80 ms max 66.25 ms`, `plo4:6 ON|turn p50 25.31 ms max 40.61 ms`).
- Remaining activation preconditions: (1) merged & serving build on `engine.smarter.poker/health` descends from this PR, (2) VERIFIER-10 passes serving-build Rule 9 latency gate for `omahaMathCorePlo4Turn`, (3) real-hand M5 replay & live shadow staging per lead authorization.
