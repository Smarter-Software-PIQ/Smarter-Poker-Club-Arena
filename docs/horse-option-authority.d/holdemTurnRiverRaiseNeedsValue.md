# holdemTurnRiverRaiseNeedsValue: Authority For The Live Switch

Built 2026-11-24 by the plo-lead6 Hold'em late-street audit from the owner's 2026-11-15 12:52 / 12:53 ruling and the live evidence of build b99bd306892c. Evidence NOT MET: stays OFF. The option is registered, default off (read `=== true`), and has replay counts only: no graded replay, no league result and no shadow measurement yet. This file does not authorize switching the option on.

## The Owner's Ruling It Enforces

- Owner 2026-11-15 12:52 / 12:53: on the turn and the river facing a bet, a hand that is not a value hand folds or at best calls. It never raises. (The PLO twin is omahaTurnRiverRaiseNeedsNuts.)

## What It Does

No-Limit Hold'em cash, Lightning and tournaments, heads-up and multiway, one board, not a bomb pot or an all-in-or-fold table, turn and river, facing a wager with chips behind the call. It is the outermost answer of the wager_rules node (`server/src/engine/HorseHoldemTurnRiverRaiseNeedsValue.ts`, hooked in `HorseLogic.ts` around `omahaMathCoreRule`), so it judges every raise any earlier rule made.

A raise stands only for a value hand: the Horse's equity against the continuing part of every live opponent's line range is above 0.5. The range is the holdemValueAndCallsArePriced model (his preflop band narrowed by his public line, his measured fold to a bet and bet when checked to as posteriors on the population envelope); his fold against the raise is priced at the raise. Any other raise becomes the priced call (EV of the call against the bettor's line range at least zero; multiway the product of the equities) or the fold. When no range can be built, the call. It never creates a wager and never changes a call, fold or check. It reads only the Horse's own cards, the board and the public line.

Receipts: `holdem_turn_river_raise_value_kept`, `holdem_turn_river_raise_not_value_called`, `holdem_turn_river_raise_not_value_folded`, `holdem_turn_river_raise_not_value_unpriced_called`, `holdem_turn_river_raise_rule_failed`. The receipt validator admits the raise to call or fold at wager_rules only for a decision that may have run with the option (`holdemTurnRiverRaiseNeedsValueGate`).

## What Was Measured

Counts only. They show what the option changes, not whether the change wins chips.

- Live (b99bd306892c, about 24 hours, shown hands only): Horse turn raises facing a bet with one pair or less, 15 bb or deeper: 277 shown, net -3,869 bb; with no pair: 50 shown, -1,188 bb. River raises below top two pair: 19 shown, -912 bb.
- 28,800 generated NLH states (scale-16 capture, production rows of 2026-11-24 05:20Z), two seeds: 167 of 57,600 decisions change (raise to call 125, of them all-in to call 93; raise to fold 42; turn 163, river 4); 207 raises judged value and kept. Tournaments 101, cash 44, Lightning 22.
- Three real hands (`HorseHoldemTurnRiverRaiseNeedsValue.law.test.ts`): 3ba439af turn raise with 4d5d becomes the fold; 4a4ff3bb turn raise with KhTh becomes the call of 30; 6a1150c2 river check-raise with 3c4c becomes the call of 29.
- Tension recorded for the owner: with the option on, a Horse river raise is a value hand by construction, so an opponent can fold everything but the nuts to it (holdem-late-street/INVENTORY.md section 4).

## Replay

- Replay: NOT RUN (built 2026-11-24; the audited-set scorer was not run; count-only replays are recorded above)
