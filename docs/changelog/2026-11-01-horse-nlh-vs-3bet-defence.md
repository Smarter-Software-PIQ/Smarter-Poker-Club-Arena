# V73: the Hold'em opener's answer to a 3-bet reads its own open (2026-11-01)

Next phase of the horse NL Hold'em upgrade after V70 (the open) and V72 (the
answer to the open). This one is the opener's answer to the 3-bet.

Option: `v73Vs3BetDefence` (default on, explicit `false` keeps today's
branch), registered in `HorseDataLedger.ts` with the `v73_vs3bet_defence`
receipt. Module: `server/src/engine/HorseGtoVs3BetRanges.ts`. Wiring:
`HorseLogic.ts` (the spot and its read), `HorsePreflop.ts` ("Facing a 3-bet
or bigger").

## Measured first (production, SELECT only)

Horses that made the only open and then faced one 3-bet, no-limit hold'em,
three or more dealt in, the 3 hours to about 03:00 UTC 2026-11-01
(`ca_hand_facts` opener rows joined to `hand_history.actions` for the 3-bettor,
the 3-bet size and the opener's answer).

| slice (all depths)      | n     | fold  | call  | 4-bet |
| ----------------------- | ----- | ----- | ----- | ----- |
| tournament              | 2,937 | 68.3% | 18.5% | 13.2% |
| cash                    | 1,017 | 73.0% | 17.8% | 9.2%  |
| tournament, in position | 1,644 | 75.6% | 14.0% | 10.4% |
| tournament, out of pos. | 1,293 | 58.9% | 24.3% | 16.8% |
| cash, in position       | 632   | 77.2% | 16.0% | 6.8%  |
| cash, out of position   | 385   | 66.0% | 20.8% | 13.2% |

By opener seat at 25bb+ effective: tournament BTN 87.4%, CO 76.4%, HJ 73.2%,
LJ 69.2%, UTG 43.3%, UTG+1 47.2%, SB 89.7%; cash BTN 84.7%, CO 75.2%, HJ
67.8%, UTG 59.5%, SB 72.7%. By 3-bet size (tournament): under 2.6x 41.8%,
2.6-3.4x 62.8%, 3.4-4.5x 71.1%, over 4.5x 71.5%. Depth barely mattered
(67-72% in every bucket from under 25bb to over 120bb).

What folded (25bb+): suited hands outside the aces and broadways (suited
connectors, gappers, small suited kings and queens) 99%; suited broadways
47-52%; suited aces 53-57%; pairs 32-44% (22-99, and JJ / TT at times);
offsuit broadways 74-80% and offsuit aces 99-100% (most of that is Dan's
dominated-offsuit rule, which is correct and stays).

A solver-like opener folds roughly 40-55% at 100bb, less in position and
against wider 3-bettors. Folding 70-87% from the late seats hands every
re-raiser a profit with any two cards.

## Root cause

The "Facing a 3-bet or bigger" branch continued on a FIXED bar on the
high-card ladder: `t53(ip ? 0.74 : 0.78)` (top ~7% of all hands in
position, ~5% out of it), with V60 cash pressure `0.66 / 0.72` (top 10% /
8%) and V57 tournament aggression `-0.02`. That bar is the same whoever
opened, so a seat that opens 15% of hands continued about half its range and
a seat that opens 45% continued about a sixth of it: exactly the
production curve (UTG ~45%, BTN ~86% fold). And because it read the
high-card ladder, the width it did have went to offsuit broadways (which
Dan's 2026-10-25 rule then folds to a big 3-bet) before the suited
connectors, suited aces and pairs a solver continues. A general price relief
(`relief3`) then widened it again by an amount that depended only on the
pot odds, not on who opened.

## The fix (root)

`HorseGtoVs3BetRanges.ts`, read from `HorseLogic` when: hero made the only
open (the first raise, its only voluntary action), exactly one player
re-raised, nobody called either raise, no limpers, two hole cards, no-limit
hold'em (not Omaha, short deck, fixed or pot limit), not all-in-or-fold, not
straddled, three or more dealt in, the 3-bettor not all-in, the 3-bet 1.8x to
7x the open, 25bb or more effective against the 3-bettor.

- **Seats.** The opener is indexed by dealt-in players behind it, the V70
  index (SB 1, BTN 2, CO 3, HJ 4, LJ 5, UTG+2 6, UTG+1 7, nine-handed UTG 8),
  from the dealt census. The opener is in position when the 3-bettor is a
  blind and the opener is not.
- **Width = a share of the opener's own open.** The continue (call or 4-bet)
  width is `share x open width`, where the open width is V70's per-seat target
  for this table (cash / ante, three-handed) at the horse's own tightness
  (the tightness moves the open, so it is applied there and NOT again to the
  share: every style folds a similar share of what it actually opened).
  Shares at 100bb against the reference size:

  | opener          | SB  | BTN | CO  | HJ  | LJ  | UTG+2 | UTG+1 | UTG (9) |
  | --------------- | --- | --- | --- | --- | --- | ----- | ----- | ------- |
  | in position     | -   | 46  | 50  | 54  | 58  | 60    | 61    | 62      |
  | out of position | 44  | -   | 50  | 53  | 56  | 58    | 59    | 60      |

  Scaled by `sqrt(reference / size)` bounded 0.75-1.2 (reference 4x for a
  blind 3-bettor, 3x for an in-position one), widened up to 15% at 25bb (from
  40bb down), narrowed up to 5% by the V21 deep scale past 120bb (zero at
  120bb, full at 250bb; the stack-off discipline lives on the 4-bet and 5-bet
  bars, which are unchanged), and +4% with an ante.

  These shares sit above a solver's because Dan's dominated-offsuit rule
  folds an opener's offsuit unpaired hands other than AKo / AQo to any 3-bet
  of 2.5x or more, and those are 35-55% of a late open. The share is what
  continues of everything else.

- **Order.** Hands are read on a continue order blended between a late-opener
  chart (button vs a blind 3-bet) and an early-opener chart (UTG vs a 3-bet),
  mapped onto the preflop score scale by combo share (V70's `scoreAtShare`).
  The charts hold pairs, suited hands and AKo / AQo only, so the width is
  never spent on a hand the owner rule folds. Late: every pair (22 at 0.7),
  every suited ace, KTs+ with K5s-K9s partly, QTs+ and Q8s-Q9s partly, JTs
  and J8s-J9s, T8s+, 97s, 87s-86s, 76s-75s, 65s-64s, 54s. Early: 66+ then
  the small pairs, AJs+ and the wheel aces ahead of A6s-A9s, KJs+ / KTs, QJs /
  QTs, JTs, T9s, 98s, 87s, 76s, 65s, 54s partly.
- **In HorsePreflop.** The call bar becomes `capBar(continueBar + ICM
premium)` minus the hunter / squeeze reads plus the Phase 6 shift, and the
  call reads the hand on the V73 order. The V57 / V60 call widening and the
  general price relief are not added on top (the per-seat width owns the
  call, and the 3-bet size is already priced); the committed-stack relief,
  the floor, the stack cap and the credible re-raiser read still apply.

Unchanged: value 4-bets and the 4-bet bluff (legacy ladder bars, V57 / V60
4-bet tweaks included), the 5-bet branch and Dan's 2026-10-25 deep rule (at
60bb+ in a tournament only AA / KK stack off facing a 4-bet), every rule in
`HorseHoldemPremiumAggression.ts` (dominated offsuit fold, premiums never
flat), squeezes, cold calls of a 3-bet, multiway and short-stack spots, PLO
and every other variant. Never keyed on who the opponents are.

## Simulated after (end to end through HorseLogic.decide)

Balanced horse, the opener's own measured open range as the weight, 6 seeds
per class (`HorseVs3BetDefence.test-support.ts`), on main after #9065 (a
non-premium hand that wanted to 4-bet calls instead). Cash 6-max 100bb, 2.5x
open, 4x 3-bet from the big blind unless stated. Fold percent of the open
range, before -> after:

| spot                            | before | after |
| ------------------------------- | ------ | ----- |
| BTN vs BB                       | 74.3   | 54.5  |
| BTN vs SB                       | 73.2   | 54.5  |
| CO vs BB                        | 57.2   | 46.4  |
| CO vs BTN 3x (out of position)  | 50.9   | 46.4  |
| UTG vs BB                       | 41.6   | 39.3  |
| UTG vs BTN 3x (out of position) | 31.9   | 41.2  |
| SB vs BB                        | 79.5   | 63.7  |
| MTT 9-max 50bb ante, BTN vs BB  | 82.2   | 54.8  |
| MTT 9-max 50bb ante, HJ vs BB   | 66.8   | 43.0  |
| MTT 9-max 50bb ante, UTG vs BB  | 48.8   | 35.1  |
| MTT 9-max 50bb ante, UTG vs BTN | 47.2   | 44.7  |
| cash 250bb, BTN vs BB           | 81.1   | 56.2  |
| cash 250bb, UTG vs BTN 3x       | 49.9   | 51.0  |

Styles on the button vs the big blind: tag 77.3 -> 54.1, lag 72.1 -> 55.4,
grinder 78.6 -> 54.7. The 4-bet share is identical before and after in
every spot. What the button now continues that it folded: 22-44, K5s-K9s,
Q9s, J9s, T8s-T9s, 97s-98s, 86s-87s, 75s-76s, 64s-65s, 54s. What it still
folds: K2s-K3s, Q2s-Q7s, J4s-J7s, T5s-T6s, 95s-96s, 85s, 74s, 63s, 53s,
43s, and every offsuit hand but AKo / AQo.

The small blind stays above the band (63.7%) because about half of a small
blind open is offsuit and folds by the owner rule; out of position the
under-the-gun open now folds 41% to a 3x button 3-bet where the legacy price
relief continued 68% of it.

League (`server/scratch/league-v73.ts`, human-calibrated field twin, three
seeds x 6,000 pairs, V73 on vs off): 100bb +1.26 / -2.44 / +3.49, 40bb
+1.89 / -1.44 / +1.91, 200bb +0.99 / -7.42 / +3.27, MTT 40bb +1.95 / -1.48 /
+0.69, MTT 25bb +1.39 / -0.97 / +0.03 bb/100; no card below -2 stderr. The
league is low-power for this node (11-19 divergent pairs per 6,000: the
field rarely 3-bets a horse's open), so it says only that the change is not
a measurable loser there; the production receipt and the fold-to-3-bet curve
by seat are the measurement to read after release.

## Tests

- `server/src/engine/HorseVs3BetDefence.test.ts`: the module (orders are
  permutations, charts hold no dominated offsuit hand, shares rise as the
  opener moves earlier, size and deep scaling, the styled open width) and the
  end-to-end bands above, the off arm's measured overfold, 4-bets unchanged,
  the button's suited hands and pairs continuing, dominated offsuit hands
  still folding, styles, the ante tournament.
- `server/src/engine/HorseVs3BetDefence.law.test.ts` (registered in
  `docs/laws.d/the-opener-facing-a-3-bet-keeps-the-owner-rules.md`): the
  dominated-offsuit fold for every style and seat, the facing-a-4-bet-or-more
  decision identical with V73 on and off (cash and the deep ante tournament),
  and flipping which seats are horses never changes the answer.

## After release

Read `v73_vs3bet_defence` against `decide_nlh` (floor 0.002) and repeat the
by-seat SELECT above: the target is the late seats near 50-60% and the early
seats near 35-45%, with suited connectors and small pairs continuing from the
button and the offsuit broadways still folding.
