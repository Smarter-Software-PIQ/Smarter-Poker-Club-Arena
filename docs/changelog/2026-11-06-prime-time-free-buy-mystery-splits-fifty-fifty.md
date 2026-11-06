# The Prime Time Free Buy mystery splits every chip 50/50 (2026-11-06)

Dan, 2026-11-05, Free Rolls chat, verbatim: "Yes, split all entries, rebuys and
add-ons 50/50". The Midway Union's 8:30 PM Prime Time Free Buy (NLH) is a
mystery bounty where every chip that enters the event goes 0.50 to the mystery
bounty pool and 0.50 to the regular prize pool: the promo-funded one-chip entry
head, each 1-chip rebuy, each 1-chip add-on.

## Determination: the schedule already produces the 50/50 split end to end

The production schedule row (tournament_schedules "Prime Time Free Buy (NLH)",
config bountyAmount 0.5, mysteryBountyPoolPercent 100,
mysteryBountyRegularPoolPercent 0, mysteryBountyActivation at_the_money,
mysteryBountyTopPercent 20, rebuyCost 1, addonCost 1) was read against the
engine and the migrations that are the schema of record. The keys were being
read as if 100/0 meant "the mystery pool takes 100% and the prize pool 0%".
That is not what they mean.

- `bountyAmount` 0.50 is the bounty HEAD per entering chip, the half that lands
  in `tournaments.bounty_pool`. `fn_ca_midway_free_buy_format` (migration
  20261105035220) names a Midway Free Buy "mystery" only at exactly
  `bounty_amount=0.50`, and the three money rails in that migration book the
  split:
  - registration (both register doors): `v_split.bounty:=0.50;
    v_split.prize:=0.50;` for the promo chip, then
    `prize_pool + v_split.prize`, `bounty_pool + v_split.bounty`;
  - rebuy and add-on (`fn_process_tournament_rebuy` path): the fee ratio is
    forced to 0 for every Midway Free Buy, the head
    `LEAST(bounty_amount, v_base)` = 0.50 comes off the one-chip purchase for a
    rebuy always and for an add-on when the format is mystery, and
    `prize_pool + v_base (0.50)`, `bounty_pool + v_bounty_head (0.50)`;
  - the refund/escrow split mirrors it (`refund_bounty` 0.50 for a mystery
    add-on, `refund_prize` the rest).
- `mysteryBountyPoolPercent` / `mysteryBountyRegularPoolPercent` divide only
  the BOUNTY POOL (already the 0.50 half) between the chest inventory and flat
  pre-money knockouts. `fn_mystery_bounty_seed` (20260825192304) computes
  `v_pool_cents := floor(bounty_pool * m / (m + r))` from `bounty_pool` alone;
  `mysteryPoolCents` in `server/src/tournament/mysteryBountyActivation.ts` is
  the same arithmetic. 100/0 is the chests-only shape Dan set on 2026-10-22
  (`mysteryBountyTerms.ts`, 20261022162651): the whole bounty half seals into
  chests at the money and `fn_claim_bounty_legacy_candidate_20260907` blocks any
  flat bounty before the money (`mystery_bounties_start_in_the_money`). Neither
  key reads or writes `prize_pool`.
- `mysteryBountyTopPercent` 20 is the share of the chest pool held by the
  largest chest (`buildInventoryAtUnit`), a ladder shape, not a split.
- `mysteryBountyActivation` at_the_money opens the chests when the players
  remaining reach the paid places (`mysteryBountyThresholdReached`); the
  chests-only flag lets a field of ten or fewer open too.

So with N chips in, `prize_pool` = 0.50 N and `bounty_pool` = 0.50 N; the
prize pool pays the ladder and the bounty pool pays the chests (whole chips;
the odd half chip stays in the bounty pool for the champion's residual). The
engine policy (`midwayFreeBuyPolicy.ts` `MIDWAY_FREE_BUY_FORMATS.mystery`), the
fixed board that writes the schedule config (`fixedBoardRowFor`), the creation
trigger in 20261105035220 and the two future unregistered events built from it
all carry this same shape. Nothing in the policy, the schedule row or the
events needed to change, and no migration was written.

## What this adds

- `server/src/tournament/primeTimeMysterySplitsFiftyFifty.law.test.ts` pins the
  rule: the slot policy, the fixed-board config, the built row, the three rails
  in migration 20261105035220 (read as text), and the chest pool the engine
  draws from the bounty half, with a worked 55-chip example (27.50 / 27.50).
- `docs/laws.d/prime-time-mystery-splits-fifty-fifty.md` registers it.

## Verified

- `server`: `npx vitest run src/tournament/primeTimeMysterySplitsFiftyFifty.law.test.ts src/tournament/midwayFreeBuyPolicy.law.test.ts` (21 passed)
- `server`: `npx tsc --noEmit -p .` clean
- root: `npx vitest run tests/law-registry.law.test.ts` (1317 passed)
