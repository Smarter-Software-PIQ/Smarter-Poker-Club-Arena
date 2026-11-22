# omahaPreflopReraiseDefencePricedInPosition: authority for the switch

THREEBET-2 lane (WooWoo audit programme), 2026-11-19. Default OFF in source (read `=== true`). Registered on/off: the
owner preflop range hold is lifted for this name alone, in source (HorseOptionSwitch.OPTION_SWITCH_PREFLOP_HOLD_LIFTED).
Its parent omahaPreflopReraiseDefencePriced stays off-only under that hold, as does every other held name.
Evaluation: declared before any run (audit archive `repairs/THREEBET-DEFENCE/EVAL-DECLARATION-2.md`, sha256
b9f1c147c1dc922a15ea63350358e6eaeb4670cfdae73ee508e2853110c081ff). Evidence MET (2026-11-19): the declared evaluation
PASSED on all four bars (`repairs/THREEBET-DEFENCE/EVAL-RESULTS-2.md`; section "Evaluation result" below), and the
independent review confirmed the code (01ddd45b4df CONFIRMED WITH NOTES; delta b276b064c11..afe3cda17cb MERGE CONFIRMED).

## What it does

The companion scope of omahaPreflopReraiseDefencePriced. PLO4/PLO5 cash (table cash and fast-table cash), high only,
one board, no bomb pot, no All-In-Or-Fold, not a tournament, preflop. ONLY when all of these hold
(HorseOmahaPreflopReraiseDefenceRule.omahaPreflopReraiseDefenceHeadsUpInPosition):

- the Horse made the first preflop raise (it opened);
- exactly one player re-raised it (two preflop raises in all, no 4-bet; a raise over limpers who then folded counts as
  the first raise);
- any player (identity-free since 2026-11-20: the spot reads nobody's kind; see "Identity-free" below);
- every other player has folded (heads-up; a player still in, all in included, ends the spot);
- the Horse acts after that player on every later street (seat order from the dealer).

there, and only when the decision with this option off is a FOLD, the fold becomes a CALL when the priced verdict of
omahaPreflopReraiseDefencePriced is a call (review of 01ddd45b4df, F1). It never makes a fold, never changes a call, a
4-bet or any other decision, and never invents a raise. The verdict: EV(fold) = 0, EV(call) =
R x equity x (pot after the call - rake) - call, the proposed re-raise priced the same way; equity of the exact hand
against the 3-bettor's measured re-raise width (his posterior mean through the one read interface, the population mean
with no evidence); R measured on recorded calls. One owner per cell: where the re-raised-pot call cell judges the call,
the fold stands. Everywhere else, every out-of-position decision included, the decision is
byte-identical to the option off.

POSITION, ONE DEFINITION. Heads-up, "acts after the 3-bettor" is the only reading. The fast-table pricing keeps an older
reading of position for multiway pots (HorseLogic.omahaReraisedLaneUntouched); with nobody else in the pot it gives the
same answer, and the spot reads none of those helpers. Pinned on table cash and fast-table cash by test.

Until 2026-11-20 the 3-bettor's kind (person or Horse) scoped the option to a person's 3-bet; since then the spot reads
nobody's kind (section "Identity-free"). The price reads the 3-bettor's own measured rate.

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
2. Input fidelity: MET, replay of the journaled decisions reproduces 797 of 801 replayable records of the serving builds
   (fc86566676b4, f3e99378ccbb) = 99.5%.
3. Value: MET, 45 of 46 changed in-position folds against his 3-bets are +EV calls at R 0.82 (97.8%, mean +1.79 bb)
   against his 848 recorded 3-bet holdings.
4. Reach: MET, 46 of 53 eligible recorded folds become calls; 0 out-of-position or out-of-spot decisions change.
5. Scope: PLO4/PLO5 cash only; out of position, multiway, 4-bets, cold 3-bets, tournaments, PLO6, Hi-Lo, bomb pots
   unchanged (tests).
6. Visibility: the parent's receipts.
7. Limits: the realization is the parent's fit; later streets are played by the existing brain.

## Evaluation result

Declared before any run: `repairs/THREEBET-DEFENCE/EVAL-DECLARATION-2.md` (sha256
b9f1c147c1dc922a15ea63350358e6eaeb4670cfdae73ee508e2853110c081ff, hashed 2026-11-19T01:23:58Z). Replayed 2026-11-19
01:31Z on 01ddd45b4df through the worker runtime with the recorded switch states (1,672 journaled decisions: corpus C 966,
safety set X 706). Results `repairs/THREEBET-DEFENCE/EVAL-RESULTS-2.md`:

| Bar                                                                             | Result | Numbers                                        |
| ------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| B1 replay fidelity, records of fc86566676b4 / f3e99378ccbb (>= 97%)             | PASS   | 797 of 801 = 99.5%                             |
| B2 out-of-position or out-of-spot decisions changed (= 0)                       | PASS   | 0; all 48 changes are fold -> call in the spot |
| B3 illegal actions, new errors or refusals (= 0)                                | PASS   | 0                                              |
| B4 changed in-position folds vs his 3-bets, EV > 0 at R 0.82 (>= 30 and >= 80%) | PASS   | 45 of 46 = 97.8%, mean +1.79 bb                |

Re-replay at the review fixes (afe3cda17cb: fold -> call only, a person's 3-bet only): 0 of the 1,672 decisions differ
from the evaluated run in either arm; the same 48 fold -> call changes. Review: `repairs/REVIEW-THREEBET-01ddd45b4df.md`
(CONFIRMED WITH NOTES; delta MERGE CONFIRMED).

- Mechanism, scope, tests: MET (above).
- Fidelity: MET (B1). Value: MET (B4). No harm outside the claim: MET (B2, B3).
- Overall: MET. Switch-on: authorized by the WooWoo audit programme lane (owner delegation of activation, 2026-11-18)
  once the engine serving production (`/health` releaseSha) is a build that contains this option and this file and the
  switch-list migration 20261119012343 is installed; until then no option-switch row may name it.

## League card

plo4/plo5 `_omaha_preflop_reraise_defence_priced_in_position` (HorseLeague.ts): both arms production's live set, arm A
adds this option. Declared; not run.

## What the activation row must contain

`option = 'omahaPreflopReraiseDefencePricedInPosition'`, `state = 'on'`, note `authority:
omahaPreflopReraiseDefencePricedInPosition docs/horse-option-authority.d/omahaPreflopReraiseDefencePricedInPosition.md
sha256 <the sha256 of this file as merged>`, only after its declared evaluation passes, the serving engine build knows
the option name and the switch-list migration that adds it is installed.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: LEGACY (as of 2026-11-19 this file records a replay in prose only; it was not written by the scorer's --row, so the scorer commit and the validity of its arms' option sets are not recorded. A row needs a new run)

## Identity-free (2026-11-20, lane THREEBET-POT, PLO-OWNER lead-2)

Owner order (Nov 20 9:52 AM Chicago): no rule keyed on person vs Horse. The spot no longer asks
omahaOpponentKindOf; it is the same against every 3-bettor. The price reads only that player's public re-raise rate
(omahaPreflopReraiserReadOf: his pooled read, the population envelope mean with no evidence). On this path the rule is
handed a fold, so no re-raise is a candidate and the kind-keyed fold-to-re-raise prior is never read. Paragraphs above
that scope the option to a person's 3-bet describe the build before this change. Criteria declared before the grade:
audit archive `repairs/EMERG/CRITERIA-THREEBET-POT-DEKEY.md`; results `repairs/EMERG/THREEBET-POT.md`.
