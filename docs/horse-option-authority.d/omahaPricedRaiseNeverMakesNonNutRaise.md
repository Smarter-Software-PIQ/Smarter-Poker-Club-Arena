# omahaPricedRaiseNeverMakesNonNutRaise: Authority For The Live Switch

Built 2026-11-22 by PLO-OWNER lead-5 from the leak trace of real losing hands (b910fc9e, 89b5b740). Evidence NOT MET: stays OFF. The option is registered, default off (read `=== true`), and has replay counts only: no graded replay, no league card and no shadow measurement yet. This file does not authorize switching the option on.

## The Owner's Rulings It Enforces

- Owner 2026-11-15 12:52 / 12:53: on the turn and the river facing a bet, a hand that is not the nuts folds or at best calls. It never raises.
- Owner 2026-11-15 12:30: "RAISING WITH DRAWS SHOULD NEVER HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO DRAWS, NOT NAKED NUT FLUSH DRAWS."

## What It Does

PLO4/PLO5 cash, high only, one board, no bomb pot, turn and river, facing a wager. It switches no rule on by itself; it limits two rules that are already live.

1. Inside `omahaTurnRiverRaiseIsPriced` (`server/src/engine/HorseOmahaPricedWiring.ts`, `omahaPricedTurnRiverRaiseRule`): a raise is returned only for a hand that is nut class now (`omahaNutClassNow`) or for the in-position turn combo draw that is already raising (`omahaRaiseNeedsNutsKeeps`, the one existing classifier; no new threshold). Every other raise the rule is given becomes the priced call or fold it had already computed (`verdict.callStands`); when nothing can be priced, or the rule throws, it becomes the call. A call or fold the rule is given is never turned into a raise.
2. Inside `omahaTurnRiverRaiseNeedsNuts` (`server/src/engine/HorseLogic.ts`, `omahaTurnRiverRaiseNeedsNutsRule`): the rule reads its own spot in the Lightning pools too, where until now no raise rule looked at a turn or river raise. The receipt validator admits its raise-to-call in a Lightning pool only for a decision that may have run with this option (`omahaNonNutRaiseInLightningGate`, `server/src/engine/horseDecision/responseValidation.ts`).

The two holes it closes, from real hands: in b910fc9e (PLO5 table, out of position, aces and the nut flush draw) the draw bar had correctly cut an all-in to a call of 185 and the priced rule turned the call back into an all-in "bluff" raise; in 89b5b740 (PLO5 Lightning, top two pair and the nut flush draw) a turn raise to 120 passed because both raise rules exclude Lightning.

Untouched: PLO6, tournaments, hi-lo, bomb pots, multi-board hands, hold'em, the flop and every decision not facing a wager. Receipts: `omaha_priced_raise_non_nut_raise_not_made`, `omaha_priced_raise_non_nut_unpriced_called`, with the existing `omaha_priced_raise_called` / `omaha_priced_raise_folded` and `omaha_turn_river_raise_needs_nuts_*`. Scopable per game (`horse.omahaGameScope.omahaPricedRaiseNeverMakesNonNutRaise`); staged for shadow re-decision on PLO4/PLO5 turn and river.

## What Was Measured

Counts only, on decisions replayed with the production switch set of 2026-11-22 and empty opponent memory. They show what the option changes, not whether the change wins chips.

- Three real hands (`server/src/engine/HorseOmahaNonNutNeverRaises.law.test.ts`): b910fc9e turn all-in becomes the call of 185; 89b5b740 Lightning turn raise to 120 becomes the call of 60; b1e6ae31 is not changed by this option.
- 2,400 generated PLO4/PLO5 cash turn and river decisions facing a wager (1,400 table, 1,000 Lightning; two seeds, 4,800 decisions): non-nut raises 156 with the option off, 0 with it on; 145 became a call and 11 a fold; nothing else changed.
- The lead-5 state set (14,614 states of every game and format, two seeds, 29,228 decisions): 60 decisions changed, all PLO4/PLO5 cash (44 table turn, 4 table river, 12 Lightning turn); 50 raise to call, 10 raise to fold; 0 changes in PLO6, tournaments, bomb pots and hold'em.
- Leak trace sample (PLO4/PLO5 cash hands with a person, 2026-11-17 to 11-23): raises where the Horse showed two pair or less were 14, 8 won, net -203 bb; every other raise class was positive. The option also gives up the fold equity of some of those winning raises; how many won by a fold was not determined.

## Replay

- Replay: NOT RUN (built 2026-11-22; the audited-set scorer was not run; count-only replays of this option are recorded above)
