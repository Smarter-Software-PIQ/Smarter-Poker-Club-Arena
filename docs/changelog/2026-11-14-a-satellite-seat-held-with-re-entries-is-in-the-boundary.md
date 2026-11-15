# A satellite seat held with re-entries is in the weekly boundary (2026-11-14)

## What was wrong

Validating the Midway Union weekly statements for Nov 2 - Nov 9 against the
chip ledger, the cash side of all four clubs matched to the cent. The
tournament side of two did not.

`fn_union_pnl_boundary` holds every registration of a tournament still open at
a weekly boundary at its original entry less money already returned. A seat
won in a satellite has no wallet entry receipt, so it has its own branch that
holds the seat at the value its funding row moved into the prize pool. That
branch only ran when the registration had no chip entry at all. A seat holder
who also re-entered or rebought fell to the general branch, which held the
entries and nothing for the seat.

At the 2026-11-02 08:00 UTC boundary (Mon Nov 2, 2:00 AM Central) six such
registrations were open: Deep Stack Society 305.00 and KINGS CLUB 100.00. That
boundary closed one week and opened the next, so each club's 10% ECO moved
between the two weeks:

| Invoice            | Club               | Issued     | Correct    |
| ------------------ | ------------------ | ---------- | ---------- |
| MIDWAY-2026-000033 | Deep Stack Society | 141,330.49 | 141,299.99 |
| MIDWAY-2026-000038 | Deep Stack Society | 96,919.54  | 96,950.04  |
| MIDWAY-2026-000034 | KINGS CLUB         | 110,114.30 | 110,104.30 |
| MIDWAY-2026-000039 | KINGS CLUB         | 6,042.96   | 6,052.96   |

The two-week totals are exact. None of these invoices has been paid.

## The fix

`20261114182834_a_satellite_seat_held_with_re_entries_is_in_the_boundary.sql`
adds the seat in the general branch, using the seat-only branch's ledger
predicate and seat-owner function. A seat that cannot be proven is refused as
`open_tournament_satellite_seat_with_entries_unproven`. The union close's proof
source list (`original_inventory_proof_sources_match`) moves to the new body in
the same transaction.

No such registration was open at the 2026-11-09 boundary or at any union
boundary when this was measured, so no boundary whose statement has not been
issued changes value.

Pinned by `tests/a-satellite-seat-held-with-re-entries-is-in-the-boundary.law.test.ts`.
