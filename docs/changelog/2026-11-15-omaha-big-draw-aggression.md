# Omaha big-draw aggression: a combo draw or nut draw bets or raises the pot when that is worth more than checking or calling

Date: 2026-11-15. Lane: PLO Strategy. Owner instruction 2026-11-15 11:55 America/Chicago (be aggressive with combo draws and nut draws; too many conservative plays with huge-equity draws; winning players play their nut combination draws hard and fast). One new option, off by default (read `=== true`): `omahaBigDrawAggression`.

## What happened

On the full human-table sweep (PLO4/PLO5 cash, 4,573 hands since 2026-11-10) the Horses held a big draw at 584 flop and turn decisions. Facing a bet they could raise they raised 6% of the time (12 of 198) and folded 31% (61); checked to they bet 51% at about half the pot, 42% out of position and 39% multiway. The winning humans raised the same draws 27% of the time (the top winner 3 of 5) and bet them at 83% of the pot. The passive Horse hands did not lose chips in the sweep (+1,373 bb on the passive hands with 40%+ raw equity); what is missing is the fold equity.

## Root cause

Every existing aggression path for a draw is a random mix behind narrow gates: the baseline flop/turn raise fires at 0.18 to 0.36 and not into a bet above 75% of the pot on the turn; the combo-draw pump needs the nut flush draw together with eight nut straight outs, the flop, and a 0.65 roll; the pressure semi-bluff raise is a roll of about one in ten inside a 33% to 52% equity band; a pair with a draw is read as showdown value and skips the bluff range. None of them prices the wager against the passive line.

## What changed

New `server/src/engine/HorseOmahaBigDrawAggression.ts`: the big-draw classes by exact outs with the two-card rule (`omahaBigDraw`), a seeded equity sample against any hand, the range that continues against a bet and the range that continues against a raise (`omahaBigDrawEquities`), and the verdict (`omahaBigDrawVerdict`): a pot-sized bet or raise, or the stack when a later street puts it in anyway, only when fold equity times the pot plus the called branch is worth more than the passive line. Fold equity is each opponent's measured fold to a bet (`HorseMind.omahaReadConditionalOf`), the sweep's population prior without a read. `omahaBigDrawAggression` in `HorseLogic.ts` applies it outermost in the wager rules on both decision paths. Receipts `omaha_big_draw_aggression_raise`, `_bet`, `_withheld`.

It stays passive against a measured station without the equity, against three or more opponents, against two opponents without the nut end, when facing a raise of its own bet, and never touches a paired board, a made hand, or a weak or non-nut draw. With the option unset or false the brain plays exactly as before. League cards `plo4_omaha_big_draw_aggression` and `plo5_omaha_big_draw_aggression`.

## Evaluation

Not yet declared or run. The protocol and pass rule go into the evidence archive (`plo-handoff-review-01a1cbbd/combodraw-20261115/`) before any graded run; the verdict is added here when it is read.
