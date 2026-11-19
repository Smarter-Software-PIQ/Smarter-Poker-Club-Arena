# omahaPreflopReraiseDefencePricedInPosition: authority for the switch

THREEBET-2 lane (WooWoo audit programme), 2026-11-19. Default OFF in source (read `=== true`). Registered on/off: the
owner preflop range hold is lifted for this name alone, in source (HorseOptionSwitch.OPTION_SWITCH_PREFLOP_HOLD_LIFTED).
Its parent omahaPreflopReraiseDefencePriced stays off-only under that hold, as does every other held name.
Evaluation: declared before any run (audit archive `repairs/THREEBET-DEFENCE/EVAL-DECLARATION-2.md`, sha256
b9f1c147c1dc922a15ea63350358e6eaeb4670cfdae73ee508e2853110c081ff); results in that folder. Evidence NOT MET for
activation until that evaluation passes.

## What it does

The companion scope of omahaPreflopReraiseDefencePriced. PLO4/PLO5 cash (table cash and fast-table cash), high only,
one board, no bomb pot, no All-In-Or-Fold, not a tournament, preflop. ONLY when all of these hold
(HorseOmahaPreflopReraiseDefenceRule.omahaPreflopReraiseDefenceHeadsUpInPosition):

- the Horse made the first preflop raise (it opened);
- exactly one player re-raised it (two preflop raises in all, no 4-bet; a raise over limpers who then folded counts as
  the first raise);
- that player is a person (gs.humanUserIds, else his seat's is_horse; unknown is not the spot);
- every other player has folded (heads-up; a player still in, all in included, ends the spot);
- the Horse acts after that player on every later street (seat order from the dealer).

there, and only when the decision with this option off is a FOLD, the fold becomes a CALL when the priced verdict of
omahaPreflopReraiseDefencePriced is a call (review of 01ddd45b4df, F1). It never makes a fold, never changes a call, a
4-bet or any other decision, and never invents a raise. The verdict: EV(fold) = 0, EV(call) =
R x equity x (pot after the call - rake) - call, the proposed re-raise priced the same way; equity of the exact hand
against the 3-bettor's measured re-raise width (his posterior mean through the one read interface, the population mean
with no evidence); R measured on recorded calls. One owner per cell: where the re-raised-pot call cell judges the call,
the fold stands. Everywhere else, every out-of-position decision and a Horse's 3-bet included, the decision is
byte-identical to the option off.

POSITION, ONE DEFINITION. Heads-up, "acts after the 3-bettor" is the only reading. The fast-table pricing keeps an older
reading of position for multiway pots (HorseLogic.omahaReraisedLaneUntouched); with nobody else in the pot it gives the
same answer, and the spot reads none of those helpers. Pinned on table cash and fast-table cash by test.

The 3-bettor's kind (person or Horse) scopes the option to the cell that was measured and evaluated (a person's 3-bet);
it is the engine's roster, not a player's account. The price reads the 3-bettor's own measured rate.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and
  all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a
  decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range
  of hand, equity, EV etc."
- 2026-11-18 (delegation of activation to the WooWoo audit programme lane, relayed by the integrator): "YOU OWN THE
  CODEBASE, YOU DECIDE WHAT TURNS ON AND IF ITS READY"; the text it repeats, 2026-11-17 18:00 Chicago: "you own this code
  base ... turn activation on and off as you see fit."

## Recorded hands it answers

WooWoo audit, THREEBET-DEFENCE (`repairs/THREEBET-DEFENCE/LANE-REPORT.md`): the human 3-bets 48.4% of Horse opens
(848/1,751, Wilson 46.1-50.8; 62% on fast tables). Horse openers in position folded 149 times this week against his
3-bet with 0.484 mean equity against his recorded 3-bet range at a 0.31-0.32 price: 148 of 149 were +EV calls at R 0.82
(lower 95% end of the measured in-position realization, n 498), mean +4.1 bb. The folds come from the V53 pressure price
(HorseLogic.ts maniac_pressure_preflop / v53_pressure_three_bet_priced: a bar of pot odds + 0.134 in position made of
fixed margins). Out of position the verdict flips inside the measured realization interval (not shown wrong), which is
why this option leaves every out-of-position decision as it is.

## Receipts

The parent's: omaha_preflop_reraise_defence_fold / \_call / \_raise / \_changed. No new receipt.

## Tests

`server/src/engine/HorseOmahaPreflopReraiseDefencePricedInPosition.test.ts` (synthetic cards): the spot on table and
fast-table cash, two-handed, out of position, multiway, 4-bet, cold 3-bet, a Horse's 3-bet, a raise over a limper,
tournament, PLO6, flop; in the spot only fold -> call (to the parent's priced call), a call and a 4-bet unchanged; off
everywhere else byte-identical. `HorseOptionSwitchPreflopHoldLift.test.ts`: the lift names this option
alone; the parent stays off-only.

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

1. Mechanism: MET (tests above).
2. Input fidelity / 3. Value / 5. Reach: per EVAL-DECLARATION-2 (journal replay of recorded decisions, values against his
   recorded 3-bet holdings at the lower realization bound); results in the audit archive.
3. Scope: PLO4/PLO5 cash only; out of position, multiway, 4-bets, cold 3-bets, tournaments, PLO6, Hi-Lo, bomb pots
   unchanged (tests).
4. Visibility: the parent's receipts.
5. Limits: the realization is the parent's fit; later streets are played by the existing brain.

## League card

plo4/plo5 `_omaha_preflop_reraise_defence_priced_in_position` (HorseLeague.ts): both arms production's live set, arm A
adds this option. Declared; not run.

## What the activation row must contain

`option = 'omahaPreflopReraiseDefencePricedInPosition'`, `state = 'on'`, note `authority:
omahaPreflopReraiseDefencePricedInPosition docs/horse-option-authority.d/omahaPreflopReraiseDefencePricedInPosition.md
sha256 <the sha256 of this file as merged>`, only after its declared evaluation passes, the serving engine build knows
the option name and the switch-list migration that adds it is installed.
