# Short-Stack Shoves Price The Payouts (option, default OFF)

2026-11-15. Hold'em Strategy lane. Owner-reported production hand 59441335.
Engine source: `server/src/engine/HorseLogic.ts` (`payJumpBubbleFactor`, the
`nashPushFoldIcm === true` arm of the V71 jam and the nashCallVsJam call),
`server/src/engine/HorseTournamentUtility.ts` (`payoutWeightOfPools`
exported, no behaviour change), `server/src/benchmark/HorseLeague.ts`
(league card `mtt6_ft_pay_jump_push_fold_12bb`). No migration. The plain
repair it stands on, a bust in the money is worth its place, is its own
change: `docs/changelog/2026-11-15-a-bust-in-the-money-is-worth-its-place.md`.

## What players saw

At a nine-handed final table of an 86-entrant bounty freezeout (13 paid, in
the money, blinds 3,000/6,000, 6,000 big-blind ante) a Horse in the cutoff
with 12,609 chips (2.1 big blinds) open-jammed 85o when folded to. Two
players woke up behind it; the small blind had 9-9.

## Verdict on hand 59441335

The shove was close to correct, and the fixed code still makes it, in both
arms. With 15,000 already in the pot (small blind 3,000, big blind 6,000,
ante 6,000) the cutoff risks 12,609 to win at least 15,000; 85o has about
41% against a random big blind and needs about 37%, so on chips it is a
small gain and with no fold equity it does not need any. With ninth place
paid whatever happens, its true bubble factor is about 1.17 (5.10 pool
points now, 5.74 doubled, 4.34 busted ninth; 1.168 once the bounty share is
counted), and at that factor the payout-aware table still jams 85o up to
about 3bb. The earlier "folds 200 of 200 with payouts on" came from
`bubbleFactor` pricing the paid bust at zero (factor 5), which would also
have folded 22, 44, A2o and T9s there. Pinned: `the verdict: 85o at the
reported node still jams, in both arms`.

## Cause of the reported read

The folded-to jam at <= 15bb reads the chip-EV Nash table (V71,
`nashJamProbability`), which jams 99.6% of hands at 2.1bb and 85o up to
3.5bb. The payout-aware read (`nashPushFoldIcm`) shipped opt-in because the
league carries no stack vector. Underneath it, `IcmModel.bubbleFactor`
priced a whole-stack loss as losing every payout, including ninth place,
which the player is paid either way.

## The change

`nashPushFoldIcm` stays DEFAULT OFF. It changes a preflop range, so the
owner's preflop range hold keeps it off until he lifts it by name, and the
option switch registers it off-only. Unset or false, the jam and the call are
exactly what they are on main (pinned seed for seed). With the option on:

- where a pay jump is live and the trusted context carries the stacks,
  payouts and hero's identity, the jam and the call against a lone jam read
  hero's own bubble factor (a bust valued at the place it finishes), moved
  toward 1 by prize / (prize + bounty);
- the call prices the chips contested (the effective depth), not hero's
  whole stack, so a deep stack facing a crumbs jam is not charged a
  whole-stack risk;
- not in satellites (their seat-equity handling stands), PKOs or mystery
  bounties (head value this table does not price), bounty-only events
  (#10614's stand-down), heads-up, cash, Omaha, fixed limit, early levels
  or where the data is missing: there the option-on decision equals the
  default, seed for seed;
- every other spot reads the V2 table at a bubble factor of 1 (the V71
  answer with at most eight behind; a ten-handed seat reads nine behind).

Receipt `pay_jump_push_fold_seen` fires only with the option on.

## What the option changes when on (fixed inputs, logs kept by the lane)

- The reported node: 85o still jams; 72o jams 4 of 40 (was 40), 32o 0 of 40
  (was 31). Pairs, any ace, KQ, suited broadways and suited connectors jam
  every time, as before.
- The 10bb big blind facing a 10bb cutoff jam calls tighter: in the money
  33, A4o, A2s, KTo, QJs, Q9s, JTs and T9s fold; on a 14-left, 13-paid
  bubble only the strongest hands call.

## Owner rulings pinned (both arms)

- A 25bb big blind calls a 2.5bb jam with almost anything (2026-10-26).
- No open-shove from under the gun at 20bb or 35bb (2026-10-25).

## Not in this change

The Phase 7 arbiter's uncertainty band still converts hand-equity error by
the whole pool (equity error x 100 x payout weight), larger than a short
stack's whole tournament equity, so it always keeps the reference action.
A version in the utility's own units (the equity-to-utility slope) was
built and kept out: an earlier form of it overruled bubble folds that
`ACommittedStackIsNotFoldedAtAPrice.law.test.ts` holds, and it is a live
change to every tournament decision, so it needs its own option, card and
review. The patch is kept by the lane.

## Assumed

The hand record carries no prize terms. The payout ladder is the
repository's rule for a new MTT (`fn_ca_payout_structure`, top 15%, weight
1 / place^0.8); the buy-in is 10.00 + 1.00 fee with a 2.50 bounty from the
net entry: a 645.00 prize pool and 22.50 of live bounty (payout weight
0.966).
