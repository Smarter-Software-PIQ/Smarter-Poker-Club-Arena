# nashPushFoldIcm (pull request: NOT YET OPENED)

Owner-ordered repair of production hand 59441335. The pull request number is
not known when this file is written; the lane lead replaces the heading's
"NOT YET OPENED" with the pull request reference when the pull request is
opened. Until then `HorseDefaultOnNeedsEvidence.law.test.ts` fails on "a pull
request reference", and on nothing else.

What is on by default: with the option unset, a no-limit hold'em tournament
short stack whose trusted context carries the stacks, the payouts and its
identity, with a pay jump live (in the money, hand for hand, near the bubble
or within max(paid + 1, 1.15 x paid)), more than two left, not a satellite,
PKO or mystery bounty and with a payout weight above zero, reads the V71
folded-to jam and the nashCallVsJam call at its own bubble factor
(`payJumpBubbleFactor`), moved toward 1 by prize / (prize + bounty), with a
bust valued at the place it finishes (`bubbleFactor`, corrected 2026-11-15). Explicit
false is chip EV everywhere (the behaviour before); explicit true is the
2026-11-07 arm.

## Mechanism

HorseLogic V27 CASE A (unopened, <= 15bb) -> V71 `nash71`. Before: with the
option unset it read `nashJamProbability` (chip-EV Nash, first caller only).
At hand 59441335 (cutoff, 12,609 chips, 2.1bb, three behind, 1bb ante) that
table jams 99.6% of hands; 85o up to 3.5bb, so p(jam) = 1.0. Now
`payJumpBubbleFactor` returns 1 + (B - 1) x w with B =
`bubbleFactor` = 1.174 (hero's ICM equity 5.10 pool points, 5.74 if
doubled through the covering stack, 4.34 if busted ninth; before
2026-11-15 `bubbleFactor` priced the bust at 0 and returned its cap, 5) and w = 0.966
(assumed 645.00 prize, 22.50 live bounty), so 1.168, and the jam reads
`nashV2JamProbability` at that factor. The call path (nashCallVsJam) reads
the same factor.

## Input fidelity

The replay is reconstructed, not recorded: stacks, blinds, ante, positions,
entrants, paid places and players left are the hand's; the payout ladder is
the repository's rule for a new MTT (fn_ca_payout_structure, 15%, weight
1 / place^0.8) and the prize and bounty pools are assumed (buy-in 10.00 +
1.00 fee, 2.50 bounty from the net entry). Supplied by hand: payout ladder,
pool sizes, bounty per head, the Horse persona and style (the
ABountyOnlyEventKeepsTheReferenceAction fixture), opponent reads (none), the
table's VPIP floor (fixture value), HorseMind memory (reset per seed). The
live decision also reads opponent memory and persona adherence, which this
replay does not carry.

## Value

NOT MET (owner-ordered repair of hand 59441335). No per-node expected value
of the new action against the old one under three stated opponent ranges was
measured. What was measured: the ICM inputs above, and the table each action
is read from. The Phase 7 arbiter's own valuation at the reported node, with
this change: fold 4.93 +/- 0.005, jam 4.72 +/- 0.31 pool points (bounty);
fold 5.10, jam 4.91 +/- 0.32 (no bounty), so its point estimate prefers fold
inside its band and it keeps the reference action. Simulated values are not
production gains.

## Continuation

NOT MET (owner-ordered repair of hand 59441335). The Nash tables are first
caller only; overcall frequencies behind a short-stack jam were not measured
from recorded hands (no production database access in this task).

## Reach

NOT MET (owner-ordered repair of hand 59441335). Not measured on production
decisions. Measured on fixed inputs (logs/shove/before-after-table.txt,
208 fixed-input cells, 40 to 200 seeds each): changed cells are the bottom of
the 2.1bb jam range at the reported node (72o 40/40 -> 4/40 jams, 32o 31/40 ->
0/40; 85o and 93o unchanged at that depth) and the 10bb big-blind call
against a 10bb cutoff jam (in the money: 33, A4o, A2s, KTo, QJs, Q9s, JTs,
T9s call -> fold; on a 14-left, 13-paid bubble: 99 40 -> 23 calls, 66, 33,
AJo, A8o, A4o, A2s, KQo, KJs, KTo, QJs, Q9s, JTs, T9s call -> fold). Every
other cell is byte-identical.

## Scope

Reached: no-limit hold'em tournaments (MTT, SNG, multi-place spin) through
V71 (ante present, <= 15bb, unopened) and nashCallVsJam (lone open-jam,
<= 20bb). Gated out, each with a decision-level case in
AShortStackJamPricesThePayJump.law.test.ts showing every seed equals the
explicit chip-EV arm: bounty-only events (payout weight 0), no pay jump live,
no stack vector, no payouts, untrusted context, satellites, PKO, mystery
bounty, heads-up (two left), ante cash tables. Omaha (HorseOmahaTournamentFirstIn),
fixed limit and short deck never reach either path (pinned byte-identical in
the before/after table). A no-ante tournament keeps the V27 charts.

## Visibility

Receipt `pay_jump_push_fold_seen` (HorseDataLedger, family NashV2) fires
whenever the default reads a bubble factor above 1, on either path; it ends
in `_seen` because days with no in-the-money short stack are normal.

## Limits

The reported 85o still jams at the reported node: with ninth place paid
whatever happens the honest bubble factor is about 1.17, and at that factor
the table jams 85o up to about 3bb. The audit's "folds 200/200 with
nashPushFoldIcm" came from bubbleFactor pricing a bust at zero (corrected 2026-11-15),
which would also fold 22, 44, A2o and T9s at 2.1bb. The tables are first
caller only and ignore the free hands before the blind. The Phase 7 band
units were not changed (they would overrule bubble folds that
ACommittedStackIsNotFoldedAtAPrice holds). No league card: the league's
tournament contexts carry no stack vector, so the default is unreachable in
self-play and a card would deal two identical arms. Pools are assumed.
