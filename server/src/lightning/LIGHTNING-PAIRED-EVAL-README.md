# Lightning paired evaluation harness

Measurement plumbing for the Lightning Horse programme. No production caller, no database, no writer. It answers one question: on the real Lightning contract, what does a candidate set of Horse decide options change, hand for hand, against the served baseline, in participation, in the quality of that participation and in bb/100.

## Files

| File                                         | Role                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LightningPairedEval.test-support.ts`        | Pure: cells, arms, the declared `smoke` and `full` configurations, seed classes, paired statistics, report schema (`lightning-paired-eval/v2`), the guards' arithmetic (G7 dry streaks, Q3, Q4, entry kinds, chip conservation), the pooled merge of paired hands, the mixed-stack draw (`stackMix`), the deadline arithmetic and its pooled G4 figure, digest, markdown summary |
| `LightningPairedEvalArm.test-support.ts`     | Plays one arm of one cell on the real `LightningHandHost` + `HandController`, every Horse decided by `HorseLogic.decide` on the snapshot the host builds with `buildLightningHorseSnapshot`, learning as the worker learns                                                                                                                                                       |
| `LightningPairedEvalRelease.test-support.ts` | Releases what a hand and an arm built: every `vi.fn` of the host fixture is entered in two process-wide vitest registries that nothing empties; the arm takes its own out after every hand, the caller around every arm (D10)                                                                                                                                                    |
| `LightningPairedEval.test.ts`                | The pin (a null candidate makes zero divergent decisions; report schema; the guards' arithmetic), the positive control, the runner (only when `LIGHTNING_EVAL_CONFIG` is set) and the merge (only when `LIGHTNING_EVAL_MERGE` is set)                                                                                                                                            |

It is built on the fixture of the Lightning strength matrix (`testing/lightningHostTestKit.ts`, the one behind `aBrainChangeMustWinInLightning.law.test.ts`). The matrix itself and its laws are untouched.

## What is dealt

- Stakes 1/2 with a big-blind ante of one big blind (the Lightning contract), no straddle, 15 s clock.
- NLH, PLO4, PLO5; 4, 5 or 6 players; every seat 50, 100 or 200 bb (a uniform cell, every declared smoke, full, selection and final cell), or, opt-in, every seat its own stack (a mixed cell, below).
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
- `latencyMs`: p50 / p95 / p99 / max of the subject's `HorseLogic.decide` wall-clock, and `deadline` (the production deadline, below). Machine dependent; excluded from the digest. The deadline is measured, and applied only in apply mode. (The `fallback` entry of `definitions` still says "No deadline is enforced offline": it is kept word for word because the definitions are part of the digest.)
- `digest`: sha256 of the report without latency (`cells[].latencyMs` and the pooled `latency`). Same code, same configuration: same digest.

- `latencyMs.deadline` per cell and arm, and the pooled `latency` of the report: the production decision deadline (below). Wall-clock: excluded from the digest.

### Pooled paired differences (G5, G6, P1)

One cell of 1,000 hands has a standard error of 32 to 71 bb/100 (verification report): a per-cell figure cannot carry G5. The runner therefore writes, beside the report, `<stem>.pairs.jsonl`: a header line (schema `lightning-paired-eval-pairs/v2`, configuration, seed class, candidate) and one line per paired hand: `seed`, `variant`, `players`, `stackBB`, `field`, `villains`, `counterExploit`, `h` (hand index), `b` and `c` (the subject's net of the hand in big blinds, baseline and candidate). `mergeLightningEvalPairs` (and the merge run below) pools the files of a directory across cells, seeds and cell-range files and reports, per variant, for `primary` (all_horse + unknown), `counter_exploit` (the counter-exploitation cells together) and every `field:<name>` by itself (`three_bet_heavy x2` apart): the pooled hands, cells and seeds behind the figure, baseline and candidate bb/100, `diffBB100`, the per-hand paired standard error, the orbit-block standard error, `seUsedBB100` (the larger) and `z`. A hand met twice (overlapping files) is refused, and so is a directory holding more than one candidate.

## Mixed stacks at one table (opt-in, development only)

A cell's `stackMix` is `uniform` (the default; absent means uniform) or `mixed`. In a mixed cell every seat draws its own starting stack, each hand, from `LIGHTNING_EVAL_MIXED_STACKS`: whole big blinds, uniform on [50, 200] (the Lightning buy-in range; the host's maximum buy-in reads 200 bb when the rules carry none). It is a declared development prior, not fitted to production: no production stack census was read. Mean 125 bb; each third of the range about a third of the seats.

- Pairing: the draw is a function of (seed, cell, hand, table slot) only, on its own stream (5), so both arms deal the same stacks (the runner refuses a pair whose stacks differ) and the deck, the host's tempo, the seat draw and every seat's dice are those of the cell's uniform twin (same variant, players, nominal `stackBB`, field, villains; `lightningEvalCellKey`). In a mixed cell `stackBB` names that twin and is not dealt.
- Recorded per subject hand: `stackBB` (own start) and `effectiveStackBB` (the smaller of its own and the deepest other seat's start, before blinds and antes); per hand `stacksBB` (every slot) and `engineStackMismatches` (seats whose settled start, stackAfter - won + contributed, is not the dealt stack; must be 0). A mixed cell's report carries `cells[].stacks` (seats dealt, effective-stack mean, range and bands, mismatches; in the digest); its paired rows carry `stackMix`, `heroStackBB`, `effectiveStackBB`; the merge pools mixed rows in their own groups (`primary (mixed stacks)`, ...). Only a report with a mixed cell carries `contract.mixedStacks` and `definitions.stackMix`.
- Configurations: `dev_mixed` (the declared matrix with the stack dimension replaced by the mixed draw: 90 cells x 1,000 hands, development seeds) and `dev_mixed_smoke` (the six smoke cells, mixed, 40 hands, seed 20261114). The smoke, full, selection and final configurations are unchanged byte for byte (a test pins their sha256) and their report digests are unchanged.

## The production decision deadline (G4)

A Lightning Horse decision is a FAST job on the live decision lane (`LightningHorse.ts` `decideLightningHorse`). Two deadlines apply:

- caller deadline: `horseDecisionDeadlineMs` (`engine/horseDecision/decisionDeadline.ts`): what is left of the turn clock less 1,500 ms, within [2,000, 30,000] ms, queue plus compute, from enqueue. The host passes it with every request; on the 15 s Lightning clock it is 13,500 ms (the harness reads the value the host passed);
- execution deadline: the worker client's `jobTimeoutMs`, 8,000 ms (`LiveHorseDecisionWorkerClient` default; the production lane passes none): compute alone, from dispatch; a job past it fails its worker shard.

On either, `decideLightningHorse` answers with the liveness answer: check, or fold facing a bet (`workerFallback`, think time 0); an early look that falls back is not "already folding" and waits for its turn.

The harness calls `HorseLogic.decide` in process: no queue, no worker thread, no IPC, no main-loop contention, the equity governor at full scale, on the measuring machine. So it MEASURES: per subject decision, the wall-clock against both deadlines (`latencyMs.deadline`: decisions, over the caller deadline, over the execution deadline, over either, the caller deadlines seen). A miss here is compute alone past a deadline: a lower bound on production misses, not an estimate of them. The report's `latency` pools a 1%-bin histogram per variant and over all variants: p50 / p95 / p99 (bin upper edges, at most 1% above the exact value, the same on both arms), exact max, misses and their share, the candidate / baseline ratios, and `g4WithinTenPercent` (both the p95 and the p99 ratio at most 1.10, protocol G4). Each run writes `<stem>.latency.jsonl` (a header and one row per cell); the merge pools those files too, so G4 is read on the pooled figure of a sliced matrix.

`LIGHTNING_EVAL_DEADLINE=apply` (default `measure`) also APPLIES it: a Horse decision, on any Horse seat, whose compute exceeds the deadline is answered through the host's own fallback path (the fake lane rejects the request as expired, the real `decideLightningHorse` plays check or fold). Wall-clock dependent: an apply run is not reproducible, its report says `deadlineMode: apply`, and the null candidate's zero-divergence check is not asserted. On the Mac decisions take milliseconds against an 8,000 ms deadline, so it is expected to change nothing; a test forces every decision to miss (`deadlineOverrideMs`, tests and sensitivity reads only) and sees only checks and folds, 0 illegal actions, chips conserved.

## Run it twice: not modelled, and it need not be

No Horse decision reads run it twice, and Lightning never runs it:

- the Lightning host builds every hand with `ritEnabled: false` ("OFF in Lightning: bomb pots, kill pots, straddles, run it twice, insurance", `server/src/lightning/LightningHandHost.ts:984` and `:988`). The pool option `run_it_n_times: 'opt_in'` (`supabase/migrations/20261023230001_classic_and_lightning_five_ready_waits_three_seconds_for_six.sql:129`, `20261024200548_plo5_one_two_madness_without_lightning.sql:124`) is declared only as an unread type field in `src/config/cashGames.ts:203` and is not read anywhere in `server/src` or `src/`;
- a Horse's only run-it-twice answer is `horseRunItTwiceRuns` (`server/src/engine/HorseRunItTwice.ts:57`), called only at `server/src/engine/ServerTableEngineRunout.ts:1972` inside `horseRitRuns` (`:1969`, invoked at `:1892` and `:2050`), after the betting has closed on the physical table engine. `HorseLogic.ts` and `LightningHorse.ts` (`buildLightningHorseSnapshot`) contain no run-it-twice field or read.

So run it twice could change only how the all-in pot is dealt out (the variance of the outcome), never a decision; each run is dealt from the same remaining deck, so the expected share of the pot is the same. Nothing is built for it.

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

# the full configuration, a slice of cells per process (to share the work), a candidate
LIGHTNING_EVAL_CONFIG=full LIGHTNING_EVAL_CELLS=0:10 \
  LIGHTNING_EVAL_CANDIDATE='{"someDefaultOffOption":true}' LIGHTNING_EVAL_OUT=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
```

The runner test carries its own timeout, which beats vitest's `--testTimeout` (so `--testTimeout=0` does not lift it): two hours by default. `LIGHTNING_EVAL_TIMEOUT_MS` sets it in milliseconds, `0` meaning no timeout; anything but a whole number is refused before the run starts. A long range in one process (for example a declared 90-cell card) needs it:

```
LIGHTNING_EVAL_TIMEOUT_MS=0 LIGHTNING_EVAL_CONFIG=switch LIGHTNING_EVAL_SWITCH=/path/to/card.json \
  LIGHTNING_EVAL_OUT=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
```

Staged runs (protocol section 7): `LIGHTNING_EVAL_CONFIG=selection` and `LIGHTNING_EVAL_CONFIG=final` deal the declared 270-cell matrix on their own seed class only (five seeds, 2,200 hands per cell and seed; the arithmetic is beside `LIGHTNING_EVAL_STAGE_HANDS_PER_CELL`). Slice with `LIGHTNING_EVAL_CELLS` and pool the slices with `LIGHTNING_EVAL_MERGE`. Selection seeds are dealt only by a frozen candidate; final seeds once.

`LIGHTNING_EVAL_OUT` receives `lightning-paired-eval-<config>-<candidate>[-cells-a-b][-deadline-apply].json`, `.md`, `.pairs.jsonl`, `.latency.jsonl` and `.complete.json`. Without `LIGHTNING_EVAL_CANDIDATE` the runner plays the null candidate and requires zero divergent decisions. The runner fails on any illegal action or amount (any Horse seat) and on any chip-conservation violation.

### A range in play is not a result

While a process plays its cell range the side files are `<stem>.pairs.jsonl.partial` and `<stem>.latency.jsonl.partial`, and `<stem>.running.json` names the process. Only when every (seed, cell) of the range has been played AND the run's checks have passed (no illegal action or amount, chips conserved, the null candidate's zero divergent decisions) are they renamed, and `<stem>.complete.json` is written last: the configuration, candidate, seeds, hands per cell, the cell range, every (seed, cell) unit with its row count, and the sha256 of both side files. The run prints one `[lightning-eval] COMPLETE` line. A process that dies or fails leaves `.partial` files and no marker.

The runner refuses to start, before writing anything, when:

- another range of the directory was left unfinished by a process that is gone (`STOP`: the queue ends at the first crash instead of playing on beside a hole). Play that range again (it replaces its own `.partial` files) or delete its `.running.json` and `.partial` files;
- another live process is playing the same stem;
- the stem already holds a result (move it away first).

A queue of ranges must also stop on the exit code; vitest exits non-zero when its worker dies:

```
for a in $(seq 0 4 24); do
  LIGHTNING_EVAL_CONFIG=switch LIGHTNING_EVAL_SWITCH=/path/to/card.json LIGHTNING_EVAL_CELLS=$a:$((a + 4)) \
    LIGHTNING_EVAL_OUT=/path/to/your/runs \
    npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared" || { echo "cells $a FAILED: stopping"; exit 1; }
done
```

The merge reads completed ranges only and refuses the directory unless they are the whole (seed, cell) set of ONE run: no `.partial` or `.running.json` left, every side file with its marker and the bytes the marker recorded (a file truncated or written to afterwards is refused), the same configuration, candidate, deadline mode, seeds and hands per cell in every range, no cell played twice, no cell missing. A directory written before the marker existed (2026-11-19) is refused too: merge it with the source that wrote it.

```
# pool the completed ranges of a directory (one candidate, every cell) and print the pooled figures
LIGHTNING_EVAL_MERGE=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "merges"
```

The merge writes `lightning-paired-eval-merged.json` and `.md` into that directory; when the directory holds `*.latency.jsonl` files (same candidate) it adds the pooled deadline and G4 figures (`latency`).

```
# mixed stacks: the small development smoke, then the matrix in slices
LIGHTNING_EVAL_CONFIG=dev_mixed_smoke LIGHTNING_EVAL_OUT=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
LIGHTNING_EVAL_CONFIG=dev_mixed LIGHTNING_EVAL_CELLS=0:10 LIGHTNING_EVAL_OUT=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"

# apply the production deadline (machine dependent; default measure)
LIGHTNING_EVAL_DEADLINE=apply LIGHTNING_EVAL_CONFIG=smoke LIGHTNING_EVAL_OUT=/path/to/your/runs \
  npx vitest run src/lightning/LightningPairedEval.test.ts -t "runs the declared"
```

The full configuration is 270 cells x 1,000 hands x 2 arms per seed. It is an evaluation job: on the shared Mac announce it in the coordination inbox, run one niced process, and never beside another lane's open gate.

## Switch cards on the live base (E1) and floored pools (E2), 2026-11-19

E1. `LIGHTNING_EVAL_CONFIG=switch LIGHTNING_EVAL_SWITCH=<card.json>` runs a leave-one-out switch card. The card names `flag`, optionally `candidateValue` (default: the opposite of the base's value) and `scope`, the base as production serves it (`base`, or `basePath` to a file: an option -> boolean map, `[option, boolean]` entries, an arms.json whose `b` arm is the base, or live switch rows `{option, state}`), `seeds`, `handsPerCell` and `cells`. The base is read by `benchmark/HorseSwitchArms.ts` (registered switches only, booleans, no off-only option on, plumbing keys such as `telemetry` dropped and recorded in `switchCard.ignored`) and replaces the frozen seven style options of 2026-11-14 as `baselineDecideOpts` for this card only; the candidate arm sets the one flag. Seeds come from the switch seed class, `LIGHTNING_EVAL_SWITCH_SEED_RANGE` (41,900,000 to 41,999,999), and a switch card refuses any other seed; the development, selection and final sets and every declared configuration are unchanged (their pins still hold). The report carries `switchCard` (flag, values, digest of the arms) and `definitions.switchCard`. `LIGHTNING_EVAL_CANDIDATE` is refused with a switch card.

E2. A cell may carry `floor: { vpipPct, windowHands, graceHands, rolling, feedSnapshot?, restartEveryHands? }`. Both arms' table rules then carry `nit_game`, `maintain_percent_min` and `maintain_hands`; every player keeps ONE pool session for the whole cell (unfloored cells keep the formation-slot sessions they always had); and each arm keeps its own pool ledger (`LightningEvalPoolLedger`: the judged figure over the last `windowHands` hands or the whole sitting, warnings, `graceHands` to recover, evictions). `cells[].pool.{baseline,candidate}` reports, per subject session, hands, entries, VPIP after 10 / 30 / 100 hands and at the end, hands judged under the floor, warnings, recoveries, evictions, and table totals. `feedSnapshot` hands every Horse the floor and its own figure (`gs.vpipFloor`, `vpipWindowHands`, `ownVpip`) as a physical table does, from a feed ledger cleared every `restartEveryHands` hands (an in-memory ledger lost at the hourly restart); without it the Horse snapshot is production's Lightning snapshot, which carries no floor. The floor is not part of the cell key: a floored cell deals the cards, seats and dice of its unfloored twin. E3 (the w44 limp-only floor options) needs that branch and is not built here.

## Seeds

`LIGHTNING_EVAL_SEEDS` declares three disjoint classes: development, selection, final. A configuration names its class and the runner refuses a seed of another class. Both declared configurations are development. Selection and final seeds are dealt only as the protocol says.

## Limits

- Offline: no worker lane, no database reads (durable opponent profiles are absent; reads come from the in-process mind only). The production deadline is measured against compute alone (a lower bound on production misses); queueing and main-loop contention are not modelled.
- Mixed stacks are opt-in (`dev_mixed`) and drawn from a declared prior, not from production's stack distribution; the declared smoke, full, selection and final configurations deal uniform stacks.
- Run it twice is not dealt; it cannot change a decision (section above).
- Scripted opponents are finite caricatures; results against them are not predictions of profit against people.
- A candidate that needs a new host input is injected with `snapshotPatch` until its producer exists; after that it flows through the real `buildLightningHorseSnapshot` with no harness change.
- A stateful candidate (window or deficit driven) cannot be expressed yet: `snapshotPatch` receives no hand index or subject history (verification D3, not addressed here).
- Known limit (D7): with one scripted seat the counter-exploitation fields did not measurably punish over-entry at 1,000 hands per cell in verification. Before trusting G5, show a known-bad candidate losing beyond 2 standard errors in the pooled counter-exploitation figure; the two-villain cells are the harder test.
- D10, closed 2026-11-19: memory no longer grows with the hands or the arms played. It was never the module graph by itself; two things kept every hand reachable. (1) The arm's error reporter was a `vi.fn`: a mock keeps the arguments of every call, the host reports one Error per hand (no journal identity without a database), and that Error's captured stack frames hold the hand's host: about 0.6 MB per hand, growing inside one arm. It is a plain function now. (2) Every `vi.fn` of the host fixture (about twenty per hand) stays in two process-wide vitest registries (`mocks` of @vitest/spy, `spies` of tinyspy) for the life of the process, each holding its hand's host and, through its closure, the module graph of its arm. The arm now takes its own out after every hand and the caller after every arm (`LightningPairedEvalRelease.test-support.ts`; a pin test holds the registries level across an arm, and the scope fails loudly if a vitest upgrade moves them). Measured (PLO4, 5 players, a switch card on the live base): 2 cells x 2 seeds x 200 hands peaked at 1,628 MB resident before and 734 MB after on the default heap; with the heap capped at 512 MB (`NODE_OPTIONS=--max-old-space-size=512`) one 2,200-hand cell (both arms) completes at 455 MB peak, and 24 arms in one process complete at 468 MB peak (heap in use 121 to 165 MB at every cell), where the old source ran out of the default heap inside its first 2,200-hand unit. What remains is one arm's module graph and what its Horses learn, not a function of the card's size. Each cell's line prints the process's resident set and heap. `LIGHTNING_EVAL_CELLS` remains, to share a card between processes, not to survive it.
- The positive control's option (`v8: false`) changes few decisions once every seat has its own random stream (one hand of 24 in its cell): it proves the wiring, not the harness's power.
- The arm file repeats about twenty lines of the strength matrix (`observeLikeTheWorker`), which that file does not export.
