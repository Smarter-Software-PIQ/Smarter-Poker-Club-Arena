# omahaRiverTripsBoardBoatIsNotNutClass: Authority For The Live Switch

**Evidence NOT MET by the build's replay rule (no audited decision falls in its spot: the PLO hand audits hold no Horse river raise with a full house on a trips board; Replay NOT RUN). On every Horse river raise with a full house Nov 12-26 it changes 34 and leaves the other 697; the counterfactual on those 34 is +1,693 bb. Default OFF.** This file does not authorize switching the option on.

Built 2026-11-26 by PLO-OWNER lead-7 lane plo-postflop (session 01TLQer8) on the lead's decision of 2026-11-26 (job 5). The nut-class test (omahaNutClassNow / omahaRiverRaiseLicense, read by the live omahaPricedRaiseNeverMakesNonNutRaise and omahaTurnRiverRaiseNeedsNuts) licenses a raise with a full house no bigger full house beats and ignores quads. The option is registered, default off (read `=== true`), switchable live and scopable per game (`horse.omahaGameScope.omahaRiverTripsBoardBoatIsNotNutClass`).

## What It Does

PLO4/PLO5 cash (tables and Lightning), high only, one board, no bomb pot, the river, facing a wager (`server/src/engine/HorseOmahaTripsBoardBoat.ts`; in the wager_rules node after the river opening rules, before the current-nuts floor): where the rule chain raises with a full house (not quads) on a board holding three cards of one rank and some holding of the unseen cards beats it (exact count, the Horse's own cards and the known dead cards removed, so a held blocker that makes quads and straight flushes impossible keeps the raise), the raise becomes the legal call. It may call, never raise. The turn is left as it is (26 turn raises on trips boards earned +2,020 bb). Receipt `omaha_river_trips_board_boat_called`.

## What Was Measured

Every Horse river raise (or raising all-in) with a full house, PLO4/PLO5 cash Nov 12 00Z - Nov 26 06Z (the raising Horse's own cards; opponents' cards only where shown at showdown with mucked = false):

- nut-class full house river raises by board: paired board 253 raises +8,376 bb (8 of 95 showdowns lost, all to quads or a straight flush); trips board 32 raises -1,998 bb (-62 bb a raise; 11 of 21 showdowns lost, all to quads or a straight flush).
- the option on those raises (731 river raises with a full house, every class): it fires on 34 (beatable trips boards), keeps 697. Counterfactual of the call in place of the raise: 16 lost at showdown, +2,240 bb saved (the Horse's chips after the raise less the call); 9 won, -547 bb given up (the chips the opponents added after the raise); 7 without a showdown and 2 chops counted 0. Net +1,693 bb.
- speed: one exact count per river raise on a trips board (about 1 ms); relative-cost law `anOmahaTripsBoardBoatIsFast`.

## Prior anchor

- Baseline: a raise stands as today everywhere except a river full house on a trips board that some unseen holding beats.
- Own record / population weight: it reads no opponent and no rate; the count is exact on the cards.
- No unshown cards: the decision reads the public board, the Horse's own cards and the known dead cards.

## Replay

- Replay: NOT RUN (no audited decision is in its spot: the PLO hand audits of 2026-11-20..24 and 2026-11-25 hold no Horse river raise with a full house on a trips board; graded on the 731 real river full-house raises above instead)
