# omahaNutClassValueSize: authority for the live switch (OFF-ONLY)

Owner rule of 2026-11-14 (Dan); built by PLO Strategy (session 01Gw7aDt), turned OFF in source by #10989 after its declared evaluation failed. **OFF-ONLY (ploFailed, 2026-11-18): it cannot be switched on.**

## What it does

PLO4/PLO5 cash, high only (HorseOmahaMadeHandDefense.omahaNutClassValueSize): a bet or raise with the nuts or an effective-nut hand for the street is the full pot (the pot-limit maximum, the stack when smaller) on the flop, turn and river. Default off (read `=== true`). Receipt: omaha_nut_class_pot_wager. While it is on, omahaBetSizeByPublicState keeps its size for a nut-class wager and omahaStrongHandSlowplayMix stands aside.

## Evidence: FAILED

1. First run (eval3-20261115/RESULTS-omahaNutClassValueSize.md, source 9d9ad486, 6 cells x 200 sessions x 300 hand pairs): INCONCLUSIVE, inert by construction. 0 divergent pairs in 360,000 hand pairs and 0 receipts: the rule needs stateSchemaVersion 1, legalActions, minRaiseTo and maxRaiseTo, which the league's Horse game state did not carry.
2. Re-run with those four fields in the league state (eval3-20261115/RESULTS-nutsize-2.md, PROTOCOL-nutsize-2.md declared before the graded run, source 8c63401f, 6 cells x 200 sessions x 300 hand pairs, 544 to 6,304 receipts per cell, 0 illegal, 0 fallbacks). Verdict by the frozen rule: **FAIL**.
   - Development human-like field: PLO4 +2.39 bb/100 (SE 0.56), PLO5 +2.18 (SE 0.68); pooled +2.29 (SE 0.44, z +5.19). Gain bar met.
   - Horse-only: PLO4 -1.19 bb/100 (SE 0.41, z -2.91), PLO5 -1.31 (SE 0.59, z -2.22). Harm bar ("no cell more than 2 SE below zero") broken by both cells.
   - Horses vs a LAG seat: PLO4 -1.29 (SE 5.62), PLO5 +8.08 (SE 5.38): no evidence either way.
   - Limit stated in the results: the other always-on rules that need the live fields (river_nuts_wager, near_pot_wager_full_pot, omaha_current_nuts_raise) still fired 0 times, so both arms lack them. Development fields are not a qualified human population.
3. Inbox: PLO Strategy 2026-11-15T12:26:53Z (result); Hand Analysis ruling 2026-11-15T13:39:23Z: the declared bar governs as written, FAIL, OFF. The registry delta that was to make it off-only once the OFF head merged (overwatch builder, registry ea3e9c95) was never made; until 2026-11-18 the switch registry offered `on` for it and listed its release default as on.

## Why off-only

A failed declared evaluation is off-only (OPTION_SWITCH_OFF_ONLY, ploFailed), as for omahaBeatenMadeHandDefense and omahaBluffCatcherRaiseFold of the same day. Production read 2026-11-18 (SELECT only): no option-switch row for it. The follow-up migration 20261118164511_horse_option_switch_omaha_nut_class_off_only re-asserts the database lists so the table refuses an `on` row from any writer.

Lifting it needs a new build or a new bar that passes, then a reviewed source change to OPTION_SWITCH_OFF_ONLY and a follow-up list migration. The human-field gain is recorded here so a future design can start from it.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
