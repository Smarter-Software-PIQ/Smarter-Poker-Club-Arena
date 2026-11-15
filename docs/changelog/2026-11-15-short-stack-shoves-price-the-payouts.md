# Short-Stack Shoves Price The Payouts

2026-11-15. Hold'em Strategy lane. Owner-ordered repair of production hand 59441335. Engine source: `server/src/engine/HorseLogic.ts`
(`payJumpBubbleFactor`), `server/src/engine/IcmModel.ts`
(`bubbleFactor` values a bust at its place), `server/src/engine/HorseTournamentUtility.ts`
(`payoutWeightOfPools` exported, no behaviour change). No migration.

## What players saw

At a nine-handed final table of an 86-entrant bounty freezeout (13 paid, in
the money, blinds 3,000/6,000, 6,000 big-blind ante) a Horse in the cutoff
with 12,609 chips (2.1 big blinds) open-jammed 85o when folded to.

## Cause

The folded-to jam at <= 15bb reads the chip-EV Nash table (V71,
`nashJamProbability`), which jams 99.6% of hands at 2.1bb and 85o up to
3.5bb. The payout-aware read (`nashPushFoldIcm`) shipped opt-in because the
league carries no stack vector. Underneath it, `IcmModel.bubbleFactor`
priced a whole-stack loss as losing every payout, including ninth place,
which the player is paid either way, so it returned its cap of 5 for this
stack; the honest factor is 1.17 (5.10 pool points now, 5.74 doubled, 4.34
busted ninth).

## The correction

With the option unset, where a pay jump is live and the trusted context
carries the stacks, payouts and hero's identity, the jam and the call
against a lone jam read hero's own bubble factor, valuing a bust at the
place it finishes, moved toward 1 by prize / (prize + bounty). Not in
satellites (their seat-equity handling stands), PKOs or mystery bounties
(head value this table does not price), bounty-only events (#10614's
stand-down), heads-up, cash, or where the data is missing: there the
decision is the chip-EV one, seed for seed. Explicit `nashPushFoldIcm: false`
restores chip EV everywhere. Receipt: `pay_jump_push_fold_seen`.

## What it does and does not change

Measured on fixed inputs, before and after (logs kept by the lane):

- The reported node: 85o still jams 200 of 200, with and without the bounty.
  At a factor of 1.17 the payout-aware table jams 85o up to about 3bb. The
  audit's "folds 200 of 200" came from the bust-at-zero factor of 5, which
  would also fold 22, 44, A2o and T9s here.
- Same node: 72o jams 4 of 40 (was 40), 32o 0 of 40 (was 31). Pairs, any
  ace, KQ, suited broadways and suited connectors jam 40 of 40, as before.
- The 10bb big blind facing a 10bb cutoff jam calls tighter: in the money
  33, A4o, A2s, KTo, QJs, Q9s, JTs and T9s now fold; on a 14-left, 13-paid
  bubble only the strongest hands call (99 23 of 40).

The Phase 7 arbiter's uncertainty band still converts hand-equity error by
the whole pool. Expressing it in the utility's own units was built and
measured: it lets the arbiter overrule, and it overrules bubble folds that
`ACommittedStackIsNotFoldedAtAPrice.law.test.ts` holds (A7o and 72o calls
with a committed stack hand for hand), so it is not in this change.

## Assumed

The hand record carries no prize terms. The payout ladder is the
repository's rule for a new MTT (`fn_ca_payout_structure`, top 15%, weight
1 / place^0.8); the buy-in is 10.00 + 1.00 fee with a 2.50 bounty from the
net entry: a 645.00 prize pool and 22.50 of live bounty (payout weight
0.966).
