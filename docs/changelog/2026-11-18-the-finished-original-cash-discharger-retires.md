# The finished original cash discharger retires and releases its money pins

2026-11-18, incident 075013fd, lane Q. Migration
`20261118155910_the_finished_original_cash_discharger_retires_and_releases_i`.

## What it was

`smarter_private.original_erased_cash_base_discharge(bigint,text)`
(20261012224150) was the one-shot writer for seven historical receivables:
cash bases of deleted accounts erased in the original week (union fade0000,
2026-10-05 to 10-12). For each of the seven it minted the base from
`issuance_reserve` into the deleted player's wallet and the deleted-wallet
trigger returned it to the funding club's bank, then it wrote an immutable
certificate. Because that write passed through about 46 money triggers and
helpers, it refused unless every one still had the body it was qualified
against on 2026-10-12.

## What was true on production (read-only, 2026-11-18 15:40-16:00 UTC)

- All seven are discharged: one transaction at 2026-10-13 01:54:11Z,
  1,845.87 chips in all (297.50, 33.31, 35.99, 97.04, 46.94, 108.11,
  1,226.98). The receipt reader re-verifies each against its six immutable
  financial rows and answers `discharged` for all seven.
- No money is stranded and nothing waits on the writer. Nothing calls it and
  no cron names it; the inventory generation reads the receipt function.
- 13 of its pins were stale, so every call refused, including the replay of
  an existing certificate. Its pin on `fn_ca_tally_balance_move` also refused
  #11256's install during this incident and had to be declared
  `@stale-pin-ok` by #11270.

## What changed

The writer can never pay again (its request domain is exactly the seven
events, all seven are certified, certificates are immutable), so its pins
guarded an unreachable write while tying 46 core money functions to a
finished job. It is retired rather than re-pinned:

- The writer is now STABLE (PostgreSQL refuses any write inside it), has no
  md5 pins, keeps its caller and request checks, replays a certificate's
  verified receipt exactly as before (`replayed: true`,
  `financial_payment: false`) and raises `original_cash_discharge_retired`
  for anything else.
- The inventory source authority's one pin on it moves to the new body (md5
  read back from the catalog). The authority must be true before and after,
  and nothing may still pin the old body: no `@stale-pin-ok`.
- The migration refuses itself unless the writer is the exact live preimage
  and all seven certificates exist and verify.

The per-pin review (what moved each of the 13 bodies and whether the
discharge's property would still hold) is in the migration header. Two
(`fn_ca_deleted_wallet_credit`, `fn_ca_deleted_wallet_bank_return`) no longer
return the whole credit at once when the deleted payer has published weekly
obligations; the rest preserve the property. None is re-pinned.

## Consequence

The original-inventory generation hashes the source authority's body, so its
hash changes (prefix unchanged), as with 20261014225815 and 20261111003802.
It is read only for union fade0000 windows ending on or after 2026-10-12;
those report memos are recomputed by their existing owners. No money,
certificate, cache or ledger row is written.

## Proof

- `tests/unit/theFinishedOriginalCashDischargerRetires.pg.test.ts` (native
  PostgreSQL): the writer preimage rebuilt from its migrations hashes to
  production's `9e6fcbf6`, the authority fixture to production's `3d3c9886`;
  installed through the applier's stale-pin guard; replay of all seven;
  refusals; STABLE write refusal; self-refusals; and without the pin move the
  applier refuses the file.
- `tests/the-finished-original-cash-discharger-stays-retired.law.test.ts`: no
  later migration may give the writer a write path or a pin.
