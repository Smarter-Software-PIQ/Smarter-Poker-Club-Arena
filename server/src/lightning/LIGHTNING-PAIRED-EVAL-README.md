# Lightning paired evaluation harness

Measurement plumbing for the Lightning Horse programme. No production caller, no database, no writer. It answers one question: on the real Lightning contract, what does a candidate set of Horse decide options change, hand for hand, against the served baseline, in participation, in the quality of that participation and in bb/100.

## Files

| File                                     | Role                                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LightningPairedEval.test-support.ts`    | Pure: cells, arms, the declared `smoke` and `full` configurations, seed classes, paired statistics, report schema (`lightning-paired-eval/v1`), digest, markdown summary                                                   |
| `LightningPairedEvalArm.test-support.ts` | Plays one arm of one cell on the real `LightningHandHost` + `HandController`, every Horse decided by `HorseLogic.decide` on the snapshot the host builds with `buildLightningHorseSnapshot`, learning as the worker learns |
| `LightningPairedEval.test.ts`            | The pin (a null candidate makes zero divergent decisions; report schema) and the runner (only when `LIGHTNING_EVAL_CONFIG` is set)                                                                                         |

It is built on the fixture of the Lightning strength matrix (`testing/lightningHostTestKit.ts`, the one behind `aBrainChangeMustWinInLightning.law.test.ts`). The matrix itself and its laws are untouched.

## What is dealt

- Stakes 1/2 with a big-blind ante of one big blind (the Lightning contract), no straddle, 15 s clock.
- NLH, PLO4, PLO5; 4, 5 or 6 players; every seat 50, 100 or 200 bb.
- Rake: no override is passed, so the engine computes the published rake for the stake (`getFullRakeConfig`, no flop no drop, player-count caps). The rake configuration each cell actually ran on is recorded in the report (`cells[].rakeConfig`). The union rake scope is not set (the fixture has no club).
- A new table every hand: the measured Horse (the hero, one stable id) sits in the next seat each hand, so it rotates through every position; the other Horses are drawn per hand from a pool of 24 ids; scripted opponents rotate around the hero.

## Arms and pairing

An arm is a set of decide options spread over the baseline options (`decideOpts`), plus an optional `snapshotPatch` (for an input that would come from the host, until a producer exists), applied to the subject seats only: one rotating Horse (`scope: 'hero'`, default) or every Horse (`scope: 'all_horses'`, for fleet participation). Every other Horse plays the baseline options. The baseline of the declared configurations is the served configuration: the seven Hold'em style options read ON in production on 2026-11-14 (`LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114`; re-read the switch table before a selection or final run).

Both arms of a cell play the same hand indices. Per hand, the deck, the brain's jitter stream, the host's tempo stream and each scripted opponent's dice are functions of (seed, cell, hand index) only, so a divergence in one hand never shifts a later hand's cards or dice. Each arm starts on a fresh module graph (cold equity caches). What still differs between arms after a real divergence: the Horses' learned reads and the cache state, which is the treatment's own downstream effect plus noise, not bias.

The pin: with a candidate that changes nothing, every Horse decision and every accepted action is identical in both arms (`divergentDecisions` 0, `diffBB100` 0).

## Opponent fields (existing definitions, none redefined here)

| Field             | Definition                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `all_horse`       | every other seat a baseline Horse                                               |
| `station`         | `ExploiterLeague` `calling_station`                                             |
| `nit`             | `StyleReadLeagueField` `lp_tight` (tight-passive folder)                        |
| `tight_value`     | `StyleReadLeagueField` `lp_value_heavy_passive`                                 |
| `tag_regular`     | `ExploiterLeague` `reg_tag` (counter-exploitation)                              |
| `maniac`          | `ExploiterLeague` `maniac` (sustained)                                          |
| `gear_changer`    | `StyleReadLeagueField` `lp_time_shifter`                                        |
| `unknown`         | a baseline Horse sat as a person with a fresh id every hand (no history exists) |
| `three_bet_heavy` | `ExploiterLeague` `light_3bet` (counter-exploitation; `villains: 2` seats two)  |

Scripted opponents keep one id for the whole arm, so the Horses' reads on them build as they would on a person. They decide on a `LeagueSeatSpot` built from the host's public state and their own cards.

## What is reported (per cell, per arm, total and by position)

Definitions are embedded in every report (`definitions`).

- `hands`: hands dealt to a subject seat and settled. One dealt hand is one VPIP opportunity.
- `walks`: the subject was the big blind and everyone folded: no decision existed. Reported apart; the summary prints VPIP both ways (walks in, walks out of the denominator).
- `vpip`, `pfr`: voluntary preflop call / bet / raise / all-in; blind and ante posts and a big-blind check are not entries.
- `fastFolds`: folds released through the Lightning Fold door. A fast fold is a deliberate fold: it stays in the denominator.
- `firstInOpportunities`, `firstInRaise`, `firstInLimp`, `firstInFold`: unopened pot, subject not the big blind.
- `bigBlindByPrice`: the big blind's first priced answer by to-call / (pot + to-call), with how many answers were given at an early look (before the action reached it).
- Range quality: `entryStrengthSum` / `entryStrengthBins` and `flopStrengthSum` / `flopStrengthBins`: the brain's own preflop percentile of the hands that entered and of the hands that saw a flop (mean and quartile mix). A candidate that reaches a VPIP number by adding the bottom quartile shows here.
- `netBB`, and in `paired`: `baselineBB100`, `candidateBB100`, `diffBB100` with `seBB100` (per-hand paired differences) and `blockSeBB100` (orbit blocks).
- `tableRakeBBPer100`, `subjectRakeBBPer100`.
- `counters`: `illegalActions`, `illegalAmounts` (both must be 0), `policyFallbacks`, `decideThrows`, `unsettledHands`, `villainRejected`, `buttonMismatch`.
- `latencyMs`: p50 / p95 / p99 / max of the subject's `HorseLogic.decide` wall-clock. Machine dependent; excluded from the digest. No deadline is enforced offline.
- `digest`: sha256 of the report without latency. Same code, same configuration: same digest.

Reaching 40% VPIP is not a pass criterion. Read participation together with range quality, first-in shape by position, the big blind's answers by price, bb/100 and the counter-exploitation cells. The decision rule is in the evaluation protocol.

## Running

From `server/` (the suite refuses to start elsewhere), one process:

```
# the pin (about a minute on a quiet machine)
npx vitest run src/lightning/LightningPairedEval.test.ts

# the smoke configuration: 6 cells x 24 hands x 2 arms
LIGHTNING_EVAL_CONFIG=smoke LIGHTNING_EVAL_OUT=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"

# the full configuration, a slice of cells per process (memory), a candidate
LIGHTNING_EVAL_CONFIG=full LIGHTNING_EVAL_CELLS=0:10 \
  LIGHTNING_EVAL_CANDIDATE='{"someDefaultOffOption":true}' LIGHTNING_EVAL_OUT=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
```

`LIGHTNING_EVAL_OUT` receives `lightning-paired-eval-<config>-<candidate>[-cells-a-b].json` and `.md`. Without `LIGHTNING_EVAL_CANDIDATE` the runner plays the null candidate and requires zero divergent decisions.

The full configuration is 270 cells x 1,000 hands x 2 arms per seed. It is an evaluation job: on the shared Mac announce it in the coordination inbox, run one niced process, and never beside another lane's open gate.

## Seeds

`LIGHTNING_EVAL_SEEDS` declares three disjoint classes: development, selection, final. A configuration names its class and the runner refuses a seed of another class. Both declared configurations are development. Selection and final seeds are dealt only as the protocol says.

## Limits

- Offline: no real deadline, no worker lane, no database reads (durable opponent profiles are absent; reads come from the in-process mind only).
- Uniform stacks per cell; production tables mix 50 to 200 bb.
- Scripted opponents are finite caricatures; results against them are not predictions of profit against people.
- A candidate that needs a new host input is injected with `snapshotPatch` until its producer exists; after that it flows through the real `buildLightningHorseSnapshot` with no harness change.
- The arm file repeats about twenty lines of the strength matrix (`observeLikeTheWorker`), which that file does not export.
