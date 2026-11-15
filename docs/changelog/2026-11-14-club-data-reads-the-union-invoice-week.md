# 2026-11-14 - Club Data reads the union invoice week from the invoice

Owner: "The data page display data starts and stops at the same 2AM time that
the invoices are appearing as; the data on this page should match the invoices
1:1."

## What was measured (production, read-only, 2026-11-14)

Midway Union, week 2026-11-02 08:00Z to 2026-11-09 08:00Z (Monday 2:00 AM to
Monday 2:00 AM Chicago), Club Data asked for Nov 2 to Nov 9:

| Club               | Invoice rake | Page fee   | Invoice player net loss | Page total winnings |
| ------------------ | ------------ | ---------- | ----------------------- | ------------------- |
| KINGS CLUB         | 25,854.24    | 1,568.03   | 37,160.83               | -5,502.27           |
| The Felt Society   | 455,510.12   | 523,814.66 | 473,091.31              | -532,270.46         |
| Deep Stack Society | 452,206.43   | 500,175.35 | 562,209.57              | -593,784.65         |
| Club Savage        | 0            | 0          | 0                       | 0                   |

The invoice basis re-derives to the cent from its own sources:

- Rake: `sum(accounting_payable_earning_sources.rake_credit)` for the week is
  16,469.67 cash + 9,384.57 tournament = 25,854.24 (KINGS), 311,670.47 +
  143,839.65 = 455,510.12 (Felt), 306,944.47 + 145,261.96 = 452,206.43 (Deep
  Stack).
- Player result: `smarter_private.union_eco_components.basis` holds cash and
  tournament player results of -19,148.89 / -18,011.94 (KINGS), -371,464.54 /
  -101,626.77 (Felt), -366,655.46 / -195,554.11 (Deep Stack); each pair sums to
  the invoiced loss.

## Why the page differed: two pipelines

1. **Window.** Club Data facts are keyed by the Chicago calendar day
   (midnight) and the end date is inclusive, so Nov 2 to Nov 9 is eight
   midnight days. The invoice week is `fn_union_week_start`: Monday 00:00
   America/Los_Angeles, which is Monday 2:00 AM Chicago on every Monday.
2. **Club.** The facts take a hand's club from the seat and the table funding
   receipt, then the readers move every horse to its current
   `ca_horse_club_assignments` club at display time (20261102215504,
   `fn_ca_club_data_fact_window`). The invoice takes the club from the
   accounting record of the hand. Sampled on 2026-11-05: three horse fee facts
   booked to KINGS CLUB by their table funding receipt are recorded for The
   Felt Society and Deep Stack Society in `accounting_cash_rake_sources`.
   Removing the display-time move alone would therefore put about 110,560 of
   horse fee back on the KINGS page for that week, against an invoice of
   25,854.24: the stored facts are not on the invoice's attribution either.
3. **Definition.** Page winnings are wallet cash-outs minus buy-ins plus chips
   on the felt; the invoice is hand-by-hand stack change plus tournament
   results deferred until the tournament settles. Page fee counts a tournament
   fee when charged; the invoice when recognized.

## What this change does

- `20261114235606_club_data_reads_the_union_invoice_week.sql`
  - `fn_ca_accounting_day` / `fn_ca_accounting_day_start`: the one accounting
    day, 2:00 AM to 2:00 AM Chicago, daylight saving included. The migration
    asserts for every Monday of 2025 to 2028 that the day starts on
    `fn_union_week_start`.
  - `ca_club_data_union_weeks(club, start, end)`: the issued
    `union_weekly_squareup` invoices inside `[2:00 AM start, 2:00 AM end)`.
    The end date is the boundary. Fee is the document's `rake_generated`, the
    player result its `players_won`. Nothing is recomputed and nothing
    consults the current horse assignment, so the page cannot disagree with
    the invoice: it reads the same row.
  - `club_slug_history`, `ca_club_id_for_slug`: a former slug keeps resolving.
    The 2026-11-14 production rename `club-jaqk` to `the-felt-society` is
    recorded.
- `20261114235607_a_renamed_club_keeps_its_old_slug.sql` (daily maintenance
  window, locks `public.clubs`): every later rename files the old slug in the
  renaming statement, and a slug that is another club's former slug is
  refused (insert or rename) with an error naming that club; a club may take
  back its own former slug, which removes that history row.
- `resolveClubUUID` asks the rename history when no club holds a slug.
- (Updated 2026-11-15.) The separate "union invoice weeks" block on the owner
  screen was removed again: the screens themselves move to the invoice's
  accounting basis through the read model in
  `2026-11-15-club-data-accounting-read-model.md`.

## What it does not do, and why

- **The page's own totals, game rows and player rows are unchanged.** They are
  still the Club Data facts: midnight days, the facts' own club, the facts'
  definitions. Re-keying them to the 2:00 AM day needs the writer
  (`fn_ca_club_data_fact_put`) switched at a recorded 2:00 AM cutover and every
  earlier day's midnight to 2:00 AM slice moved back one day from
  `rake_records` and `wallet_transactions`, the way `fn_ca_club_data_ct_seed`
  moved UTC days to Chicago days. Size: `ca_club_data_fact_ct` holds about 2.7
  million rows; the earlier load measured about 25 to 30 s for a five to six
  hour slice per day, so a two hour slice over the roughly 60 days of history
  is on the order of 10 to 20 minutes, in two or three load migrations, after
  the cutover. Not built here.
- **An open week has no figure on the invoice basis.** The invoice's cash
  reader (`smarter_private.weekly_hand_parts_reduce`) did not finish one day in
  70 s on production because most Midway hands are counted through
  `union_pnl_cash_outcome_link_resolutions`; the rake view takes about 10 s for
  one club week; a rake source's club can still change through
  `accounting_cash_funding_contract_admissions` after the hand; and tournament
  results are deferred until settlement. A live week-to-date figure needs a
  narrow projection written by the accounting rows' own inserts, like
  `union_pnl_cash_outcome_touches`. Until then the open week shows the page's
  actual table activity only and no invoice figure. Nothing is projected.
- **The display-time horse move stays** (`fn_ca_club_data_fact_window`,
  `ca_stats_club_data_fact_ct`, read by `ca_club_data_screen`,
  `ca_club_data_player_totals` and the other Club Data readers). See point 2:
  the move has to be replaced by the accounting record's club at the source,
  together with the re-key, not removed on its own.

## Proof

- `python3 scripts/ci/test-club-data-union-invoice-week.py` (native Postgres,
  the production week as fixture): baseline fails, then every club's week
  equals its invoice to the cent, the eight-day reading is not a week, both
  clock changes, no re-attribution, refusals, slug history.
- `npx vitest run tests/club-data-reads-the-union-invoice-week.law.test.ts`.
