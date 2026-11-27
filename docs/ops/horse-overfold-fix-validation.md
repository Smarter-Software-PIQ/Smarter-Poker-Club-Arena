# Over-fold fix validation

`scripts/ops/horse-overfold-fix-validation.mjs` (pure core `horse-overfold-fix-validation-lib.mjs`). Read-only.

The over-fold alarm (`horse-plo-overfold-gate.mjs`) says whether a cell is over its ceiling and whether the
cell's fix is ON. This tool answers the next question: **after the fix went ON, did the cells it owns get better?**

```
node scripts/ops/horse-overfold-fix-validation.mjs --option <name> [--on <ISO>] [--until <ISO>] [--json] [--out page.md]
     [--supabase-workdir <dir>] [--from-json rows.json] [--save-json rows.json]
```

- **Option and cells**: the option must own cells in `scripts/ops/horse-overfold-owner-map.json`; only those cells
  are judged.
- **ON**: the last change to `on` in `ca_horse_style_switch_audit` (the switch must be `on` now), or `--on`.
- **AFTER**: ON .. `--until` (default now). **BEFORE**: the same clock hours on each of the 7 days before ON (when
  AFTER is 24 hours or longer: the 7 days before ON).
- **Read**: the Omaha hand audit's SELECT (`horse-hand-audit-omaha-lib/sql.mjs`): PLO4/PLO5 cash with a person
  seated, keyset pages, `SET TRANSACTION READ ONLY`. Hole cards leave the database only for showdown entries that
  are not mucked. People's folds are read over the trailing 14 days, as the alarm reads them.

## What each cell shows

| column                      | meaning                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fold before / after         | Horse fold rate facing a person's first bet (no raise yet), n each side                                                                                                                  |
| ceiling, z after vs ceiling | the alarm's own ceiling and z (`gateCells`): people prior table, else people's own folds, else minimum defence. The bar is the alarm's z 3, Bonferroni-corrected over the option's cells |
| z after vs before           | two-proportion z (positive = folds more after ON)                                                                                                                                        |
| fold-through                | heads-up: the person's bet took the pot, against the pure-bluff break-even s/(1+s)                                                                                                       |
| bb per call                 | realized chips of each Horse call (or raise) from that decision on, in big blinds, mean +/- SE; folding there is 0                                                                       |

River **watch cells** (from the l8-payoff measurement): Horse calls of a person's river bet holding a non-nut flush
on a paired board, a straight on a flush board without the nut-flush card, or the nut flush on a paired board,
classed from the Horse's own cards **only when they were shown at showdown**. Result in bb per call.

## Verdicts

| verdict   | fold cell                                                                                                    | watch cell                                   |
| --------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| REGRESSED | AFTER n >= 20 and z vs ceiling >= the bar, or AFTER above its ceiling and folding more than BEFORE by z >= 2 | AFTER mean bb per call at least 2 SE below 0 |
| VALIDATED | AFTER n >= 20 and z vs ceiling <= 1                                                                          | AFTER >= 5 calls and mean bb per call >= 0   |
| NOT YET   | otherwise, with the n still needed (to 20, or until the current gap would reach the bar)                     | under 5 calls, or between                    |

The option's verdict is REGRESSED if any cell is, VALIDATED if every cell is, else NOT YET.
Exit: 0 VALIDATED or NOT YET, 1 REGRESSED, 2 the option is not ON, 64 usage, 70 a read failed.

## In the daily audit

`horse-daily-audit.mjs` reads which owner-map options are `on` (one SELECT on `ca_horse_style_switch`) and runs this
tool for each (`overfold-fix-validation-<option>.json`). SUMMARY.md lists each verdict under "Over-Fold Fix
Validation"; a REGRESSED cell is a breach-class regression (the fix is ON and the cell got worse).

Limits: realized bb per call carries the full luck of the runout (no all-in adjustment); watch cells only see the
showdowns the Horse showed, so they are a lower bound on the calls in each class.| fold-through | the person's bet took the pot (heads-up: its own; multiway: the 3-way row), against the pure-bluff break-even s/(1+s); beside it the bb-weighted value of a zero-equity bluff, fold-through x pot - (1 - fold-through) x bet in real pots, mean +/- SE (information only: a cell can be over the break-even in pot units and worth about 0 bb when the fold-throughs come in the smaller pots) |
