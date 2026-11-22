# omahaMathCorePlo4Flop: authority for the live switch

Lanes CORE-EXTEND / core-repair (PLO-OWNER lead-4, session e9eba0f6-2586-4b5f-bc3d-d9932c36084e), updated 2026-11-22. Evidence NOT MET until serving-build Rule 9 latency measurement and live shadow staging complete on a build descending from this PR: the option remains default OFF (release-default-off in `OPTION_SWITCH_RELEASE_DEFAULT_OFF` via LIST TRAIN `#11667`). It acts only with `omahaMathCore` on (its companion) and only on PLO4 cash flop decisions.

## What it does

With `omahaMathCore` on, the math core owns PLO4 cash flop decisions (table and Lightning; high only, one board, pot limit; never PLO5, PLO6, a tournament or a bomb pot): the action is the expected-value maximum over the legal actions, from public information and the hero's own cards only (see `omahaMathCore.md`). It applies the measured population PLO4 flop realization (`0.7984`, with `plo4|flop|call|raised_own` `0.6762`), inherits the merged B1 range-tracker/capped-call repair (`#11678`), `CORE-FIX-1` (`#11683`), and multiway `effOpp` scaling (`#11690`), and prices continuation-bet raise shares from each responder's own lifetime `hudCbetRaiseRecord` via the seat-only adapter `opponentHud/OmahaMathCoreHudRecords.ts` (shrunk `n / (n + 20)` toward the pooled response; null HUD record = pooled response verbatim). On any other street or game the core does no work for this flag (`OmahaMathCoreOffScopeNoWork.law.test.ts`).

## Receipts

`decision.omahaMathCore` (core receipt: chosen action and amount, incoming decision as record, equity, prices, ranges, nut floor, timings) plus live fallback telemetry counters `omaha_math_core_fallback_{core_error,value_search_error,equity_collision,tracker_failure}` (`#11683`).

## Tests

`OmahaMathCore.test.ts`, `OmahaMathCoreRealizationPinned.law.test.ts`, `OmahaMathCoreIdentityFree.law.test.ts`, `OmahaMathCoreOffScopeNoWork.law.test.ts`, `OmahaMathCoreAcceptance.law.test.ts`, `OmahaMathCoreNutsEveryStreet.law.test.ts`, `OmahaMathCoreCoreFix1.law.test.ts`, `OmahaMathCoreEffOpp.law.test.ts`, `OpponentHud.law.test.ts`, `HorseReferenceDecisionSources.test.ts`, `HorseDataLedger.test.ts`.

## Replay

- Replay: NOT RUN (the audited-decision-replay scorer has no PLO4 cash flop audit set; evaluated by VERIFIER-10 sealed fresh-window symmetric M5 journal replays below)
- Symmetric M5 fresh-window replay 1 (`CRITERIA-CORE-LEAD4-PLO4-M5-FRESH.md` sha256 `73d6db2d`, pre-`#11690` `7097a917e304`, 1,470 untouched PLO4 hands `2026-11-20 20:36Z..2026-11-21 00:16Z`, 4,474 flop decisions, **VERIFIER-10 V288 EXACT CONFIRM**): `M1|total (R1=0.7984) n=173 +132.1 +/- 86.1 bb (z = +1.53) -> UNREADABLE` (power-limited; `HU z=+1.85`, 0 hurt classes, `core_arm_flags = {}`).
- Symmetric M5 fresh-window replay 2 (`CRITERIA-CORE-LEAD4-PLO4-3143-FRESH.md` sha256 `b1adb0ac4cfb`, combined post-`#11690` tree `f5e240d7e9bf`, 3,143 completely untouched PLO4 hands `2026-11-21 04:11Z..16:00Z`, 9,100 flop decisions, **VERIFIER-10 V318 EXACT 17/17 CONFIRM**): `M1|total (R1=0.7984) n=398 (380 hands) +273.6 +/- 72.1 bb (z = +3.79) -> HELPED` (`M4 +351.2 +/- 71.1 z=+4.94`, `M1_8695 +301.0 +/- 69.4 z=+4.34`), all 4 slices positive (`HU +262.1 z=+3.80`, `multiway +11.5 z=+0.53`, `Lightning +221.5 z=+3.94`, `table +52.1 z=+1.17`), zero hurt classes (`check->bet n=43 +102.8 z=+3.13 HELPED`, `fold->call n=41 +63.6 z=+3.05 HELPED`, `bet->check n=6 -4.8 z=-1.75`, `raise->raise size n=31 -5.6 z=-1.83`, `raise->call n=0`), `0` ungraded, `core_arm_flags = {}`.

## Evidence rows

- Mechanism, scope, identity-free boundary, off-scope zero work, release-default-OFF classification (`#11667`): **MET**.
- Realization calibration (`CRITERIA-CORE-EXTEND-PLO4-FLOP.md` sha256 `e8793e34`, `CRITERIA-CORE-EXTEND-4-PLO4-FLOP-RAISED-CALL-REALIZATION.md` sha256 `ad98efdc`): `0.7984 +/- 0.0187` (13,773 rows / 6,822 hands; check set `0.8449 +/- 0.0254`, `z = -1.48`) plus `plo4|flop|call|raised_own = 0.6762` (`n = 226`). Pinned in `OmahaMathCoreRealizationPinned.law.test.ts`.
- Learning-bench adversarial confirm (`CRITERIA-CORE-LEAD4-PLO4-FLOP-BENCH.md` sha256 `bde9c643b46b`, 28 cells across fresh seeds `20261207`/`20261208`, **VERIFIER-10 V287 EXACT CONFIRM**): 28/28 CTRL perfect zero (`0` parted, `0.00 +/- 0.00`), 28/28 Horse hard flags zero, 7/7 RULING-1 GUARD-POOLED PASS (`check_raise +0.02 z=+0.01`, `pot_stab_turn_river -7.90 z=-2.29`, `overfold_to_raises -7.69 z=-3.27`), 26/26 GUARD-CELL PASS (`max z=+2.09`), `ALL 28 IV -3.97 z=-2.93` (`plo4:hu IV -5.49 z=-3.50`), C1 HU `-4.36 +/- 5.53 z=-0.79` (strict `BENCH-NO-GAIN` on C1 alone; zero guard regressions).
- Untouched fresh-window 3,143-hand symmetric M5 real-hand grade (**VERIFIER-10 V318 EXACT CONFIRM**, `b1adb0ac4cfb`): `+273.6 +/- 72.1 bb (z = +3.79) -> HELPED`, 4/4 slices positive, 0 hurt classes, 0 flags: **MET**.
- Remaining activation preconditions: (1) merged & serving build on `engine.smarter.poker/health` descends from this PR, (2) VERIFIER-10 passes serving-build Rule 9 latency gate for `omahaMathCorePlo4Flop`, (3) live shadow/watched activation per lead authorization.
