# omahaPreflopReraiseDefencePriced: authority for the switch

PLO Strategy lane, 2026-11-17. Default OFF in source (read `=== true`). Registered OFF-ONLY under the owner preflop range
hold (HorseOptionSwitch.OPTION_SWITCH_OFF_ONLY, PREFLOP_HOLD_SOURCE): the switch accepts an `off` row only until the
owner lifts that hold for this option in source. Evaluation result: EQUAL (declared bar; below). Evidence NOT MET for activation.

## What it does

PLO4/PLO5 cash, high only, one board, no bomb pot, preflop, the Horse facing a 3-bet or more with a fold available. The
answer of the reference brain and of the preflop re-raise rules (omahaReraiseRangeOutOfPosition / EarlyPosition,
omahaOopReraisedPotStrongRange, the cold 4-bet rule) becomes one priced decision (HorseOmahaPreflopReraiseDefence.ts):

- EV(fold) = 0; EV(call) = R x equity x (pot after the call - rake) - call; EV(re-raise) for a re-raise the earlier rules
  proposed, at their size: f x pot + (1 - f) x (R2 x equity2 x (pot2 - rake2) - risk). The largest wins. A re-raise is
  never invented.
- Equity: the exact hand against the top `width` of hands, `width` from the re-raiser's measured re-raise rate through
  one read interface (omahaPreflopReraiserReadOf: the pooled read, the population mean with no evidence, continuous in
  the evidence); a 4-bet narrows it. The Horse's cards are never dealt to him (card removal). Sampled with a seed taken
  from the cards; no draw from the brain's random stream.
- Realization R: measured on 2,023 recorded calls of a person's 3-bet or 4-bet (all-in adjusted, after rake): falls
  with the stack-to-pot ratio after the call, far more out of position; out of position the depth costs less the
  stronger the call against the range it faces (slope 3.8 per unit of equity around 0.52: fit 8.42, SE 6.23, shrunk by
  the positive-part James-Stein factor; in position the fit cannot tell the slope from zero, 0); 0.275 lower for the
  first other player already in for the price, nothing more for a second (fit 0.246, SE 0.258, shrunk to zero the same
  way; in position the recorded calls realized 0.91 / 0.67 / 0.60 with none / one / two in); players still to act are
  not players in the pot (no cost in position, 0.14 out of position); a small bounded hand-shape term; 1 when the call
  is all in.
- Rake: the table's configuration (percentage, cap, player-count cap; none on timed rake).
- No hand class, position or bet size decides on its own inside this rule.
- One owner per cell (coordination inbox 2026-11-18 00:06Z, PLO Strategy lead and WooWoo audit lane): a call that the
  re-raised-pot call cell judges (HorseOmahaOopReraisedPot.omahaOopReraisedCallCell through
  omahaOopReraisedPotStrongRange, live since 2026-11-16, and the call a re-raise range rule hands that cell; the
  out-of-position 4-bet call included) belongs to that cell, kept or folded. There this option does not answer and the
  decision is byte-identical to the option off (HorseOmahaPreflopReraiseDefence.realHands.law.test.ts, "one owner").
  This option answers only where that cell does not judge: the reference brain's own fold or re-raise, a call the cell
  leaves out of scope, or the cell's options off. The pricing of that cell's folds is the WooWoo audit lane's work.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and
  all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a
  decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range
  of hand, equity, EV etc."
- The same day: the size of the bet must not make or break a decision.

## Recorded hands and rulings it answers

Audit part 2 (audit2-01BNteGZ): Horses that raised folded to one measured winning player's 3-bet 93 of 168 times and to
his 4-bet 44 of 59. Step 1 (preflop-01BNteGZ/STEP1-PREFLOP-RERAISE-DEFENCE-CONFIRMATION-20261117.md): the folded hands
had 48-50% equity against his measured range at a 32-34% price; real calls by a Horse that had raised beat folding by
+5.66 bb (SE 2.39, n 1,164); the audited folds gave up about +818 bb (SE 426) at the measured realization. Not
confirmed out of position at a ratio of 5 or more and with players still to act, where this decision folds more than
today.

## Receipts

omaha_preflop_reraise_defence_fold, \_call, \_raise (every answer) and \_changed (differs from the answer handed in).

## Tests

HorseOmahaPreflopReraiseDefence.test.ts (the pieces and the rule) and
HorseOmahaPreflopReraiseDefence.realHands.law.test.ts (eight anonymised real audited decisions; expected answers and
equities from the independent Step 1 evaluator).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

1. Mechanism: MET (the code path above; real nodes in the law test).
2. Input fidelity: replay rebuilt with HorseComplaintReplay.stateAt, the live switch list, each person's recorded preflop
   counts loaded as the read; the table's VPIP floor window and second look were not supplied (preflop re-raise spots).
3. Value: Step 1 per cell (position, 3-bet/4-bet, ratio, players) against the recorded range; replay of real calls:
   the calls it adds made +4.23 bb (SE 3.26, n 629), the calls it removes -2.57 (SE 8.35, n 115). League: below.
4. Continuation: realization measured from recorded calls, not assumed; the fold-to-re-raise rate is the measured read.
5. Reach: 7,768 real decisions replayed: continue share of a Horse that raised, in position facing a 3-bet, 41% -> 98%;
   out of position 17% -> 41%; facing a 4-bet in position 27% -> 78%; cold callers out of position 5% -> 2%.
6. Scope: PLO4/PLO5 cash only; PLO6, Hi-Lo, multi-board, bomb pots, all-in-or-fold and tournaments excluded by gate
   (tests).
7. Visibility: the four receipts in HorseDataLedger.ts.
8. Limits: the realization is a fit with wide standard errors (out of position depth cost 0.71, SE 0.54); later streets
   after the call are played by the existing brain and are not changed here; the league field is development-grade.

## Evaluation

Declared before any run (evidence preflop-01BNteGZ/eval/PROTOCOL.md, 2026-11-17T19:35:52Z), run on engine 6cbdaf5725b
with the Omaha human-field harness, new seeds, nothing tuned on them. A = the 32 live Omaha options + this option,
B = the 32 live options; paired bb/100 of A - B.

| Run                                                          | Pairs     | A - B bb/100 | SE    |
| ------------------------------------------------------------ | --------- | ------------ | ----- |
| PLO5 human-like field, fixed identity per archetype, 5 seeds | 5 x 4,000 | -9.23        | 41.13 |
| PLO4 human-like field, fixed identity per archetype, 3 seeds | 3 x 4,000 | +35.39       | 28.69 |
| PLO4 Horse-only league card (option vs none)                 | 6,000     | -0.12        | 3.74  |
| PLO5 Horse-only league card (option vs none)                 | 6,000     | +1.39        | 3.96  |
| PLO4 Horse-only, live options in both arms                   | 6,000     | +0.32        | 1.72  |
| PLO5 Horse-only, live options in both arms                   | 6,000     | -0.82        | 2.79  |

Receipt pass (PLO5 field, 1,000 pairs): fold 580, call 118, raise 4, changed 152; no rule failure; no illegal action,
truncated street or brain fallback in any run. Verdict by the declared bar: EQUAL (nothing beyond 2 SE either way; the
option acts). The human-like field is too noisy to resolve an effect of the size Step 1 measured (about 45 bb/100 if
every changed answer were worth its 6 bb); the Horse-only tables show no harm.

Counterfactual replay of 7,768 real decisions (preflop-01BNteGZ/replay/REPLAY.md): unset and false byte-identical in
15,536 of 15,536; no receipt refusal; against Step 1's independent yardstick 1,409 decisions fixed and 177 newly wrong.
The out-of-position 4-bet cell (taken over after the league run, see the limits) was replayed on its own: 160 real
decisions, 94 folds become calls, unset and false identical, no receipt refusal; real calls of the changed spots +13.94
bb each (SE 21.24, n 48), not significant (preflop-01BNteGZ/replay/REPLAY.md addendum). The league evaluation above
ran on 6cbdaf5725b, where that cell was still left to HorseOmahaOopReraisedPot; it was not repeated.

One-owner change after these runs (2026-11-18): every figure above was measured with this option answering before
the re-raised-pot call cell. With that cell live the option now stands aside wherever the cell judges, so alongside the
live switch list it changes fewer decisions than the replay and the two "live options in both arms" rows show (of the
eight fixture hands the cell owns five on both seeds and one on one seed). The figures still describe the rule where it
answers alone. Neither the league nor the replay was repeated for the narrower scope.

## League card (rebased 2026-11-18)

League cards (HorseLeague.ts, declared): plo4_omaha_preflop_reraise_defence_priced and plo5_omaha_preflop_reraise_defence_priced: both arms carry production's live set (`OMAHA_LIVE_OPTIONS_20261118` = the 2026-11-16 live options plus omahaTurnRiverRaiseIsPriced, on since 2026-11-18 11:54Z), arm A adds omahaPreflopReraiseDefencePriced. Lead decision 2026-11-18 (PR #11286): the card as merged in #11277 (86ab7637d9e) was `{ omahaPreflopReraiseDefencePriced: true }` against `{}` (the "option vs none" rows above); the re-raise range rules, the strong-range rule and the re-raised-pot call cell it defers to are live, so the bare base measured it in a brain production does not serve. The "live options in both arms" rows above are the closer measurement (32-option base, without omahaTurnRiverRaiseIsPriced). No league has run on this card.

## Replay of the realization correction (2026-11-18, PLO Strategy successor 013U37bXeyipeVLdczYpsQG1)

Three corrections to R, each from the same 2,023 recorded calls (fit script preflop-01BNteGZ/step1-fit3.py): players
still to act split from players already in (a raiser still to act had been charged as a player in, 0.35: cold callers
in position folded where the recorded calls made +11.7 bb, SE 6.6, n 144); the second player already in shrunk to no
extra cost; the out-of-position depth cost falling with equity. Replay of the 7,768 real decisions with the live switch
list, two seeds (evidence preflop-01BNteGZ/replay-20261118/): unset and false byte-identical 15,536 of 15,536; no
receipt refusal; no rule failure. One owner per cell: where the re-raised-pot call cell judged (2,834 runs) the option's
decision is byte-identical to off in 2,824; in the other 10 (five nodes, both seeds) the cell's own receipts did not
fire: they are in-position calls that a re-raise range rule made of a proposed re-raise, and the option kept the
re-raise. Calls the option removes, as played and against folding: 3 (11 with the first correction alone; +9.95 bb, SE
37.6), none in the audited window. Re-raises it turns into folds: 4 (14 with the first correction alone), the aces of #59801362 seat 4 (audited
correct 4-bet) no longer among them.

Joined BY DECISION NODE (hand, seat, preflop, amount to call) to the WooWoo 48-hour audit (1,494 of the replayed nodes
join): 1,194 unchanged, 76 fixed, 224 newly wrong. 160 of the newly wrong are folds in position, nobody else in for the
price and players still to act, audited correct (mostly "Preserve folding ... to 3-bets"), that the option calls; the
recorded calls of that cell made +10.8 bb each (SE 6.5, n 80) but were chosen by the Horses, so they do not price the
hands the Horses folded. One audited-wrong fold that the off decision now re-raises the option folds (#59721834 seat 2,
out of position at a ratio of 8.2, equity 0.51 against the range at a 0.33 price); the recorded out-of-position calls
at that depth and equity realized 0.38 (n 386, -5 to -6 bb against folding), so the price stands. Against the audit
the value row is NOT MET.

The option stays OFF.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

Review R1 B1 of preflop 070d002127e (one owner per cell), fixed in the batch:

- seam a: a verdict of a re-raise range rule's cell (omahaReraiseByPositionCell: kept, called or folded) now counts as judged, so this option does not answer there (HorseLogic omahaReraiseRangeRules sets the judged flag);
- seam b: a call this option makes (from a fold or a re-raise) is run through the live re-raised-pot call cell whenever omahaOopReraisedPotStrongRange is on, exactly as a call the re-raise range rules leave.
  Tests: HorseOmahaPreflopReraiseDefence.realHands.law.test.ts (seam b on hand 59830020 seed 1; seam a on every fixture seed 1-40 a range cell judged, and the source pin).
  Main moved under this option: since #11247 (0edbb56d179) the live call cell prices the call its class cell folds, so five of the eight audited folds are calls today (the test's "today" column was re-pinned to main).
  Notes: N1 EV(re-raise) (HorseOmahaPreflopReraiseDefence.ts) assumes the players already in also fold to the re-raise, which overstates a multiway re-raise; N2 the receipt validator's admission of a priced call is option-independent (precedent omahaReraiseToCall).
