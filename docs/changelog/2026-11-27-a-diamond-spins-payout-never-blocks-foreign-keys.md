# A Diamond Spins Payout Never Blocks Foreign Keys (2026-11-27)

## What Happened

2026-11-25 8:33 PM Chicago (2026-11-26 02:33:27.913 UTC), sqlstate 40P01. A
horse's Midway Free Buy registration (`fn_register_horse_for_tournament_to_target`,
Prime Time Free Buy, a mystery format) was killed as the deadlock victim; the other
side, a horse's Diamond Spins wheel prize paid into Deep Stack Society through
`fn_horse_diamond_spins`, committed (its `wheel_midway_chip_funding` row carries the
transaction start 02:33:26.724 UTC). One occurrence in the logs; the registration
was simply lost for that call.

## Cause, Both Edges From The Live Definitions

- Registration: `fn_register_horse_for_tournament_before_maintenance_gate` inserts
  the `tournament_players` row. Its `club_id` (stamped by `fn_stamp_entry_club`)
  is checked by `tournament_players_club_id_fkey`, which holds FOR KEY SHARE on
  that clubs row to COMMIT (`fn_guard_retired_club_mutation` also holds FOR KEY
  SHARE on the event's club). Then `fn_ca_midway_free_buy_promo_head` line 88
  UPDATEs the Midway `union_wallets` row, and waited there.
- Diamond Spins: `fn_diamond_game_pay_chips` first calls
  `fn_diamond_game_cover_lock`, which locks the `union_wallets` row FOR UPDATE,
  then for every union-hosted prize runs
  `SELECT chip_treasury ... FROM public.clubs WHERE id = p_club FOR UPDATE`.
  FOR UPDATE is the only row lock that conflicts with FOR KEY SHARE, so it waited
  for the registration's foreign-key lock on its own club.

Reproduced on a disposable PostgreSQL 16 with production's exact bodies (md5 of
prosrc matched): the registration session errors with "deadlock detected ...
waits for ShareLock on transaction", exactly the production signature.

## Fix

Migration `20261127004231` applies the repo's existing bank-row rule
(`tests/a-tournament-start-does-not-block-foreign-keys.law.test.ts`): a treasury
lock on `public.clubs` or `public.union_wallets` is FOR NO KEY UPDATE, never FOR
UPDATE. The three bank locks in `fn_diamond_game_cover_lock` and
`fn_diamond_game_pay_chips` (the only Diamond games functions that took FOR UPDATE
on a bank row) become FOR NO KEY UPDATE by an anchored edit of the live text,
pinned to the reviewed pre-image and asserted against its post-image, owner,
security, settings and grants before COMMIT. Neither function changes a key, so
nothing it guards is lost: two payouts from one bank and every treasury write
still serialise (proved natively). The bank order (union_wallets, then clubs)
is unchanged. No retry, sweep or monitor.

After the migration the same native race completes with no deadlock: the
registration waits for the spin to commit and then proceeds.

## Hardening

- `tests/a-diamond-spins-payout-never-blocks-foreign-keys.law.test.ts` and
  `docs/laws.d/a-diamond-spins-payout-never-blocks-foreign-keys.md`: pins the
  three anchors and their replacement, both md5 images, the grants, the probes,
  the live proofs, and that no later migration takes a bank row FOR UPDATE again
  in either function.

## Verify After Install

```sql
SELECT md5(prosrc) FROM pg_proc
 WHERE oid IN ('public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)'::regprocedure,
               'public.fn_diamond_game_cover_lock(uuid,text)'::regprocedure);
-- 9294809778c5ea1dbd41e87a8667a2c8 and e8c34d2ffbf055e13f22a2ab6573daf2
```

Logs (postgres_logs): no `deadlock detected` whose context names
`fn_ca_midway_free_buy_promo_head` or whose detail names `fn_horse_diamond_spins`
or `fn_diamond_game`.
