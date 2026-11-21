# lightningEarlyFoldNeedsFoldThrough: authority for the live switch

**State: OFF in source (read `=== true`), switchable, no switch row cited here. Do not switch on from this file.** Evidence NOT MET: mechanism, scope, receipts, tests and off-identity are recorded, and the beyond-big-blind probe and a five-cell NLH 4-handed paired run are recorded; in the five-cell NLH 4-handed run the option lost 3.6 bb/100 on the primary fields (SE 1.6, z = -2.23) and added mostly first-in limps and bottom-quartile entries, the full 270-cell paired matrix has not been run, the replay on real audited decisions was not run, and no live read exists.

Written 2026-11-20 from what the repository records (sources named per section). Nothing was run for this file and no number in it was measured on 2026-11-20.

## What it does

Source: `docs/changelog/2026-11-15-a-lightning-early-fold-needs-the-fold-through.md`, `server/src/engine/HorseLightningFoldThrough.ts` (`lightningFoldThroughSeats`, `lightningFoldThroughFrame`), `server/src/engine/HorseLogic.ts` (`HorseLogic.decide` entry), `server/src/engine/HorseDataLedger.ts` (flag `lightningEarlyFoldNeedsFoldThrough`).

A Lightning Horse is asked an early look off its turn (`LightningHandHost.offerHorseEarlyLooks`), priced on the table as it stands while live seats before it on the street still have to act, and a fold there is final (the Lightning Fold door releases the seat). With this option on, in a Lightning cash decision (`gs.publicMemoryDomain?.speed === 'lightning'` and `gs.gameMode === 'cash'`) before the river (`preflop`, `flop`, `turn`) where the Horse owes chips with no free check:

- if the first decision answers `fold` (and is not owned by `omahaMathCore`) while live, not-all-in seats after the street's last full aggression (preflop with none: after the big blind) and before the Horse still have to act (`lightningFoldThroughSeats`), the policy is asked once more on the fold-through frame (`lightningFoldThroughFrame`);
- in the fold-through frame those seats are marked folded, their folds are appended to the street's `actionHistory`, and they leave every pot's `eligiblePlayers` list, using public state and the Horse's own cards only;
- the frame ask runs as a side ask with `observeMind: false`, `telemetry: false`, brain telemetry suspended and the first ask's style records kept, so the opponent model never learns the hypothetical folds and a frame failure is reported as `HorseLogic.lightning_fold_through_frame_threw` rather than `decide_threw`;
- if the frame also folds (or throws, or hits `policyFallback === 'brain_exception'`), the first answer is returned (`lightning_fold_through_kept`) and the early fold stands; otherwise the frame's answer is returned (`lightning_fold_through_released`), which the Lightning host treats as an early look that did not fold (the Horse waits for its own turn and decides afresh).

At the Horse's own turn no seat is before it, so nothing changes there. The river, Classic tables (`speed !== 'lightning'`) and tournaments are untouched.

Default OFF in source: only explicit `true` switches it on; off or unset, no second ask is made and every decision is byte-identical. It is a registered option of the Horse option switch (`server/src/engine/HorseOptionSwitch.ts`: owner `'Lightning'`, scope `'Lightning early folds before the river'`; not in `OPTION_SWITCH_OFF_ONLY`).

## The order it rests on

- 2026-10-24 (early-fold law, `LightningHorse.ts`): "YES, HORSES SHOULD FOLD RIGHT AWAY IF THEY WERE ALREADY FOLDING."
- 2026-11-17 14:34 America/Chicago and standing Lightning rules: a VPIP requirement is never met with strategically indefensible calls or raises.

No owner order to activate `lightningEarlyFoldNeedsFoldThrough` is recorded in the repository. It was built in the Lightning lane (`L-019`, 2026-11-15) after the beyond-big-blind probe (`PROBE-BEYOND-BB.md`).

## What it answers and what was measured

Source: `docs/changelog/2026-11-15-a-lightning-early-fold-needs-the-fold-through.md` and `docs/changelog/2026-11-20-plo8-first-in-authority-and-lightning-paired-runs.md`.

1. **Beyond-big-blind probe (2026-11-15, development seeds 20261114..20261116, all-Horse tables, 2,400 hands / 12,600 Horse seat-hands per variant):**
   - With the option off, the real-turn policy continued where the early fold had been final at: SB 2.85 / 10.31 / 8.29 VPIP points (NLH / PLO4 / PLO5), BTN 0.74 / 2.18 / 1.79, CO 0.57 / 1.12 / 1.03, HJ 0.32 / 0.87 / 1.07, flop 1.75 / 0.82 / 1.05 continuation points, turn 2.00 / 0.87 / 0.45.
   - With the option on for every Horse, residual loss dropped to: NLH SB 1.03, BTN 0.35, CO 0.24, HJ 0.16, flop 0.13, turn 0.16 (all remaining NLH loss is the double draw of a mixed answer because the frame ask draws fresh RNG jitter); PLO4 SB 2.52 (1.03 raise class, 1.49 folds-only double draw), BTN 1.06, CO 0.67, HJ 0.82; PLO5 SB 2.05, BTN 0.88, CO 0.69, HJ 0.61.
   - Hero-scope EV in the probe harness (one rotating Horse on vs off, 2,400 hero hands per variant, K=0): NLH +18.7 bb/100 (paired SE 10.5), PLO4 -2.8 bb/100 (SE 12.0; doubled to 4,800 hero hands: +17.0 bb/100, SE 9.7), PLO5 -7.1 bb/100 (SE 7.7) — none statistically significant at that sample.

2. **Paired Lightning evaluation, five NLH 4-handed cells (2026-11-20, `docs/changelog/2026-11-20-plo8-first-in-authority-and-lightning-paired-runs.md`):**
   - Run on configuration `full` (seeds 20261114, 20261115, 20261116; 1,000 hands per cell and seed), cells 0 (`nlh 4p 50bb all_horse`), 4 (`nlh 4p 50bb tag_regular`, counter), 7 (`nlh 4p 50bb unknown`), 10 (`nlh 4p 100bb all_horse`), 17 (`nlh 4p 100bb unknown`).
   - Primary fields (12,000 pooled hands, 12 cell-seed runs): baseline `-21.4 bb/100`, candidate `-25.0 bb/100`, diff **`-3.6 bb/100`** (`SE 1.6`, **`z = -2.23`**). Counter-exploit (`tag_regular`, 3,000 hands): diff `-2.8 bb/100` (`SE 3.8`, `z = -0.74`).
   - Entry quality in those ranges: VPIP rose 0.5 to 0.83 points per range, 40% to 75% of that gain was first-in limps (Q4: cell 0 limps +0.2 of +0.5; cell 4 +0.367 of +0.833; cell 7 +0.533 of +0.767; cell 10 +0.4 of +0.533; cell 17 +0.467 of +0.7), and the bottom-quartile share of entering hands rose in every range (Q3: 13.2 to 14.1, 12.9 to 14.4, 11.3 to 12.4, 12.0 to 13.1, 11.2 to 12.6 percent).
   - Why those limps and weaker entries occur in NLH:
     1. In `HorsePreflop.ts` (`decidePreflopV7`), an unopened small blind with `oppsLeft === 1` (`bvb`, blind-vs-blind when folded to) has a 75% SB limp mix down to `sbLimpFloor` (`0.22` or `gtoOpen.sbLimpFloor`). On the initial early look at the deal, seats before the SB have not folded yet, so `oppsLeft > 1` (`bvb` is false) and a weak SB hand folds; on the fold-through frame those seats are marked `is_folded: true`, so `oppsLeft === 1` (`bvb` is true), the fold-through frame returns `call` (an SB complete), the early fold is released, and when the table folds to the SB on its real turn the Horse completes (`firstInLimp`) with a bottom-quartile hand.
     2. In `HorseLogic.ts`, the fold-through frame ask runs without restoring the `fastRandom` stream position from before the first ask, so `decidePreflopV7Glue` draws a second independent `strengthJitter` (`fastRandom() * 0.06 - 0.03`) and mixed-strategy border hands get a second independent roll to survive the early look.

## Receipts

`lightning_fold_through_kept`, `lightning_fold_through_released`, `lightning_fold_through_math_core_owned` (`HorseDataLedger.ts`, source `'HorseLogic (lightningEarlyFoldNeedsFoldThrough)'`); ledger flag `lightningEarlyFoldNeedsFoldThrough`.

## Tests

- `server/src/engine/HorseLightningFoldThrough.test.ts` (11 unit tests: `lightningFoldThroughSeats`, `lightningFoldThroughFrame`, `HorseLogic.decide` with `lightningEarlyFoldNeedsFoldThrough`, side-ask isolation of telemetry, style records and error reporting).
- `server/src/lightning/anEarlyFoldNeedsTheFoldThrough.regression.test.ts` (6 host regression tests through `LightningHandHost` and `HorseLogic.decide`: button fold-through open, public-only frame, trash still fast-folds before UTG acts, flop early fold released when seat between can undo it, river early look unchanged, option off unchanged).
- Refused league matchup `nlh_lightning_early_fold_needs_fold_through` (`server/src/benchmark/HorseLeague.ts` `UNMEASURABLE_MATCHUPS`: the league deals no early look; 0 of 2,000 pairs diverged on seed 20261114).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests, off-identity: MET (sections above).
- Paired Lightning evaluation: NOT MET. Negative development signal in the five NLH 4-handed cells (`-3.6 bb/100`, `SE 1.6`, `z = -2.23`, 40-75% first-in limps); full 270-cell matrix not run.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.
- Value against people, live reach of the receipts: NOT MEASURED.

## What is still owed before this file may say the evidence is met

1. Resolve the NLH first-in limp / double-jitter mechanism (or scope/gate the fold-through release so it never releases an early fold for an unraised limp or a second random jitter draw) and pass the declared 270-cell paired Lightning evaluation (`LightningPairedEval.test.ts` full, selection and final seeds).
2. A declared PASS-BAR and a replay on real audited Lightning decisions, off against on, scored by `server/scripts/audited-decision-replay.ts --row` with `newlyWrong <= fixed`.
3. An explicit owner or lane-lead order to activate recorded verbatim in "The order it rests on", plus a live post-activation check and rollback trigger.

## What the activation row must contain

`option = 'lightningEarlyFoldNeedsFoldThrough'`, `state = 'on'`, note `authority: lightningEarlyFoldNeedsFoldThrough docs/horse-option-authority.d/lightningEarlyFoldNeedsFoldThrough.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`. Not before the items above are recorded here.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-20 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; the audited decision sets hold no early-look node record)
