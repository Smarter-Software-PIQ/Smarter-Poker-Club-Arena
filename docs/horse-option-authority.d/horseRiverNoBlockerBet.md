# horseRiverNoBlockerBet: authority for the live switch

Built 2026-11-19 by lane RIVER-BLOCK (helper of the PLO/WooWoo successor, lead session_01TLQer8xSzdhPzuDRJXTPag). Default OFF (read as `=== true`). Evidence NOT MET for an evaluation (no replay or league run yet). The basis to switch it on is the owner order below, given by name for this behaviour: the lead switches it on through the activation kit once the engine serving production (`/health` releaseSha) is a build that contains this option and this file; until then no option-switch row may name it.

## The owner's order it rests on (verbatim)

- Owner order 2026-11-19 16:47 America/Chicago: "REMOVE BLOCKER BETS ON THE RIVER FOR HORSES, THEY ARE ALMOST ALWAYS WEAKNESS AND THEY ALMOST ALWAYS FOLD AFTER BLOCK BETTING TO A BIG RAISE"

## What it does

Hold'em (NLH) and PLO4/PLO5/PLO6 cash (table cash and Lightning), one board, high only, not fixed limit, not All-In-Or-Fold, not a bomb pot; tournaments excluded. On the river, with nothing to call, when the Horse's final decision of the wager_rules node is a bet smaller than the threshold share of the pot (`RIVER_NO_BLOCKER_BET_MIN_SHARE` in `server/src/engine/HorseRiverNoBlockerBet.ts`: PLO 40%, hold'em 25%), the bet becomes:

- priced (PLO heads-up inside the card-impact scope, `HorseOmahaCardImpact.ts`): the check against the cheapest legal bet at or over the threshold, on the card-impact model with the measured response of his kind (`omahaSmallBetCurve`, where the variant is measured); the higher expected value wins and a tie checks;
- not priceable (hold'em, multiway, PLO outside the card-impact scope): the check, except a hand holding the river nuts by a hole card (`hasRiverNuts` with private value), which bets the threshold size.

Never the turn or an earlier street, never an all-in, never a bet already at or over the threshold. Off or unset: byte-identical (same decision, same random draws, no receipt).

## The threshold (measured)

Archive `woowoo-48h-audit-01BNteGYgf/repairs/RIVER-BLOCK/MEASURE.md`: every Horse river first bet (not a raise) in production cash hold'em and PLO4/PLO5/PLO6, 7 days to 2026-11-19 17:00 Chicago, from `hand_history` (2-hour created_at windows, read only). PLO: when a bet under 40% of the pot was raised, the Horse folded almost every time (0-15%, 15-25% and 25-40% bands), against far fewer folds to a raise of a bet of 40% or more; the 0-15% band also lost chips. Hold'em: the same under 25%; 25-40% was not raise-then-fold dominated, so hold'em keeps it.

## Receipts

`river_no_blocker_bet_checked`, `river_no_blocker_bet_resized_priced`, `river_no_blocker_bet_resized_nuts`, `river_no_blocker_bet_failed`. A small bet placed by `omahaSmallBetIsPriced` and replaced here fires that rule's `_vetoed` receipt (its receipt describes the final action).

## Tests

`server/src/engine/HorseRiverNoBlockerBet.test.ts`: the registered name and the stated threshold; the spot (in and out of scope by share, the turn, all-in, hold'em); the verdict (never a bet under the threshold, priced choice by EV, hold'em air checks and the nuts bets the threshold); off byte-identical (unset, false, truthy non-boolean); decide level on recorded PLO5 river spots with the live small-bet pricing on: the option off makes river bets under 40% of the pot there, on makes none, every change carries a receipt and passes the worker validator; the turn and a tournament river unchanged with it on. The decide-level test fails without the HorseLogic wiring and passes with it.

## Evidence rows

- Owner order for this behaviour, by name: MET (2026-11-19 16:47 Chicago, verbatim above).
- Production measurement of the band it removes: MET (MEASURE.md above).
- League evaluation (cards plo4/plo5/nlh_horse_river_no_blocker_bet): NOT MET (not run).
- Decision latency: NOT MET (not run).

## Replay

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; its switch-on rests on the owner order of 2026-11-19 16:47 America/Chicago)

| audit source | arm                    | line    |
| ------------ | ---------------------- | ------- |
| audit2       | horseRiverNoBlockerBet | not run |
| WooWoo audit | horseRiverNoBlockerBet | not run |

Evidence for an evaluation: NOT MET. The switch-on rests on the owner order above.
