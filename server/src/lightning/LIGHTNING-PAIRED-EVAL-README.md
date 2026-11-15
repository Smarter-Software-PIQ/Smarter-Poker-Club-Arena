# Lightning paired evaluation harness

Measurement plumbing for the Lightning Horse programme. No production caller, no database, no writer. It answers one question: on the real Lightning contract, what does a candidate set of Horse decide options change, hand for hand, against the served baseline, in participation, in the quality of that participation and in bb/100.

## Files

| File                                     | Role                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LightningPairedEval.test-support.ts`    | Pure: cells, arms, the declared `smoke` and `full` configurations, seed classes, paired statistics, report schema (`lightning-paired-eval/v2`), the guards' arithmetic (G7 dry streaks, Q3, Q4, entry kinds, chip conservation), the pooled merge of paired hands, digest, markdown summary |
| `LightningPairedEvalArm.test-support.ts` | Plays one arm of one cell on the real `LightningHandHost` + `HandController`, every Horse decided by `HorseLogic.decide` on the snapshot the host builds with `buildLightningHorseSnapshot`, learning as the worker learns                                                                  |
| `LightningPairedEval.test.ts`            | The pin (a null candidate makes zero divergent decisions; report schema; the guards' arithmetic), the positive control, the runner (only when `LIGHTNING_EVAL_CONFIG` is set) and the merge (only when `LIGHTNING_EVAL_MERGE` is set)                                                       |

It is built on the fixture of the Lightning strength matrix (`testing/lightningHostTestKit.ts`, the one behind `aBrainChangeMustWinInLightning.law.test.ts`). The matrix itself and its laws are untouched.

## What is dealt

- Stakes 1/2 with a big-blind ante of one big blind (the Lightning contract), no straddle, 15 s clock.
- NLH, PLO4, PLO5; 4, 5 or 6 players; every seat 50, 100 or 200 bb.
- Rake: no override is passed, so the engine computes the published rake for the stake (`getFullRakeConfig`, no flop no drop, player-count caps). The rake configuration each cell actually ran on is recorded in the report (`cells[].rakeConfig`). The union rake scope is not set (the fixture has no club).
- Jackpot fee: the engine also takes its bad-beat-jackpot fee (the settlement's `bbj`; 0.25 bb on a hand that sees a flop in the verification runs). It is not rake and is reported beside it.
- A new table every hand: the measured Horse (the hero, one stable id) sits in the next seat each hand, so it rotates through every position; the other Horses are drawn per hand from a pool of 24 ids; scripted opponents rotate around the hero.

## Arms and pairing

An arm is a set of decide options spread over the baseline options (`decideOpts`), plus an optional `snapshotPatch` (for an input that would come from the host, until a producer exists), applied to the subject seats only: one rotating Horse (`scope: 'hero'`, default) or every Horse (`scope: 'all_horses'`, for fleet participation). Every other Horse plays the baseline options. The baseline of the declared configurations is the served configuration: the seven Hold'em style options read ON in production on 2026-11-14 (`LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114`; re-read the switch table before a selection or final run).

Both arms of a cell play the same hand indices. Per hand, the deck, the host's tempo stream and each scripted opponent's dice are functions of (seed, cell, hand index) only, so a divergence in one hand never shifts a later hand's cards or dice. The brain's jitter is one stream per (seed, cell, hand, Horse seat, that seat's decision index): a subject that draws more or fewer random numbers does not re-roll any other seat's decision, or its own later ones. Each arm starts on a fresh module graph (cold equity caches).

"The same opponents" means the same opponent definitions, ids, seats and dice, not the same opponent state. Each arm is its own playthrough: the Horses' reads (`HorseMind`, winner reads) accumulate per arm, so after the first divergent hand the Horses of the two arms hold different reads on the hero and on each other, and the equity caches differ. That is part of the treatment (a pool that adapts to the candidate) plus noise, not bias; it is why later hands can differ before the subject acts.

The pin: with a candidate that changes nothing, every Horse decision and every accepted action is identical in both arms (`divergentDecisions` 0, `diffBB100` 0). The same holds for a candidate that only consumes extra random numbers.

The positive control: with an option known to change decisions (`{"v8": false}` in the smoke cell plo5 6p 50bb three_bet_heavy x2), the subject's decisions diverge (`subjectDivergentDecisions` > 0), the first decision that differs is the subject's own (`firstDivergenceBySubject`), and every other Horse's decision made before the subject has decided anything is identical up to and including the first divergent hand (`preSubjectNonSubjectDivergent` 0 of `preSubjectNonSubjectCompared`). The report records the option keys `HorseLogic.decide` really received: `counters.subjectDecideOptionKeys`, `counters.nonSubjectDecideOptionKeys` per arm, and their union in `candidateArm`.

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
- `vpip`, `pfr`: voluntary preflop call / bet / raise / all-in; blind and ante posts and a big-blind check are not entries. For `pfr` an all-in counts only when the engine marked it a full raise (`isFullRaise === true`).
- `entryKinds`: every entry has exactly one kind, set by the subject's first entering action among the accepted actions: `firstInRaise`, `firstInLimp`, `coldCall`, `overLimp`, `threeBetPlus`, `bigBlindCall`, `bigBlindRaise` (the big blind facing a price), plus `isoRaise` (a raise over limpers) and `bigBlindUnpricedRaise` (the big blind raising its free option) so that the kinds sum to `vpip`. Per arm, total and by position.
- Q3 (`q3`, `q3ByPosition`, and `pooled.*.q3`): `bottomQuartileSharePct` of entering hands, `meanEntryPercentile`, and the same for hands that see a flop.
- Q4 (`cells[].q4`, `pooled.q4`): `vpipGainPoints` (candidate minus baseline, points of hands dealt), `intendedGainPoints` (first-in raises + priced big-blind calls and raises), `intendedSharePct` (null when VPIP did not rise), `gainPointsByKind`.
- G7 (`dryStreak` per arm, `pooled.*.dryStreak`): per subject id, walks left out: `opportunities`, `entries`, `entryRatePct` (overall), `handsAfterDryStreak` (hands that follow 5 or more consecutive non-entries), `entriesAfterDryStreak`, `entryRateAfterDryStreakPct`, and `dryStreaks` (how many runs reached 5). Read the after-streak rate against the overall rate, with the counts: a candidate with almost no dry streaks left cannot be read by the rate alone, so compare `dryStreaks` between the arms too.
- `fastFolds`: folds released through the Lightning Fold door. A fast fold is a deliberate fold: it stays in the denominator.
- `firstInOpportunities`, `firstInRaise`, `firstInLimp`, `firstInFold`: unopened pot, subject not the big blind.
- `bigBlindByPrice`: the big blind's first priced answer by to-call / (pot + to-call), with how many answers were given at an early look (before the action reached it).
- Range quality: `entryStrengthSum` / `entryStrengthBins` and `flopStrengthSum` / `flopStrengthBins`: the brain's own preflop percentile of the hands that entered and of the hands that saw a flop (mean and quartile mix). A candidate that reaches a VPIP number by adding the bottom quartile shows here.
- `netBB`, and in `paired`: `baselineBB100`, `candidateBB100`, `diffBB100` with `seBB100` (per-hand paired differences) and `blockSeBB100` (orbit blocks).
- Drop: `tableRakeBBPer100` (all rake of the cell) and `tableJackpotFeeBBPer100` (the jackpot fee, beside it); `subjectRakeBBPer100` (rake of the pots the subject WON, by its share of the winnings: not a per-seat share); `subjectRakeShareBBPer100` (the per-seat figure: each hand's rake times the subject's share of the chips contributed to that hand) and `subjectJackpotFeeShareBBPer100` (the same for the fee). Whether a production "rake paid" figure includes the fee must be checked before comparing.
- `counters`: `illegalActions`, `illegalAmounts` (every Horse seat; `subjectIllegalActions`, `subjectIllegalAmounts` are the subject's part; all must be 0), `conservationViolations` (settled hands where sum(won) + rake + jackpot fee is not sum(contributed); must be 0, the runner fails otherwise), `policyFallbacks`, `decideThrows`, `unsettledHands`, `villainRejected`, `buttonMismatch`.
- `latencyMs`: p50 / p95 / p99 / max of the subject's `HorseLogic.decide` wall-clock. Machine dependent; excluded from the digest. No deadline is enforced offline.
- `digest`: sha256 of the report without latency. Same code, same configuration: same digest.

### Pooled paired differences (G5, G6, P1)

One cell of 1,000 hands has a standard error of 32 to 71 bb/100 (verification report): a per-cell figure cannot carry G5. The runner therefore writes, beside the report, `<stem>.pairs.jsonl`: a header line (schema `lightning-paired-eval-pairs/v2`, configuration, seed class, candidate) and one line per paired hand: `seed`, `variant`, `players`, `stackBB`, `field`, `villains`, `counterExploit`, `h` (hand index), `b` and `c` (the subject's net of the hand in big blinds, baseline and candidate). `mergeLightningEvalPairs` (and the merge run below) pools the files of a directory across cells, seeds and cell-range files and reports, per variant, for `primary` (all_horse + unknown), `counter_exploit` (the counter-exploitation cells together) and every `field:<name>` by itself (`three_bet_heavy x2` apart): the pooled hands, cells and seeds behind the figure, baseline and candidate bb/100, `diffBB100`, the per-hand paired standard error, the orbit-block standard error, `seUsedBB100` (the larger) and `z`. A hand met twice (overlapping files) is refused, and so is a directory holding more than one candidate.

### Fidelity

Fidelity against production is judged per table size (or on a mix weighted like production): the production by-position figures pool 4-, 5- and 6-handed tables, and a 6-player cell alone reads low against them (verification report, section 4).

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

`LIGHTNING_EVAL_OUT` receives `lightning-paired-eval-<config>-<candidate>[-cells-a-b].json`, `.md` and `.pairs.jsonl`. Without `LIGHTNING_EVAL_CANDIDATE` the runner plays the null candidate and requires zero divergent decisions. The runner fails on any illegal action or amount (any Horse seat) and on any chip-conservation violation.

```
# pool every *.pairs.jsonl of a directory (one candidate) and print the pooled figures
LIGHTNING_EVAL_MERGE=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "merges"
```

The merge writes `lightning-paired-eval-merged.json` and `.md` into that directory.

The full configuration is 270 cells x 1,000 hands x 2 arms per seed. It is an evaluation job: on the shared Mac announce it in the coordination inbox, run one niced process, and never beside another lane's open gate.

## Seeds

`LIGHTNING_EVAL_SEEDS` declares three disjoint classes: development, selection, final. A configuration names its class and the runner refuses a seed of another class. Both declared configurations are development. Selection and final seeds are dealt only as the protocol says.

## Limits

- Offline: no real deadline, no worker lane, no database reads (durable opponent profiles are absent; reads come from the in-process mind only).
- Uniform stacks per cell; production tables mix 50 to 200 bb.
- Scripted opponents are finite caricatures; results against them are not predictions of profit against people.
- A candidate that needs a new host input is injected with `snapshotPatch` until its producer exists; after that it flows through the real `buildLightningHorseSnapshot` with no harness change.
- A stateful candidate (window or deficit driven) cannot be expressed yet: `snapshotPatch` receives no hand index or subject history (verification D3, not addressed here).
- Known limit (D7): with one scripted seat the counter-exploitation fields did not measurably punish over-entry at 1,000 hands per cell in verification. Before trusting G5, show a known-bad candidate losing beyond 2 standard errors in the pooled counter-exploitation figure; the two-villain cells are the harder test.
- Known limit (D10): every arm loads a fresh module graph, so memory grows with the arms played in one process. Run a few cells per process (`LIGHTNING_EVAL_CELLS`) and merge the side files; the verifier's instrumented runs reached 4 GB after about 13 arms (unverified on the plain runner).
- The positive control's option (`v8: false`) changes few decisions once every seat has its own random stream (one hand of 24 in its cell): it proves the wiring, not the harness's power.
- The arm file repeats about twenty lines of the strength matrix (`observeLikeTheWorker`), which that file does not export.
