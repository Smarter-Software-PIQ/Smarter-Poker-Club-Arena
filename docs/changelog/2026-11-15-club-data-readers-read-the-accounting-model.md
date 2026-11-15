# 2026-11-15 - Both Club Data screens read the union invoice's accounting records

Migrations `20261115034141_club_data_accounting_reader_views.sql` and
`20261115034142_club_data_readers_route_union_clubs_to_the_accounting_model.sql`
(stage 2 of #10879's read model).

Owner, 2026-11-14: "The Club Data page must match the union weekly invoices
1:1, starting and stopping at the same 2 AM boundary the invoices use."

## What changes

- `20261115034141` gives the readers the accounting read model in the shapes
  they already read: `ca_club_acct_fact_ct` (per player: every writer's rows
  once - live aggregate and journal, day load, week boundaries - plus cash
  hands; the per-game reads are sums, EXISTS and max over it, so no grouped
  view is read), `ca_club_acct_hands_ct` (per table), `fn_ca_club_acct_fact_window`,
  the downline fee summary `fn_ca_club_acct_member_fee_totals`, and
  `fn_ca_club_acct_coverage`: a window's missing days, failed days (a week
  boundary's failure only for its own union), not invoice-exact days, and
  provisional = the window reaches the open week after the union's last
  issued weekly invoice (a week before the union's first invoice is not
  provisional).
- `fn_ca_club_data_reads_union_basis(club, start, end)` decides the basis of
  a window: a union (its house club) or a club in one, and the window starts
  on or after the later of the accounting day the club joined its union and
  the first day the model holds (2026-09-17 after the history load). Deep
  Stack Society joined on 2026-10-12 after 124,169 games of its own; a window
  that starts before that reads the Chicago basis exactly as before, says so
  (`basis_reason: window_starts_before_union_basis`) and keeps the club's
  `union_id`.
- `20261115034142` turns each of the thirteen Club Data readers into a router
  on that decision: `<reader>_union_basis` on the union basis,
  `<reader>_chicago_basis` (the installed reader renamed, byte for byte
  unchanged) otherwise. Names, arguments, defaults, results and grants stay as
  they were. The copies are the installed texts (md5 preimages pinned) with
  listed substitutions only, and their own texts are pinned by md5 from a
  read-only production probe: 02:00 America/Chicago accounting days, the
  accounting views, felt shown but not added to winnings (the hand-by-hand
  result already holds it), player rows from the accounting records for every
  player they attribute to the club (horses included), the player totals
  clamping a window past the accounting today instead of refusing it, and the
  basis and coverage stated in every answer. The snapshot also returns
  `previous_coverage` and nulls its change figures when either window is not
  whole on the union basis.
- A projection failure always carries a day: `fn_ca_club_acct_fail` records
  the accounting day it fails on when its source gives none, and a legacy
  NULL-day row is given the day it failed on (the next load of that day
  resolves it), so one unreadable source no longer marks every window of
  every union incomplete.
- The club hand count (#10879) is the 20261022103651 definition on accounting
  records: raked hands in which at least one of the club's players changed
  stack; the table's club counts a raked hand in which only players without an
  earning club changed stack (or nobody did).

## Rollout

#10879 merges (20261115020011 attaches the live projection; its live proof is
nine triggers and one state row) -> the history is loaded from 2026-09-17
(club-data-accounting-seed.yml, bounded ranges) -> `20261115034142` installs.
Until the history is loaded it is refused with nothing changed
(`CLUB_ACCT_READERS_HISTORY_NOT_LOADED`); it is dispatched once more after the
load. Its live proofs then call every read-only router for the union and for
KINGS CLUB over one day.

## Proof

- `scripts/ci/test-club-data-accounting-read-model.py` sections 6 and 7:
  every row counted once; no grouped per-game view; failures always carry a
  day (legacy and new); coverage reports missing, failed (not another union's)
  and not invoice-exact days, the open week as provisional and a week before
  the first invoice as not; the union-basis decision for a club before and
  after it joined, a union, and a club in no union; the migration refuses
  while the history is not loaded; the migration's own helper on
  `fn_ca_club_cash_felt` (exactly as installed on production) produces the
  pinned copy, keeps the original and its grants, and routes a union club's
  01:59:59 CST seat to the previous accounting day and its 02:00:00 CST seat to
  that day, while a club in no union, and Deep Stack's window before it
  joined, keep their Chicago day.
- `tests/the-club-data-readers-stay-routers.law.test.ts`: the thirteen names
  stay routers; a later migration that redefines one must route it again.
- Read-only production probe (2026-11-15): every preimage matched and every
  copy's md5 is the one pinned.
