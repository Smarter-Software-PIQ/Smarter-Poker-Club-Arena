# lightningEarlyFoldNeedsFoldThrough: authority for the live switch

**State: OFF in source (read `=== true`), switchable, no switch row cited here. Do not switch on from this file.** Evidence NOT MET: mechanism, scope, receipts, tests and off-identity are recorded. The declared 90-cell NLH half of the paired Lightning matrix on the fixed code (`#11623`, `8f854361a0`, 2026-11-21, seed `41987143`, 198,000 paired hands) did NOT show harm: primary fields `-1.2 +/- 0.8 bb/100` (`z = -1.46`), every G5/G6 guard group above `-2` standard errors, and G1, G2, G3, G4, G7 and G9 all hold. The `#11623` source fix cut the Q3 bottom-quartile entry rise from `+1.082` points to `+0.043` points (`9.903% -> 9.946%`, meeting the Q3 target) and raised Q4 intended share from `45.1%` to `63.74%` (`firstInLimp +0.010`, `overLimp 0.000`, `coldCall +0.143`, just under the `66.7%` target). However, it still shows no primary gain (`field:all_horse` `-1.8 +/- 0.8`, `z = -2.37`), PLO4 and PLO5 (`180` cells) are not run, the replay on real audited decisions is not run, and no live read exists. The earlier pre-fix NLH half (seed `41960321`, `+0.4 +/- 1.2`, `z +0.37`, Q4 `45.1%`, Q3 `+1.08` pts) and five-cell development reading (`-3.6`, `z -2.23`) are preserved below.

Written 2026-11-20 from what the repository records (sources named per section). Nothing was run for this file and no number in it was measured on 2026-11-20.

## What it does

Source: `docs/changelog/2026-11-15-a-lightning-early-fold-needs-the-fold-through.md`, `server/src/engine/HorseLightningFoldThrough.ts` (`lightningFoldThroughSeats`, `lightningFoldThroughFrame`), `server/src/engine/HorseLogic.ts` (`HorseLogic.decide` entry), `server/src/engine/HorseDataLedger.ts` (flag `lightningEarlyFoldNeedsFoldThrough`).

A Lightning Horse is asked an early look off its turn (`LightningHandHost.offerHorseEarlyLooks`), priced on the table as it stands while live seats before it on the street still have to act, and a fold there is final (the Lightning Fold door releases the seat). With this option on, in a Lightning cash decision (`gs.publicMemoryDomain?.speed === 'lightning'` and `gs.gameMode === 'cash'`) before the river (`preflop`, `flop`, `turn`) where the Horse owes chips with no free check:

- if the first decision answers `fold` (and is not owned by `omahaMathCore`) while live, not-all-in seats after the street's last full aggression (preflop with none: after the big blind) and before the Horse still have to act (`lightningFoldThroughSeats`), the policy is asked once more on the fold-through frame (`lightningFoldThroughFrame`);
- in the fold-through frame those seats are marked folded, their folds are appended to the street's `actionHistory`, and they leave every pot's `eligiblePlayers` list, using public state and the Horse's own cards only;
- the frame ask replays the strategy stream (`fastRandom`) from the position before the first ask, and the stream is restored to where the first ask left it afterwards (since 2026-11-21);
- the frame ask runs as a side ask with `observeMind: false`, `telemetry: false`, brain telemetry suspended and the first ask's style records kept, so the opponent model never learns the hypothetical folds and a frame failure is reported as `HorseLogic.lightning_fold_through_frame_threw` rather than `decide_threw`;
- if the frame also folds (or throws, or hits `policyFallback === 'brain_exception'`), the first answer is returned (`lightning_fold_through_kept`) and the early fold stands; if the frame's only answer is a preflop call into a street with no voluntary aggression (an unraised limp or small-blind complete) without a Lightning cheap entry branch, the first answer is returned too (`lightning_fold_through_limp_kept`, since 2026-11-21); otherwise the frame's answer is returned (`lightning_fold_through_released`), which the Lightning host treats as an early look that did not fold (the Horse waits for its own turn and decides afresh).

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

3. **Declared paired Lightning evaluation, NLH half of the matrix (2026-11-21, coordinator session_01Gw7aDtgw51ks82iZdeEMVr, handoff item P2.8):**
   - Pre-run declaration `DECLARATION-EFNFT-NLH90.md` (sha256 `04c0b04df2b3febb229cd3b00ac85b0cb0b8af915a6671d71d9912e5495d1056`, written 08:31:44Z before any hand) and `DECLARATION-AMENDMENT-1.md` (written 11:03:44Z: the first single process was stopped by the harness's own 7,200,000 ms test timeout after 60 of 90 cells, left no marker and was not read; the same card, seed, cells and hands were replayed from cell 0 in six 15-cell ranges). Both are kept with the outputs on the owner's Mac at `/Volumes/SmarterWork/agent-work/shared-capacity/coord-efnft-01Gw7aDt/run/`.
   - Code origin/main `5bfaa38d0e0c`, configuration `switch` (E1), card sha256 `20b90778711be81ea8b985c67fd840efdd3ef3bd5c20949b72c5b2b2eb3778dd`, candidate `lightningEarlyFoldNeedsFoldThrough = true` scope hero, baseline the frozen seven Hold'em style options `LIGHTNING_EVAL_SERVED_STYLE_OPTS_20261114`, seed 41960321 (fresh switch seed), the 90 NLH cells of `LIGHTNING_EVAL_FULL` (4, 5, 6 players x 50, 100, 200 bb x ten fields), 2,200 hands per cell = 198,000 paired hands, deadline mode measure. Harness pin (G9) green before the run.
   - Graded by the repository merge (`LIGHTNING_EVAL_MERGE`, schema `lightning-paired-eval-merge/v2`, all six ranges complete with markers). diff = candidate minus baseline, bb/100, se the larger of per-hand and orbit-block:

| group                             | pooled hands | diff  | se   | z     |
| --------------------------------- | ------------ | ----- | ---- | ----- |
| primary (all_horse + unknown), P1 | 39,600       | +0.4  | 1.2  | +0.37 |
| counter_exploit                   | 59,400       | -0.2  | 2.8  | -0.06 |
| tag_regular (G5)                  | 19,800       | +1.5  | 1.5  | +0.97 |
| three_bet_heavy (G5)              | 19,800       | +0.5  | 5.3  | +0.09 |
| three_bet_heavy x2 (G5)           | 19,800       | -2.5  | 6.4  | -0.39 |
| station (G6)                      | 19,800       | +1.4  | 2.8  | +0.51 |
| nit (G6)                          | 19,800       | +0.6  | 1.9  | +0.34 |
| tight_value (G6)                  | 19,800       | +2.3  | 1.3  | +1.75 |
| maniac (G6)                       | 19,800       | +13.2 | 10.7 | +1.24 |
| gear_changer (G6)                 | 19,800       | -0.6  | 3.7  | -0.15 |
| all_horse                         | 19,800       | +2.0  | 1.9  | +1.04 |
| unknown                           | 19,800       | -1.1  | 1.5  | -0.77 |

- G1: illegal actions 0, illegal amounts 0, chip-conservation violations 0. G2: decide exceptions 0, policy fallbacks 0. G3: unsettled hands 0 (six range reports). G4: pooled p95 ratio 1.030, p99 ratio 1.051, holds; 0 decisions over either deadline.
- G7 (sum of the six range reports' counts): baseline entry rate 31.214% (60,045 / 192,368), after five or more non-entries 29.208% (8,857 / 30,324); candidate 32.211% (61,965 / 192,375), after a dry streak 30.441% (8,554 / 28,100). No rebound above the overall rate: holds.
- Q3 (same sums): bottom-quartile share of entering hands 10.182% baseline, 11.264% candidate (+1.08 points; under the declared 5-point line). Q4: VPIP +0.970 points of hands dealt, intended kinds +0.437, intended share 45.1% (under two thirds).
- Verdict under the rule fixed before the run: **not shown harmful on the NLH half**; no off-only lock. Evidence NOT MET kept: no gain is shown, Q4 is under two thirds, and the bottom-quartile share still rises, which is the shape the standing Lightning rule forbids as a way to meet the VPIP floor. Nothing is claimed for PLO4 or PLO5.

3. **Declared 90-cell NLH half on the fixed code (`#11623`, 2026-11-21, single process):**
   - Code: `8f854361a0b66d750962fde3483f3da8b3ec7f44` (with unraised-limp refusal `lightning_fold_through_limp_kept` and one-roll stream replay, plus `LIGHTNING_EVAL_TIMEOUT_MS=0` from `#11616`).
   - Pre-run declaration: `DECLARATION-EFNFT2-NLH90.md` (sha256 `2e64b99c362145b681251cd6e8b1ab6f258cd25353e4e70b301b7d848a79f9b0`), card `early_fold_needs_fold_through_nlh90_fixed` (sha256 `73ca1f41dd8477ca88a8a106babdd52a82bfde251c37c8ffa91387a4aaf15811`), archived under `extreme-archive/antigravity-coordinator-20261121/efnft2-01Gw7a/`.
   - Run: `pin` (G9) passed (`rc=0`), followed by 1 process covering cells `0:90`, seed `41987143`, `2,200` paired hands per cell = `198,000` paired hands (`rc=0`, report digest `76d3c3fada7ec6dbfee78c3ff4fc86b0808ee481de5583d49bf96fea8fc42baf`, `27,746` divergent decisions), merged via `LIGHTNING_EVAL_MERGE` (`schema lightning-paired-eval-merge/v2`).

| group                             | pooled hands | diff bb/100 | se used |     z |
| --------------------------------- | -----------: | ----------: | ------: | ----: |
| primary (P1: all_horse + unknown) |       39,600 |        -1.2 |     0.8 | -1.46 |
| counter_exploit                   |       59,400 |        -3.5 |     2.2 | -1.59 |
| tag_regular (G5)                  |       19,800 |        -1.2 |     1.5 | -0.81 |
| three_bet_heavy (G5)              |       19,800 |        -7.1 |     4.1 | -1.72 |
| three_bet_heavy x2 (G5)           |       19,800 |        -2.2 |     4.9 | -0.45 |
| station (G6)                      |       19,800 |        +0.3 |     1.7 | +0.17 |
| nit (G6)                          |       19,800 |        +1.7 |     1.2 | +1.41 |
| tight_value (G6)                  |       19,800 |        -1.8 |     1.2 | -1.45 |
| maniac (G6)                       |       19,800 |        +2.2 |     8.7 | +0.25 |
| gear_changer (G6)                 |       19,800 |        +2.9 |     2.6 | +1.11 |
| all_horse                         |       19,800 |        -1.8 |     0.8 | -2.37 |
| unknown                           |       19,800 |        -0.6 |     1.5 | -0.40 |

- G1: illegal actions `0`, illegal amounts `0`, subject illegal `0`, conservation violations `0`. G2: decide throws `0`, policy fallbacks `0`. G3: unsettled hands `0`. G4: pooled p95 `3.23 ms -> 3.33 ms` (ratio `1.030`), p99 `4.35 ms -> 4.67 ms` (ratio `1.072`), both `<= 1.10`, `0` over deadline: holds.
- G7: baseline overall `31.246%` (`60,115 / 192,391`), after dry streak `29.361%` (`8,961 / 30,520`); candidate overall `31.696%` (`60,981 / 192,392`), after dry streak `30.217%` (`8,814 / 29,169`): no rebound above overall rate, holds.
- Q3: bottom-quartile share of entering hands `9.903%` (`5,953 / 60,115`) baseline -> `9.946%` (`6,065 / 60,981`) candidate (`+0.043` points, down from `+1.082` points on the pre-fix code; meets the declared Q3 target).
- Q4: VPIP gain `+0.437` points (`firstInRaise +0.281`, `coldCall +0.143`, `firstInLimp +0.010`, `isoRaise +0.007`, `overLimp 0.000`, `threeBetPlus -0.002`, `bigBlindCall -0.002`, `bigBlindRaise -0.001`, `bigBlindUnpricedRaise +0.001`), intended gain `+0.279` points, intended share `63.74%` (up from `45.1%`, just shy of the two-thirds promotion target due to `coldCall +0.143`).
- Verdict under `DECLARATION-EFNFT2-NLH90.md`: **not shown harmful on the NLH half of the fixed code** (no off-only lock). Evidence NOT MET kept: primary shows no gain (`-1.2 +/- 0.8`, `z = -1.46`; `all_horse` `-1.8 +/- 0.8`, `z = -2.37`), Q4 is `63.74%`, PLO4 and PLO5 (`180` cells) are not covered, and no early-look replay exists.

## Receipts

`lightning_fold_through_kept`, `lightning_fold_through_released`, `lightning_fold_through_limp_kept` (2026-11-21), `lightning_fold_through_math_core_owned` (`HorseDataLedger.ts`, source `'HorseLogic (lightningEarlyFoldNeedsFoldThrough)'`); ledger flag `lightningEarlyFoldNeedsFoldThrough`.

## Tests

- `server/src/engine/HorseLightningFoldThrough.test.ts` (17 unit tests: `lightningFoldThroughSeats`, `lightningFoldThroughFrame`, `lightningFoldThroughFrameIsUnraisedLimp`, `HorseLogic.decide` with `lightningEarlyFoldNeedsFoldThrough`, side-ask isolation of telemetry, style records and error reporting, the unraised-limp rule and the one-roll stream replay of 2026-11-21).
- `server/src/lightning/anEarlyFoldNeedsTheFoldThrough.regression.test.ts` (6 host regression tests through `LightningHandHost` and `HorseLogic.decide`: button fold-through open, public-only frame, trash still fast-folds before UTG acts, flop early fold released when seat between can undo it, river early look unchanged, option off unchanged).
- Refused league matchup `nlh_lightning_early_fold_needs_fold_through` (`server/src/benchmark/HorseLeague.ts` `UNMEASURABLE_MATCHUPS`: the league deals no early look; 0 of 2,000 pairs diverged on seed 20261114).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests, off-identity: MET (sections above).
- Paired Lightning evaluation: NOT MET. Fixed-code NLH half (`#11623` `8f854361a0`, seed `41987143`, 90 cells, 198,000 paired hands, 2026-11-21): `-1.2 +/- 0.8 bb/100` (`z = -1.46`), G1/G2/G3/G4/G5/G6/G7/G9 all hold, Q3 `+0.043` pts (`9.903% -> 9.946%`), Q4 intended share `63.74%`; not shown harmful, no gain. Pre-fix NLH half (`5bfaa38d`, seed `41960321`): `+0.4 +/- 1.2`, `z +0.37`, Q4 `45.1%`, Q3 `+1.08` pts. PLO4 and PLO5 halves (`180` cells) not run.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.
- Value against people, live reach of the receipts: NOT MEASURED.

## What is still owed before this file may say the evidence is met

1. The NLH first-in limp / double-jitter fix (`#11623`, `8f854361a0`) eliminated the limp inflation (`firstInLimp +0.010`, `overLimp 0.000`, Q3 `+0.043` pts) and lifted Q4 intended share from `45.1%` to `63.74%`, but the fixed-code NLH half still showed no gain on primary (`-1.2 +/- 0.8`, `z = -1.46`; `all_horse -1.8 +/- 0.8`, `z = -2.37`) and remained just below the two-thirds Q4 bar (`coldCall +0.143`). Before any activation claim: demonstrate a positive primary result and Q4 `>= 66.7%` on NLH, and declare and pass the PLO4 and PLO5 halves (`180` cells) of the paired Lightning matrix.
2. A declared PASS-BAR and a replay on real audited Lightning decisions, off against on, scored by `server/scripts/audited-decision-replay.ts --row` with `newlyWrong <= fixed`.
3. An explicit owner or lane-lead order to activate recorded verbatim in "The order it rests on", plus a live post-activation check and rollback trigger.

## What the activation row must contain

`option = 'lightningEarlyFoldNeedsFoldThrough'`, `state = 'on'`, note `authority: lightningEarlyFoldNeedsFoldThrough docs/horse-option-authority.d/lightningEarlyFoldNeedsFoldThrough.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`. Not before the items above are recorded here.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-20 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; the audited decision sets hold no early-look node record)
