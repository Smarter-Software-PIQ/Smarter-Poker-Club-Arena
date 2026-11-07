# Tuning the river bluffs from live play

How to turn `river-bluff-ev.ts` reports into frequency and size changes for the
river bluff layers of #9803 (heads-up baseline), #9842 (multiway), #9838
(out-of-position leads, hi-lo) and #9837 (fixed limit, short deck, bomb pots,
multi-board). The report is a measurement, not a tuner: nothing here changes a
constant on its own, nothing is scheduled, and every change ships through a
league A/B, a pull request and a certified 04:00 America/Chicago release.

Horses are players (CLAUDE.md 10.5). The report splits by opponent kind
(human / horse) only so an operator can see both populations; a tune never
branches on it. Opponent STYLE (station, folder, nit, loose, regular, from
public VPIP and WTSD) is what a tune may act on, and it already reaches the
brain through the HorseMind reads (`isStation`, `riverFoldRate`), not through
the report's buckets.

## 1. Measure

From `server/` (all statements are read-only, one per call):

```bash
# the default window: since the engine boot that first served 57d9c627
npx tsx ../scripts/horse-measure/river-bluff-ev.ts window
#   exit 0 RELEASED -> START END printed; 4 NOT_RELEASED; 3 UNKNOWN (fetch the sha)
#   if an earlier boot already served it, pass the first UTC day a
#   river_bluff_baseline_* receipt fired: window --first-fire-day 2026-11-08

npx tsx ../scripts/horse-measure/river-bluff-ev.ts plan START END 2 > plan.json
# run each plan[i].sql (Supabase MCP execute_sql, project kuklfnapbkmacvwxktbh,
# or POST /v1/projects/<ref>/database/query with "read_only": true) and save
# the raw result text as DIR/plan[i].file

npx tsx ../scripts/horse-measure/river-bluff-ev.ts assemble START END DIR/*.json > report.md
#   exit 0 only with complete coverage and data; 3 means a gap or NO DATA
```

Keep spots slices at 2 hours (a 2-hour slice on 2026-11-07 ran in about 20 s
through the management API; 4 hours is the most worth trying). Wait for at
least one full release day before reading anything: a window that starts
inside the 04:00-04:05 Chicago thaw or before the boot mixes engines.

Before reading any number, check the report's header notes:

- `COVERAGE INCOMPLETE` - re-run the missing slices; a gap is not quiet.
- `Telemetry controls silent` - those days are NO DATA for receipts.
- `No receipt of the new river bluff layers fired` - the engine does not
  serve them (check `window`) or they never reached the tables. That is a
  wiring defect to fix at its cause, not a tuning question.

## 2. What each number means

| report column | definition                                                                                                | source                                          |
| ------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| spots         | horse river decisions with `publicNode.toCall = 0`                                                        | hand_history.actions                            |
| bet %         | bet / raise / all_in share of spots (the pre-release baseline definition)                                 | same                                            |
| air % of bets | bets whose holding is air: no pocket pair, no hole rank on the board, no flush (#9803's definition)       | ca_hand_facts.hole_cards + publicNode.boards[0] |
| air bet %     | air bets / air spots: how often air bets when it can                                                      | same                                            |
| bluffs        | air bets                                                                                                  | same                                            |
| bluff fold %  | every responder folded to the bluff                                                                       | later river actions                             |
| break-even %  | mean added / (pot + added) of the sizes used                                                              | publicNode                                      |
| size/pot      | mean added / pot                                                                                          | publicNode                                      |
| bluff EV bb   | mean (net + chips invested at the node) / bb: the pot when it folds, minus the bet when called and beaten | ca_hand_facts.net                               |
| receipts      | daily fires per layer, whole fleet                                                                        | horse_brain_telemetry                           |

The telemetry has no variant or opponent split (except
`river_bluff_baseline_bet_<gameType>`), so per-layer EV cannot be read from
the hand rows: the hand rows say how the RIVER BETTING as a whole changed, the
receipts say WHICH layers produced the change. Read them together: a rise in
air bets of a variant with the matching layer's receipts rising is the layer
working; air bets rising with no receipt is some other owner.

"Air" is a conservative proxy. A missed straight draw with a board-pair rank
in hand is not air by this definition, and some air the layers bluff
(`blocker`) has a little showdown value. Use the same proxy before and after
a tune; never compare across definitions.

## 3. Decision thresholds

Act only on a cell (variant x shape, and opponent style where stated) with at
least **200 bluffs** and an EV standard error below **a third of the effect**
you would act on. Below that, report the numbers and do nothing.

Let `m = bluff fold % - break-even %` (the report's fold margin) and `EV` the
bluff EV with its standard error `se`.

| reading        | condition                                                          | tune                                                                                          |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| over-folded    | `m > +0.10` and `EV - 2 se > 0`                                    | bluff MORE: raise frequency (section 4a), up to the next cap                                  |
| balanced       | `                                                                  | m                                                                                             | <= 0.10`, or the EV interval straddles 0 | leave it |
| under-folded   | `m < -0.05` and `EV + 2 se < 0`                                    | bluff LESS: lower frequency, or look at the read that should have stopped it (station factor) |
| size mismatch  | fold % flat across the size range while break-even rises with size | bluff SMALLER (section 4b)                                                                    |
| one style only | the condition holds for one opponent style and not the others      | tune the READ factor for that style, not the base frequency                                   |

The whole-fleet bet frequency against the pre-release baseline (nlh 29.5% of
4,328 etc.) is a sanity check, not a target: a release that moved Hold'em air
bets from 12.8% to, say, 20% is the intended effect; a release that moved
TOTAL bet % by more than 10 points in a variant whose layer did not fire is a
defect.

PLO paired-board rivers stay checked (Dan's 2026-11-06 ruling, pinned in
HorseRiverBluffRange.law.test.ts) and the 14-hand PLO4 nit-to-maniac read pin
stays: no tune touches either, whatever the report says.

## 4. Which constant, in which file

### 4a. Frequency

`server/src/engine/HorseRiverBluffRange.ts` (heads-up, leads, hi-lo, other games):

| constant                                                        | now                                                                                                            | raises frequency when                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `RIVER_BLUFF_MAX_PROBABILITY`                                   | 0.45                                                                                                           | higher (the per-combo ceiling)                                              |
| `RIVER_BLUFF_MAX_VALUE_PER_AIR`                                 | 0.6                                                                                                            | higher (the balanced share allows more air per value combo)                 |
| `RIVER_BLUFF_PRIOR_VALUE_SHARE` / `RIVER_BLUFF_PRIOR_AIR_SHARE` | 0.6 / 1                                                                                                        | value share higher (only when the ranges cannot be sampled)                 |
| `RIVER_BLUFF_WEIGHTS`                                           | junk 0.5, missedDraw 0.9, blocker 1.15, blockerAndDraw 1.3, unblockerBonus 0.1                                 | a selection's weight higher (move one selection, not all)                   |
| `RIVER_BLUFF_LINE`                                              | barrel 1.1, initiative 0.95, checkedThrough 0.8, opponentGaveUp 0.85, scare 0.85, leadDraw 0.9, leadBlank 0.25 | a line's factor higher (the report's `line` split: `checked_to` vs `first`) |
| `RIVER_BLUFF_STATION_FACTOR`                                    | 0.2                                                                                                            | higher (bluffs kept against a credible station)                             |
| `RIVER_BLUFF_FOLDER_MAX`                                        | 1.6                                                                                                            | higher (the boost against a shown folder)                                   |
| `RIVER_BLUFF_HILO_FREEROLL`, `RIVER_BLUFF_HILO_MAX_OPP_LOW`     | 0.55, 0.5                                                                                                      | higher (hi-lo, flo8 / plo8 rows)                                            |
| `riverBluffProbability` `omahaThirdBarrel` halving              | x0.5                                                                                                           | removed or raised (PLO rows, after two called barrels)                      |

`server/src/engine/HorseMultiwayRiverBluff.ts` (the report's `ways = mw` rows):

| constant                                                                                       | now                | note                              |
| ---------------------------------------------------------------------------------------------- | ------------------ | --------------------------------- |
| `MULTIWAY_RIVER_BLUFF_DECAY`                                                                   | {2: 0.45, 3: 0.18} | by opponents live                 |
| `MULTIWAY_RIVER_BLUFF_CAP`                                                                     | {2: 0.2, 3: 0.09}  | per-combo ceiling by opponents    |
| `MULTIWAY_RIVER_BLUFF_STATION_FACTOR`                                                          | 0.05               | any credible station in the field |
| `MULTIWAY_RIVER_BLUFF_READ_MAX`                                                                | 1.3                | product of the field's reads      |
| `MULTIWAY_RIVER_BLUFF_LINE`, `MULTIWAY_RIVER_BLUFF_WEIGHTS`, `MULTIWAY_RIVER_BLUFF_OOP_FACTOR` | see file           | as in the heads-up table          |

### 4b. Size

- Heads-up: `riverBluffSize` in `HorseRiverBluffRange.ts`: pot limit
  0.6-1.0 pot, no limit 0.65-1.0 pot, a 1.0-1.5x overbet with a nut blocker on
  a river that helps hero's range, a shove when the stack is at most 1.5 pots.
  The break-even column is the size: 0.65 pot needs 39% folds, 1.0 pot 50%.
- Multiway: `multiwayRiverBluffSize` in `HorseMultiwayRiverBluff.ts`: pot
  limit 0.75-1.0 pot, no limit 0.75-1.0, 1.0-1.25x overbet, shove at 1.25
  pots.
- Fixed limit: the street's one legal bet; size is not tunable there.

Move one end of one range at a time, and keep the balanced frequency in step:
`riverBluffBalancedProbability` reads the size, so a smaller bet already bluffs
less often per value combo. A size change is therefore a frequency change too
and goes through the same A/B.

### 4c. Never

- Never a constant keyed on `is_horse`, on a player name or on the report's
  `who` column (CLAUDE.md 10.5).
- Never a cron, monitor or self-adjusting loop that moves a constant from the
  report (CLAUDE.md 10.11 / 10.12). A tune is a reviewed code change.
- Never a tune that lowers a bluff below what the owner ruled must not be
  shut off ("NOTHING THAT IS EVER BLOCKING ... RIVER BLUFFS FOR QUALIFIED
  CANDIDATES", 2026-11-06): lower a frequency, never zero a qualified spot.

## 5. The league A/B required before shipping a tune

Every tune is measured offline before it merges, with the duplicate-deal
harness of #9841 (`server/src/benchmark/RiverBluffBaselineLeague.ts`,
script `server/src/scripts/riverBluffBaselineLeague.ts`):

1. Make the tune an option or a temporary arm: arm A = the tuned constants,
   arm B = production (`RBLM_ARMS` in the league file; add the arm there, do
   not edit production defaults until it passes).
2. Run the cells the live report flagged, plus the standard pools, at least
   the sample of the 2026-11-07 run (NLH 6,000 pairs, PLO4 2,000 per cell,
   six-handed and heads-up, cash and tournament):

   ```bash
   cd server && npx tsx src/scripts/riverBluffBaselineLeague.ts --variants=nlh,plo4 \
     --formats=cash,tournament --pools=standard,stations,folders,mixed \
     --pairs=nlh:6000,plo4:2000 --standard-pairs=nlh:3000,plo4:1000 \
     --seed=<new seed> --output=../docs/horse-measure/<day>/results/<tune>
   python3 ../scripts/horse-measure/river-bluff-baseline-report.py ../docs/horse-measure/<day>/results/<tune>
   ```

   Keep the run short on the shared Mac; split cells across runs rather than
   running two full leagues at once.

3. Ship only if: the targeted cell improves with a 95% CI above zero; no cell
   or pool (stations included) has a CI entirely below zero; illegal actions,
   truncated streets and brain exception fallbacks are 0.
4. Move the law: if `HorseRiverBluffRange.law.test.ts` or
   `HorseMultiwayRiverBluff.law.test.ts` pins the old value, update the pin in
   the same commit with the league result as the reason. Never weaken a pin to
   make a tune pass.
5. Write `docs/changelog/<day>-<slug>.md` with the live report that motivated
   it, the league table and the constants moved.
6. After the certified 04:00 release that carries it, re-run this report over
   a full day and compare against the report that motivated the tune. If the
   live cell did not move the way the league said, the league's opponent pool
   is wrong for that cell: record it and fix the pool before the next tune.
