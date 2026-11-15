# 2026-11-15 - Both Club Data screens read the union invoice's accounting records

Migrations `20261115034141_club_data_accounting_reader_views.sql` and
`20261115034142_club_data_readers_route_union_clubs_to_the_accounting_model.sql`
(stage 2 of #10879's read model; both install at merge).

Owner, 2026-11-14: "The Club Data page must match the union weekly invoices
1:1, starting and stopping at the same 2 AM boundary the invoices use."

## What changes

- `20261115034141` gives the readers the accounting read model in the shapes
  they already read: `ca_club_acct_fact_ct` (per player: every writer's rows
  once - live aggregate and journal, day load, week boundaries - plus cash
  hands), `ca_club_acct_game_ct` (per game), `ca_club_acct_hands_ct` (per
  table), `fn_ca_club_acct_fact_window`, the downline fee summary
  `fn_ca_club_acct_member_fee_totals`, and `fn_ca_club_acct_coverage`, which
  names a window's missing, failed and not invoice-exact days and whether it
  reaches the open week no issued invoice covers (provisional).
- `20261115034142` turns each of the thirteen Club Data readers into a router
  on its club argument. A club in a union, or a union (its house club), reads
  `<reader>_union_basis`; any other club reads `<reader>_chicago_basis`, the
  installed reader renamed and otherwise byte for byte unchanged. Names,
  arguments, defaults, results and grants stay as they were.
- The accounting-basis copies are the installed texts (md5 preimages pinned)
  with listed substitutions only, and their own texts are pinned by md5 too:
  02:00 America/Chicago accounting days (today, seat days, the union's raked
  hand window), the accounting views, felt shown but not added to winnings
  (the hand-by-hand result already holds it), player rows from the accounting
  records for every player they attribute to the club (horses included), and
  the basis stated in every answer (`accounting_basis`
  `union_invoice_accounting`, `day_basis` `America/Chicago 02:00`,
  `accounting_coverage`).

## Why routing and not an edit in place

A club in no union has no invoice; its screens keep exactly what they showed.
Union clubs and the union get the invoice's records. Inner calls between
readers go through the routers with the same club, so one screen never mixes
the two bases.

## Proof

- `scripts/ci/test-club-data-accounting-read-model.py` sections 6 and 7: the
  views count each writer's rows once; coverage reports missing, failed,
  not invoice-exact and provisional days; the migration refuses while the
  history is not loaded; the migration's own per-reader helper, run on
  `fn_ca_club_cash_felt` exactly as installed on production, produces the
  pinned copy, keeps the installed reader byte for byte, keeps its arguments,
  defaults and grants, and routes a seat joined at 01:59:59 CST to the
  previous accounting day and one joined at 02:00:00 CST to the day itself
  for a union club, while a club in no union keeps its Chicago day.
- Read-only production probe (2026-11-15): every preimage matched and every
  copy's md5 is the one pinned in the migration.
