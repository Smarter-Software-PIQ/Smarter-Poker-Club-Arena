# Prewarm Hits Are Counted, Postflop Upgrades Get A Postflop Denominator, And One Comment Is Corrected

Three small corrections to how Horse upgrade activation is measured. No decision, wager, think time, queue or deadline changes.

## A Prewarm Hit Could Never Be Counted

The worker counts a hit (`poker_horse_street_prewarm_total`, reason `hit_flop`, `hit_turn`, `hit_river`) for each FAST decision whose table, street and board match a prewarm it stored. The prewarm was keyed by table id and the decision by its whole fence (`table:hand:seat:lease:token`), so the two never matched. Release 08c27924 executed 4,502 prewarms in about nine hours and counted no hit. Both sides now key by the table, which is also the shard key, so the prewarm and the decision were always in the same worker.

This corrects the measurement. It does not make prewarming useful. What a prewarm warms is one board-texture classification, measured at about 1.5 microseconds uncached, so a hit saves about that much. A hit is counted per decision, not per prewarm: every Horse decision on that street at that table counts, so hits can exceed prewarms, and only the first of them could have saved the classification. The counter shows how often a decision lands on a prewarmed board; it is an upper bound on use, not a measure of benefit.

## The Postflop Upgrade Counters Are Measured Against Postflop Decisions

`decide_postflop` counts every telemetry-on live decision that enters the postflop brain. `upgrade01_action_line_posterior`, `upgrade02_card_removal_scored` and `upgrade06_public_timing_hint` now name it as their denominator in `HorseDataLedger.ts` in place of `decide` (every decision, preflop included). They still carry no floor: a rate is written only from a measured live day. With this, a zero on those counters can be read against the opportunities that actually occurred.

## The Ledger's MinRatio Comment Says What The Audit Does

The doc comment on `LedgerEntry.minRatio` said a receipt with no floor still has a zero against a big denominator reported. The receipt audit (`fn_audit_data_receipts`) judges only rows that carry a `min_ratio` and raises nothing for the rest. The comment now says so. Found by the independent review of #10668.

## Regression

`horseDecision/streetPrewarmHit.test.ts` (3): a real worker prewarms a board for a table, decides on it, and one `hit_river` is counted; a prewarm for another table counts none.
