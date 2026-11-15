# Omaha re-raised pots: a coordinated calling range, stronger out of position, and a flop rule for the caller (options, default off)

Date: 2026-11-15. Lane: PLO Strategy. Owner instructions 11:49, 11:51, 11:55 and 11:58 America/Chicago. Two new options, both off by default (read `=== true`): `omahaOopReraisedPotStrongRange` and `omahaReraisedPotFlopContinueNeedsEquityShape`. One existing option narrowed: `omahaEliteContinuesVsMeasuredWideThreeBettor` now applies only in position.

## What happened

The owner: Horses call 3-bets and 4-bets out of position with too weak a range and call because the opponent is aggressive; the calling range should be rundowns, straight makers and double-suited hands whose cards all work together; big cards with a dangler and high cards with low cards are trash; after the flop the caller continues only with a pair plus a straight or flush draw, or better. The production sweep (4,573 human-seated PLO4/PLO5 cash hands) counted 72 calls of a 4-bet or more without aces for -2,289 bb.

## What the sweep says about position

Horse's last preflop action, whole-hand result. Calling a 3-bet: in position 231 hands, -7.2 bb a hand; out of position 232, -2.1. Calling a 4-bet or more: in position 59, -22.0; out of position 37, +4.6. 4-betting: in position 51, +23.0; out of position 33, +51.1. Calling loses and 4-betting wins; the sample does not show out of position losing more than in position. The sweep's three worst 4-bet calls were all in position. Small samples, very large swings.

## What changed

1. `omahaOopReraisedPotStrongRange` (`HorseOmahaOopReraisedPot.ts`): a preflop call of a 3-bet or more out of position against the last raiser, or of a 4-bet or more in either position, stands only with suited aces, as a commitment, or with a coordinated hand (at most one pair, every card in one connected rank group, limited gaps, no dangler) whose equity against the raiser's range clears the price plus the realization margin (0.10 out of position, 0.05 in position, 0.03 more facing a 4-bet with exactly one ace or king). Otherwise it folds. Raises and a call of a 3-bet in position are unchanged. Receipts `omaha_oop_reraised_call_folded` and `_kept`.
2. `omahaReraisedPotFlopContinueNeedsEquityShape`: on the flop of a re-raised pot the Horse called, a call or raise facing a wager stands only with two pair or better, a pair with a nut-leaning draw, a strong draw, or a call under 10% of the resulting pot. Receipts `omaha_reraised_flop_continue_folded` and `_kept`.
3. `omahaEliteContinuesVsMeasuredWideThreeBettor`: only where the Horse will be in position against the 3-bettor.

Ledger flags and receipts, reference-decision source, league cards plo4/plo5 for each, evidence files in `docs/horse-default-on.d/`. With the options unset or false the brain decides exactly as before.

## Added the same day: the re-raise range by position

Owner 12:18: the Horses' 3-bet and 4-bet ranges out of position and under the gun must be capped. Two options, each default off and switched separately, `omahaReraiseRangeOutOfPosition` and `omahaReraiseRangeEarlyPosition` (the sweep has out-of-position 3-bets from the blinds winning and early-position 3-bets without aces losing): a 3-bet or 4-bet out of position against the player re-raised (or a caller in the pot), or from under the gun or under the gun plus one at a table of six or more, stands only with suited aces, any aces when the re-raise commits (stack-to-pot ratio once it is called at or under 1), or the declared premium structures (kings double-suited, double-suited rundowns seven-high or better); every other hand calls, and the call answers to the calling rule above (a downgraded 3-bet needs a coordinated hand, aces, or equity clearing the price plus the realization margin). The button, the cutoff, the middle seats in position and blind against blind keep today's ranges. It is the decision's last step, so the VPIP floor and the maniac-pressure paths cannot re-raise around it. Receipts `omaha_reraise_by_position_kept`, `_aces_committed`, `_called`, `_folded`. The sweep does not show re-raising out of position or from early position losing: 3-bets won 6.6 bb a raise out of position (279) against 1.3 in position (319), 4-bets 32.1 (47) against 10.4 (72); early-position 3-bets without aces lost 9.4 a raise (38).

## Evaluation

Not yet declared or run. The options stay off until it is.
