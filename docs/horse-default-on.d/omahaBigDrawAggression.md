# omahaBigDrawAggression (owner instruction 2026-11-15 11:55 America/Chicago; branch agent/plo-combodraw-01BbZPDi/feat/omaha-big-draw-aggression, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

On the full human-table sweep (PLO4/PLO5 cash, 4,573 hands, 2026-11-10 to 2026-11-15) the Horses held a big draw at 584 flop and turn decisions. Facing a bet they could raise they raised 12 of 198 times (6%), called 125 and folded 61; checked to they bet 196 of 377 (51%) at about half the pot (42% out of position, 39% multiway). The winning humans raised the same draws 8 of 30 times (the top winner 3 of 5) and bet them 18 of 37 at 83% of the pot. The existing aggression paths are random mixes at low frequencies behind narrow gates (archive `plo-handoff-review-01a1cbbd/combodraw-20261115/TRACE.md`).

The option (`omahaBigDrawAggression` in `HorseLogic.ts`, outermost wager rule on both decision paths) asks `omahaBigDrawVerdict` in `server/src/engine/HorseOmahaBigDrawAggression.ts` about a check or a call on a PLO4/PLO5 cash flop or turn. For a declared big draw (the nut flush draw with a wrap, a straight draw or top pair or better; a 13+ out wrap with nine nut outs; top pair or better or a flush draw with nine nut straight outs; outs counted by enumeration with the two-card rule) it compares the passive line with a pot-sized bet or raise, or the stack when a later street puts it in anyway: aggressive = F _ P + (1 - F) _ (E*called * final pot - cost), check = R _ E_all _ P, call = R \_ E_bet \* (P + c) - c. The wager is made only when its value is the higher one by 2% of the pot and positive.

Owner ruling 2026-11-15 12:30 ("RAISING WITH DRAWS SHOULD NEVER HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO DRAWS, NOT NAKED NUT FLUSH DRAWS."): the option makes no raise and no new bet out of position, and in position raises only a combo draw (every class but the bare 13-out wrap). The recorded hands of the tests were out of position as played, so they are unchanged as played; the tests place the Horse in position to show the wager.

## Input fidelity

Status: MET

Public state, the Horse's own cards, and each live opponent's fold to a bet from the opponent memory's decayed counters (`HorseMind.omahaReadConditionalOf(...).foldToBet.mean`, the posterior mean shrunk to the Horse mean, the same counters every exploit read uses). Without a read (the mind off, no counters) the population prior 0.42, the sweep's humans' fold to a Horse bet of 70% of the pot or more heads-up (233 of 551). A raise scales the fold by 0.42 (the humans folded their own bet to a Horse raise 20 of 114 times); the memory keeps no fold-to-raise counter. Equities are one seeded sample (700 opponent hands, three run-outs each) split by the range the opponent hand is in; the brain's random stream is not drawn.

## Value

Status: NOT MET

Not yet measured. The sweep's results do not show the passive lines losing chips (the passive hands with 40%+ raw equity netted +1,373 bb), so the claimed value is fold equity not taken, which only a paired evaluation can price. League cards `plo4_omaha_big_draw_aggression` and `plo5_omaha_big_draw_aggression` (6,000 pairs, production styles); the protocol and pass rule are to be declared in the archive before any graded run, and the verdict recorded in `docs/changelog/2026-11-15-omaha-big-draw-aggression.md`.

## Continuation

Status: NOT MET

Not measured separately. The wager does not register a barrel plan; the turn and river after it are played by today's brain. The paired evaluation's arms include every later street.

## Reach

Status: NOT MET

Not counted in production. On 60 recorded passive Horse decisions with a declared big draw (41 sweep hands replayed, six seeds each) the option changed 18: 13 of 26 checks and 5 of 34 calls or folds. That count predates the 12:30 ruling: most of those decisions were out of position and no longer change, and in position today's brain already bets a checked-to big draw about 29 times in 30, so the reach is now mainly the in-position raise of a combo draw (in the replayed in-position node: 2 raises in 30 before, 30 in 30 with the option) and is not yet counted.

## Scope

Status: MET

PLO4 and PLO5 cash, one board, high only, flop and turn, one or two live opponents, none all in. Outside: hi-lo, PLO6, tournaments, bomb pots, several boards, all-in-or-fold tables, capped wagers, the river, three or more opponents, two opponents unless the draw is at the nut end (nine or more nut outs, 70% of its outs), a decision facing a raise of the Horse's own bet, paired boards, trips or better, a bare gutshot or open-ender, a flush draw below the nuts without nine nut straight outs, a bare nut flush draw. Only a check or a call can change; a fold, a bet and a raise are returned as they are. Cases in `HorseOmahaBigDrawAggression.test.ts`: off byte-identical; by class and position: in position a combo draw facing a bet raises the pot and a checked-to big draw bets it, out of position nothing changes; the recorded top pair with the nut flush draw (the check is priced higher), a recorded three-way wrap short of the nut end and a made top set are unchanged.

## Visibility

Status: MET

Receipts in `HorseDataLedger.ts`: `omaha_big_draw_aggression_raise`, `omaha_big_draw_aggression_bet`, `omaha_big_draw_aggression_withheld` (a declared big draw the rule examined and kept passive). League cards `plo4_omaha_big_draw_aggression` and `plo5_omaha_big_draw_aggression`.

## Limits

Status: MET

- The expected value is a one-street model: the pot if called is the final pot, and the passive line realises all of its equity in position and 80% out of position. Both are declared constants, not measurements.
- The continuing ranges are made hands and flush draws (two pair or better, the nut flush draw, top pair or an overpair with a flush draw; against a raise trips or better, top two pair, the nut flush draw with a pair). Straight draws are not in them.
- The fold to a raise is the fold to a bet scaled by one sweep-wide constant.
- The equities are a seeded Monte Carlo sample, not an enumeration.
- A big draw the brain folds stays folded.
- Live behaviour is unverified: the option is off.

## The combo draw made precise (2026-11-16, owner 12:30 and 12:52)

One definition (`omahaComboDrawForRaise`, `HorseOmahaBigDrawAggression.ts`) serves omahaTurnRiverRaiseNeedsNuts's in-position turn exception, omahaNoDrawRaiseOutOfPosition's bar and omahaBigDrawAggression's in-position raise: a hand below two pair holding a flush draw (five or more flush outs) together with a straight draw of eight or more outs, a 13+ out wrap with a flush draw included; straight outs are counted by rank under the two-card rule, a card that also completes the flush included (`omahaComboStraightOuts`). A pair adds nothing: a pair with the nut flush draw is not a combo draw, nor a pair with the nut flush draw and a gutshot (it does not raise), nor a pair with a wrap and no flush draw. Before this, a strong pair with any draw counted (and in the big-draw rule every class but the bare wrap). Tests: HorseOmahaBigDrawAggression.test.ts (`omahaComboDrawForRaise`).
