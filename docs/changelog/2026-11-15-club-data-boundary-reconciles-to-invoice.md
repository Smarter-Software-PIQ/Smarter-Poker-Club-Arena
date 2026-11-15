# A week boundary's carried entries load when they reconcile the week to its invoice (2026-11-15)

Audit finding D1, migration `20261115080136_club_data_boundary_side_reconciled_to_its_invoice`.

The pnl_boundary certificates are kept only since 2026-11-15, so for most past
weeks the only kept version was certified after the week's invoice and the
loader took nothing for that side: the week lacked exactly the tournament
entries still running at the boundary and read "not invoice-exact".

`fn_ca_club_acct_verify_week(union, week start)` now takes the earliest kept
version of each side that is not exact and loads it only when, for every club
of the week's invoices and every club the model holds, model week result + the
entries = the stored `players_won` to the cent (all days of the week loaded,
no open projection failure). The side is then exact with basis
`reconciled_to_invoice`. `fn_ca_club_acct_load_boundary` records each side's
basis and asks for the reconciliation when a side loaded nothing (so a
certificate that arrives after its invoice reconciles through the existing
capture trigger); the history load loads every boundary again after its days.

Measured on production before the change (read-only, 08:15Z), week 2026-10-19:
Deep Stack -1,219,999.26 + 30,951.54 = -1,189,047.72; The Felt Society
-814,844.11 + 21,584.63 = -793,259.48; KINGS CLUB -812,742.03 + 17,564.43 =
-795,177.60; Midway house 7,449.31 + 300.00 = 7,749.31; Club Savage 0. Every
difference 0.00.
