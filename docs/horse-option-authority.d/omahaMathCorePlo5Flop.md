# omahaMathCorePlo5Flop: authority for the live switch

**State: LIVE ON** in production since `2026-11-24T14:31:17Z` (`audit #196`, after a clean live shadow from 13:28:48Z, audit #195; it changes no decision while its companion `omahaMathCore` is off; see "Live switch, 2026-11-24" at the end). Lanes COREWIRE-2 / CORE-POOLED-2..10 / core-repair (PLO-OWNER lead-4, session e9eba0f6-2586-4b5f-bc3d-d9932c36084e), updated 2026-11-21. Evidence NOT MET until serving-build Rule 9 latency re-measure passes on a build descending from `baaf700b5ed9`: the option remains default OFF (release-default-off in `OPTION_SWITCH_RELEASE_DEFAULT_OFF` via LIST TRAIN `#11667`). It acts only with `omahaMathCore` on (its companion) and only on PLO5 cash flop decisions. All offline empirical evidence below is VERIFIER-10 sealed (V274, V281, V283, V284, V289, V291, V295, V301); live `shadow` staging (>= 60 min) and two-step watched activation wait strictly on (1) a serving build descending from `baaf700b5ed9` (`#11678` + `#11683` + `#11690`) and (2) VERIFIER-10 passing the Rule 9 serving-build latency re-measure on that build.

## What it does

With `omahaMathCore` on, the math core owns PLO5 cash flop decisions (table and Lightning; high only, one board, pot limit; never PLO4, PLO6, a tournament or a bomb pot): the action is the expected-value maximum over the legal actions, from public information and the hero's own cards only (see `omahaMathCore.md`). On any other street or game the core does no work for this flag (law `OmahaMathCoreOffScopeNoWork.law.test.ts`). Facing a wager with a call available it never folds the exact current nuts.

## Shadow stage

Listed in `OPTION_SHADOW_STAGE` (PLO5 flop, companion `omahaMathCore`) and classified in `OPTION_SWITCH_RELEASE_DEFAULT_OFF` (`#11667`, live on production since `c2d6e45e3bcc`): with a `shadow` row the staged re-decision runs after the answer is sent and never changes the acted decision, subject to the latency circuit breaker.

## Receipts

`decision.omahaMathCore` (core receipt: chosen action and amount, incoming decision as record, equity, prices, ranges, nut floor, timings) plus live fallback telemetry counters `omaha_math_core_fallback_{core_error,value_search_error,equity_collision,tracker_failure}` (`#11683`).

## Tests

`OmahaMathCore.test.ts`, `OmahaMathCoreAcceptance.law.test.ts`, `OmahaMathCoreNutsEveryStreet.law.test.ts`, `OmahaMathCoreOffScopeNoWork.law.test.ts`, `OmahaMathCoreEvalMemo.law.test.ts`, `OmahaMathCoreEvalTable.law.test.ts`, `OmahaMathCoreEvalTwoPlusThree.law.test.ts`, `OmahaMathCoreRealizationPinned.law.test.ts`, `OmahaMathCoreCallCapped.law.test.ts`, `OmahaMathCoreBoundedEdges.law.test.ts`, `OmahaMathCoreTrapRate.test.ts`, `OmahaMathCoreCheckRaise.test.ts`, `OmahaMathCoreCoreFix1.law.test.ts`, `OmahaMathCoreEffOpp.law.test.ts`, `aStagedMathCoreFlopReDecidesOnlyPlo5Flop.test.ts`, the shadow stage law, and the worker warm-up law.

## Latency

- Local pre-ship baseline (`CRITERIA-CORE-POOLED-2-LATENCY` / `CRITERIA-CORE-POOLED-3-LATENCY-AMEND` sha256 `478264f0...31a5`, head `cc5240bce34`, load 16.4): PLO5 flop added p50 11.5 / p95 26.5 / max 36.4 ms; cold 108.0 ms; >100 ms 0/144; decisions identical.
- Serving-build PR-2 latency gate (`V291 CONFIRM`, `run-serve-lat.sh` on live serving `c2d6e45e3bcc8447168c3aa7e76fbb1fbd16f0aa`, 3 runs `a/b/c`, `n=384` each, load 14.1–17.4): **PASS** — added `p50 = 21.1–21.3 ms (< 25)`, `p95 = 35.1–36.3 ms (< 60)`, `0 / 384` repeatable `> 100 ms` (`ON>100`: `0`, `0`, `1` non-repeatable across 1,152 readings).
- Post-`#11683` serving-build re-measure (Rule 9): **REQUIRED** on the serving build descending from `baaf700b5ed9` (because `#11683` updated per-call equity draws via `omahaMathCoreCallDraws`) before any `shadow` or `on` row is written.

## Prior anchor

NOT MET: the street flag acts only through the core, whose response cells are pooled public play that is 83% Horses (see `omahaMathCore.md`, "Prior anchor").

## Grade 2026-11-26 (With omahaMathCore)

The master switch with this flag on is graded in `omahaMathCore.md` ("What Was Measured (Grade 2026-11-26, Lead-7 Lane Grading)"): league PLO5 heads-up and 6-max and the probes show no significant chip change, the real-hand replay is met (committed scorer 43 fixed / 4 newly wrong; audit EV table 58 / 0; 0 protected strengths broken), speed p95 9.8 ms but maximum 45.4 ms, prior anchor not met. Verdict: not ready for live shadow of the master. The live shadow numbers are reconciled there (727 re-decisions / 21.3% on `735299cd`, 284 / 7.4% on `6c6aaa77`; "1,018 / 17%" pooled both). Its replay row below is arm A of that grade (omahaMathCore on with this flag on, the only arm in which this flag acts).

Correction (2026-11-26): with bet resizes scored on the EV interpolated between the audit's pot points, the audit EV table reads 52 fixed / 2 newly wrong (was 58 / 0); 0 strengths broken; verdict unchanged.

## Replay

- Replay: fixed 43; newlyWrong 4; changed 68; unchanged 5159; unjudged 15; set PLO audit tier A (cards shown) PLO4/PLO5 cash 2026-11-20..25; scorer 5302af2ab3e; source placed verdict-only; arm A vs off; replayed 5227 of 5227
- Symmetric M5 fresh-window replay 1 (`CRITERIA-CORE-POOLED-8-HORSE-M5-FRESH` sha256 `d9d319d2`, `50f2951cb8e` = `#11678`, 1,695 untouched PLO5 hands `2026-11-21 04:11Z..16:00Z`, 5,847 flop decisions, **VERIFIER-10 V274 EXACT CONFIRM**): `M1|total n=456 (414 hands) +831.1 ± 192.9 bb (z = +4.31) -> HELPED` (`M4 +885.8 z=+4.76`), all 4 slices positive (`HU +643.9 z=+4.50`, `multiway +187.2 z=+1.45`, `table +604.8 z=+3.43`, `Lightning +226.3 z=+2.91`), `fold->call n=44 +88.9 ± 45.5 (z=+1.95)` NOT HURT, `own-wager-raised n=0`, `core_arm_flags = {}`.
- Symmetric M5 fresh-window replay 2 (`CRITERIA-CORE-LEAD4-PLO5-COMBINED-FRESH` sha256 `df0f209a`, `baaf700b5ed9` = `#11644` + `#11678` + `#11683` + `#11690`, 2,109 completely untouched PLO5 hands `2026-11-21 16:00Z..2026-11-22 00:30Z`, 6,659 flop decisions, **VERIFIER-10 V301 EXACT CONFIRM**): `M1|total n=452 (407 hands) +765.6 ± 196.7 bb (z = +3.89) -> HELPED` (`M4 +918.7 z=+4.67`), all 4 slices positive (`HU +512.3 z=+4.75`, `multiway +253.3 z=+1.53`, `table +582.9 z=+3.47`, `Lightning +182.8 z=+1.79`), `bet->check` CURED (`n=11 +9.5 ± 10.7 z=+0.89`), `fold->call` `HELPED` (`n=36 +76.0 ± 35.9 z=+2.12`), `check->bet` `HELPED` (`n=111 +374.2 ± 49.3 z=+7.60`), `raise->call n=0`, zero hurt classes, `core_arm_flags = {}`.

## Evidence rows

- Mechanism, scope, receipts, law tests, byte-identical off, release-default-OFF classification (`#11667`): **MET**.
- Merged dark code stack on `main`: PR-2 `#11644` (`4bc4f783c37b`, live on `c2d6e45e3bcc`), B1 repair `#11678` (`5e85d1508c6a`, **V284**), `CORE-FIX-1` `#11683` (`72c860e84c89`, **V289**), and `effOpp` multiway fix `#11690` (`baaf700b5ed9`, **V295**).
- Realization factors: measured from `hand_history` on the FULL window (`CRITERIA-CORE-POOLED-4-REALIZATION-AMENDMENT` sha256 `d7fbd6c8...1c79`, `CRITERIA-CORE-POOLED-4-REALIZATION-CONFIRMATION` sha256 `0eb833be...0d44`, `CRITERIA-CORE-POOLED-7-PLO5-FLOP-RAISED-CALL-REALIZATION` sha256 `ae1fcd66...1418`): `check 0.6263`, `call 0.8979`, `bet 0.9075`, `raise 0.8184`, `call|raised_own 0.8125`. Pinned by `OmahaMathCoreRealizationPinned.law.test.ts`.
- Main-harness adversarial sparring bench (`50f2951cb8e` = `#11678`, 60 cells across fresh seeds `20261205` & `20261206`, **VERIFIER-10 V281 + V283 EXACT CONFIRM**): **UNANIMOUS PASS** under both IV and HW — 60/60 CTRL (OFF-vs-OFF) perfect zero, 60/60 Horse hard flags zero, `29,100` CAND flipped hands, 12/12 RULING-1 GUARD-POOLED PASS (`pot_stab_turn_river -8.12 z=-0.94`, `check_raise -11.60 z=-1.31`, max `z=+1.14 <= 2.19`), 60/60 GUARD-CELL PASS (`max z=+2.04`), AM1 `plo5:6:100` (`20261206`) IV `-19.66 ± 7.02 (z=-2.80)` & HW `-19.79 ± 13.59 (z=-1.46)` (`max cell z=+0.35`), all 60 cells IV `-6.00 ± 2.53 (z=-2.37)` / HW `-2.24 ± 4.29 (z=-0.52)`.
- Two independent fresh-window symmetric M5 replays (**V274** `+831.1 z=+4.31` and **V301** `+765.6 z=+3.89` on combined `baaf700b5ed9`, zero hurt classes, zero flags): **MET**.
- Remaining activation preconditions (per `CORE-ACTIVATION-PACKET.md` v7): (1) serving build on `engine.smarter.poker/health` descends from `baaf700b5ed9`, (2) VERIFIER-10 passes the Rule 9 serving-build latency re-measure on that build, (3) >= 60 min live `shadow` row with 0 breaker trips / 0 errors / 0 refusals, followed by lead-only two-step activation (`omahaMathCorePlo5Flop on`, then `omahaMathCore on` >= 60 min later) with live rollback triggers active.

## Live switch, 2026-11-24: shadow (audit #195), then on (audit #196)

2026-11-24: set to `shadow` at `2026-11-24T13:28:48Z` (audit #195, PLO-OWNER lead-6 Phase 4: live shadow of at least 60 minutes on serving `6c6aaa7707ac`, watch-only), then `on` at `2026-11-24T14:31:17Z` (audit #196, evidence id 80; picked up by 8 worker reports at +91 s on `6c6aaa7707ac`). Why: the shadow came back clean on its pre-declared check (`VERDICT=CLEAN`: 284 shadow re-decisions, 0 against people, 7.39% disagreement, breaker 0, failures 0, acted leaks 0, errors 0, PLO5 decisions over 100 ms 0.00%; run log `/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead6-01BNteGX/mc-on.exec.log`). The earlier shadow (audit #189, 2026-11-23T04:33:19Z on `735299cd5fda`) had been rolled back on its trigger at 2026-11-23T08:06:52Z (audit #190: one re-decision of 195.8 ms after 727 clean ones averaging 16.8 ms; acted 0, errors 0); the serving build now carries the pause-aware breaker (#11849) and the Math Core audit fixes (#11799 boot warm-up) that answer it. The street flag is inert while `omahaMathCore` is off (no switch row; read `=== true`; `server/src/engine/HorseOptionSwitch.ts` states that alone it changes no decision), so this write changes no Horse decision today. The on row cites this file at sha256 `86eddfeb...` (the revision before this note and the State line).
