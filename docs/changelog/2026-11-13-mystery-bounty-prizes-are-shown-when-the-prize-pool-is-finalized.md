# Mystery bounty prizes are shown when the prize pool is finalized

Dan, 2026-11-13, verbatim: "WHY ARE THE MYSTERY BOUNTIES NOT DISPLAYING?! ONCE
THE PRIZE POOL IS 'FINALIZED' (AFTER THE ADD ON PERIOD) ALL MYSTERY BOUNTY
PRIZES SHOULD BE SHOWN... DO NOT WAIT UNTIL PLAYERS ARE ITM TO REVEAL MYSTERY
BOUNTY PRIZES." For this and every other mystery bounty tournament.

## Cause

The chest inventory was only cut inside `maybeActivateMysteryBounty` when the
mystery phase opened (at the money for every chests-only event), and the lobby
panel lists `fn_mystery_bounty_inventory`, which read only
`tournament_bounty_chests`. Between the entry close and the money the Bounties
tab therefore had the pool total and "Not Drawn Yet", with no prizes.

## Change

- Engine: on the first elimination sweep after entry closes
  (`prize_pool_finalized`), `maybeSealMysteryLadder` cuts the real ladder from
  the actual finalized pool, for the players who will be left when the phase
  opens (`mysteryBountyThresholdPlayers` minus one), with the same builder and
  shuffle the activation uses, and stores it with `fn_mystery_bounty_seal`. It
  broadcasts `mystery_bounty_sealed` so open lobbies re-read.
- Database (`20261114034527`): new table `tournament_mystery_sealed_ladders`
  (no foreign key, RLS on, no client grants), `fn_mystery_bounty_seal`
  (service role only, idempotent, same pool arithmetic and whole-chip cut as
  the seed), `fn_mystery_bounty_inventory` lists the sealed ladder while the
  stage is `pending`, and `fn_mystery_bounty_seed` puts the sealed chests into
  play when the chest count and pool still match.
- Client: `useMysteryBounty` re-reads on `mystery_bounty_sealed`; the waiting
  copy says the prizes are shown once the prize pool is finalized.

## What did not change

No bounty is paid before the phase opens (Dan 2026-10-22). Nothing is written
to `tournament_bounty_chests` or `tournaments.mystery_bounty_pool_cents` before
activation, so every terminal guard that requires a pending event to carry no
inventory is untouched. No projected figures: the ladder is cut only from the
finalized pool.

## Known edge

If the field at activation is smaller than the threshold (two players bust on
the bubble hand, or a bust already played is still unrecorded), there is one
elimination fewer than sealed chests. The seed then uses the inventory the
engine cuts at that moment for the same pool, as it always has, so every chip
of the pool is still paid by knockouts; the tier counts shown can change by
that one chest.

## Delivery

The client and the migration ship on merge. The engine half activates at the
daily 04:00 America/Chicago engine window; events whose entry closes after
that show their prizes from the close.
