# omahaMathCorePlo5Flop: authority for the live switch

Lanes COREWIRE-2 / CORE-POOLED-2 / CORE-POOLED-3, 2026-11-21 (PLO-OWNER lead-2, session 01UxDLnLPjcC14fSouoKnY5C). Evidence NOT MET: the option stays OFF (read `=== true`, no switch row). It acts only with `omahaMathCore` on (its companion) and only on PLO5 cash flop decisions. It is not switched on, shadow-staged or trialled until the core follow-up (latency, off-scope no-work, shadow-stage entry, worker warm-up) is merged and serving and VERIFIER re-measures on the serving build, the realization factors are re-measured on the shipped tree (CORE-AUDIT gap 4), and the declared grade CRITERIA-CORE-POOLED-2-SYM2 passes.

## What it does

With `omahaMathCore` on, the math core owns PLO5 cash flop decisions (table and Lightning; high only, one board, pot limit; never PLO4, PLO6, a tournament or a bomb pot): the action is the expected-value maximum over the legal actions, from public information and the hero's own cards only (see `omahaMathCore.md`). On any other street or game the core does no work for this flag (law `OmahaMathCoreOffScopeNoWork.law.test.ts`). Facing a wager with a call available it never folds the exact current nuts.

## Shadow stage

Listed in `OPTION_SHADOW_STAGE` (PLO5 flop, companion `omahaMathCore`): with a `shadow` row the staged re-decision runs after the answer is sent and never changes the acted decision. Inert until the registry gives the option `shadow` (its release default is still decided by code; a release-default-off classification with its switch-list migration comes first).

## Receipts

`decision.omahaMathCore` (core receipt: chosen action and amount, incoming decision as record, equity, prices, ranges, nut floor, timings).

## Tests

`OmahaMathCore.test.ts`, `OmahaMathCoreAcceptance.law.test.ts`, `OmahaMathCoreNutsEveryStreet.law.test.ts`, `OmahaMathCoreOffScopeNoWork.law.test.ts`, `OmahaMathCoreEvalMemo.law.test.ts`, `OmahaMathCoreEvalTable.law.test.ts`, `OmahaMathCoreEvalTwoPlusThree.law.test.ts`, `aStagedMathCoreFlopReDecidesOnlyPlo5Flop.test.ts`, the shadow stage law and the worker warm-up law.

## Latency

CRITERIA-CORE-POOLED-2-LATENCY as amended (CRITERIA-CORE-POOLED-3-LATENCY-AMEND, sha256 478264f0...31a5), head cc5240bce34, load 16.4: PLO5 flop added p50 11.5 / p95 26.5 / max 36.4 ms (met); cold 108.0 ms (met); decide over 100 ms 0 of 144 (met); decisions identical (met); off-scope p95 not resolvable by the harness (both-off control 3.7 ms); lead ruling: zero off-scope work proven structurally by the law, timing kept as a record. Those reps reuse the core's hand-street cache: on first encounter (as live) the PLO5 flop re-decision measured p50 ~23-25 ms, p95 30-54 ms at load 15-17.

## Replay

- Replay: NOT RUN (the audited replay scorer has no PLO5 cash flop audit set with person-live decisions; the exact journal replay grade is CRITERIA-CORE-POOLED-2-SYM2, waiting for at least five persons)

## Evidence rows

- Mechanism, scope, receipts, law tests, byte-identical off: MET.
- Value against people: NOT MET (CRITERIA-CORE-POOLED-2-SYM grade INSUFFICIENT: 11 person-live changes, 2 persons; SYM2 not yet replayable).
- Realization factors: re-measured from hand_history (lane CORE-POOLED-4, CRITERIA-CORE-POOLED-4-REALIZATION-AMENDMENT sha256 d7fbd6c8...1c79; placement note sha256 57bd475c...7e50): check 0.677, call 0.809, bet 0.809, raise 1.034; they multiply the action's flop-round showdown term only. The raise factor is the least certain: fit 1.034 +- 0.101 (n 232) against 0.847 +- 0.097 (n 125) on the Nov 18-20 check set; a factor above 1 never by itself turns a fold into a raise (the raise must beat the fold at its raw price). This is a measurement, not a value grade: Evidence stays NOT MET until the SYM2 grade.
- Raise factor unconfirmed; no activation. The raise cell's level awaits the full-window confirmation (CRITERIA-CORE-POOLED-4-REALIZATION-CONFIRMATION: every hand Oct 16 - Nov 16 and Nov 18-20, same estimator, the adoption rule applied once).
- Do not switch on.
