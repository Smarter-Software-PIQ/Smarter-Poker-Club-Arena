# omahaTurnStabDefenceIsPriced: authority for the live switch

Owner report of 2026-11-19 4:53 PM America/Chicago and owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

Inside `omahaFacingBetEv` only (HorseLogic.omahaFacingBetEvCount). PLO4/PLO5 cash, one board, heads-up: the flop checked through (nobody wagered on it) and a PERSON (HorseOmahaPricedMode.omahaOpponentKindOf) makes the first wager of the turn into the Horse. The facing-bet EV prices the Horse's fold or call against the bettor's value region and the rest of his holdings at a non-value share, the prior, moved by his own read. With this option on, in that line only, the prior is the line's MEASURED non-value share read at the bet's size (HorseOmahaTurnStabDefence.OMAHA_TURN_STAB_PERSON_BLUFF through HorseOmahaPricedMode.omahaPricedBySize: 0.532 / 0.626 / 0.336 / 0.336 at the under-40 / 40-70 / 70-110 / over-110 percent centres) instead of the turn table every turn bet reads today (OMAHA_EV_PRIOR_BLUFF.turn: 0.34 / 0.40 / 0.22 / 0.22). The value region, the price, the rake, the realization, the margin and the bettor's own read (omahaEvBluffShare: his measured bet rate beside the population, or the priced read when omahaBluffShareFromBetRate is on) are the facing-bet EV's own, so a person who stabs more than the pool is read through the same priced path that reads every other bettor.

What it does NOT do: it makes no bet and no raise and leaves a raise the brain chose as it is (the facing-bet EV decides only fold or call); a Horse or unknown bettor, a raise, a multiway pot, a tournament, PLO6, the river, a flop someone wagered on and a turn on which the Horse acted first are untouched; Lightning is untouched unless `omahaPricedInLightning` is on (the priced scope's own opening). No per-opponent counter of post-check-through stabs exists in the opponent memory (ctBets/ctProbes count small probe bets, not this line); adding one changes the read frame and is not part of this option.

Scope: PLO4 and PLO5 cash. Default OFF in source (read `=== true`). Off or unset, every decision is exactly as before (the spot object is the facing-bet EV's own; tested byte-identical). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaTurnStabDefenceIsPriced docs/horse-option-authority.d/omahaTurnStabDefenceIsPriced.md sha256 <digest>`). Rollback: switch row off (about 30 s).

## The finding it answers

Owner, 2026-11-19 4:53 PM Chicago, verbatim: "EVERY SINGLE TIME A HORSE CHECKS BACK FLOP WHEN HE CHECKS HE FIRES TURN FULL POT OR NEAR IT 100% OF THE TIME".

Measured (archive woowoo-48h-audit-01BNteGYgf/repairs/TURN-STAB/MEASURE.md; production, PLO4/PLO5/PLO6 cash with a person seated, 2026-11-05 22:00Z to 2026-11-19 22:00Z): after the person checks the flop out of position and the Horse checks behind, the person bets the turn 0.43 of the time (197 of 457; 0.51 to 0.56 on Nov 18 and 19; the main winner 0.46), near pot (median 0.78 of the pot), against 0.11 for his turn lead after calling a flop bet; the Horse folds 0.61 against a break-even near 0.44 and lost 834 bb after those stabs. With every player's cards from the hand facts, the stab's non-value share is 0.49 (0.39 to 0.59) against the 0.22 to 0.40 the verdict assumes; the same persons' barrels after a called flop bet measure 0.31 to 0.36 (the person table). Replay of the journaled decisions: every one of the Horse's 25 turn folds in that line carries `omaha_facing_bet_ev_fold`; 6 of them were base-brain calls the verdict turned into folds.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-19 4:53 PM America/Chicago: the report quoted above.

## Constants

OMAHA_TURN_STAB_PERSON_BLUFF, fit window 2026-11-05 22:00Z to 2026-11-18 00:00Z (the evaluation window is after it): per size row the share q that makes the predicted win share (q x the Horse's share against the rest of his range + (1 - q) x its share against the value region, both from the engine's omahaEvHandCounts) equal the Horse's share against his real cards over every river; bootstrap standard errors; shrunk toward the person table with its 8 pseudo-bets (the method of OMAHA_PRICED_MEASURED_BLUFF): under 40: 0.627 +/- 0.181 (n 14) -> 0.532; 40-70: 0.685 +/- 0.113 (n 26) -> 0.626; 70-110: 0.341 +/- 0.075 (n 66) -> 0.336; over 110 has no stab and reads the 70-110 row. Held-out (Nov 18 00:00Z to Nov 19 22:00Z): 0.519 over all sizes (n 65), 70-110 0.548 +/- 0.107 (n 50).

## Receipts

`omaha_turn_stab_defence_priced_seen` (the line was priced) and `omaha_turn_stab_defence_changed` (the verdict differs from the verdict on the spot's own prior), HorseDataLedger.ts.

## Tests

HorseOmahaTurnStabDefence.test.ts: the table is the measured line shrunk as stated; the line holds only for a person's first turn wager after a checked-through flop, heads-up, PLO4/PLO5, not Lightning unless opened, not a raise, not multiway, not PLO6; in the line the spot differs only in its prior; off, unset and false byte-identical on every spot and seed; on, outside the line byte-identical with no receipt; on, in the line the receipt fires, no base call becomes a fold, and some base folds become calls with the change receipt. Server tsc 0.

## League

The league seats no person, so the line never holds in either arm. Refused matchup `plo5_omaha_turn_stab_defence_is_priced` (HorseLeague.ts UNMEASURABLE_MATCHUPS, the live Omaha set in both arms). The evaluation is the declared replay of journaled production decisions and the held-out verdict replay (archive woowoo-48h-audit-01BNteGYgf/repairs/TURN-STAB/EVAL-DECLARATION.md).

## Replay

- Audited decisions (scripts/audited-decision-replay.ts, audit2 and the WooWoo audit): NOT RUN. The audit windows (WooWoo: 2026-11-15 17:02Z to 2026-11-17 17:01Z) lie inside this option's fit window, and the journals available offline for them were not joined to this line; a replay there would score decisions the constants were fit on.
- Journaled production decisions of the held-out window (journal exports of 2026-11-18): see EVAL-RESULTS in the archive; the result is copied here when it is final.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests, byte-identical off: MET (above).
- Value: NOT MET until the declared evaluation passes. Do not switch on without its PASS; the owner report above is the basis to switch on after a passing evaluation, through the switch kit, never inside a BOOKING MERGED..SEALED span.
