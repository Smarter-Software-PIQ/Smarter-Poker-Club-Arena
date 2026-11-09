# Net Guarantee Promo Conservation, Settled Tournament Alert Closure, and Free Buy Board Audit Hardening (2026-11-09)

## What Was Wrong (Read From Rows)

1. **`net_guarantee_promo` omitted from escrow shadow and conservation books:**
   - Migration `20261108041131_net_guarantee_coverage_and_union_promo_funding.sql` added `public.fn_ca_fund_union_guarantee_promo_locked(uuid)`, which funds net guarantee shortfalls at registration close by writing a `chip_ledger` leg with `category = 'promo_send'`, `from_type = 'union_wallet'`, `to_type = 'prize_liability'`, `metadata->>'kind' = 'net_guarantee_promo'`, and increments `tournament_escrow.gross_in` and `tournaments.prize_pool`.
   - However, `public.fn_ca_tournament_escrow_chips(uuid)`, `public.fn_tournament_conservation_delta(uuid)`, and `public.fn_tournament_conservation_deltas(timestamptz, timestamptz)` only counted `free_buy_entry_promo` legs and omitted `net_guarantee_promo`.
   - As a result, completed guaranteed events funded by `net_guarantee_promo` (`38936396-91f9-4e2d-b1f9-8e4cadda4baa` and `4cc11151-0dfc-4934-95f7-1731ed4c2756`, each with `160.00` chips of `net_guarantee_promo`) reported false `-160.00` conservation deltas (`financial_alerts` `737d7d1c` and `f6dee95f`) and false `160.00` chip `settlement_error` escrow balance drift incidents (`ca_drift_incidents` `c07848e9` and `3ba300bc`, plus twin `drift_incident:fn_ca_escrow_balance_drift` alerts `1e271506` and `11284da7`).
   - Additionally, `fn_tournament_conservation_delta(uuid)` required `t.union_id = 'fade0000-0000-0000-0000-000000000001'` to count `free_buy_entry_promo` legs, missing Midway Free Buy events hosted on `club_id = 'fade0000-0000-0000-0000-000000000001'` with `union_id IS NULL` (`21c4c6c2-fdbe-42e3-858c-895aad31177c`).

2. **`fn_resolve_settled_financial_alerts` omitted settled satellite qualifier and payout refusal sources:**
   - `public.fn_resolve_settled_financial_alerts(boolean, integer)` resolves transient tournament alerts once an event reaches `COMPLETED` with closed zero-balance escrow, zero conservation delta, zero unsettled obligations, and settlement receipts.
   - Its `receipt_proven_tournament_alerts` source list omitted `'Tournament.satellite_qualifiers_refused_repeatedly'` and `'tournament.real_time_payout_refused'`, and required `p.prize_rows > 0` even when a satellite settled 100% into seat/ticket awards with zero cash remainder (recorded in `tournament_satellite_settlements` with `0` rows in `tournament_payouts`).
   - Consequently, 4 alerts on completed satellites (`87ad1399` on `dc92cf67`, `19dea224` on `a9e1a36b`, `5c74d2d7` on `468232d2`, `15479c2a` on `20560a90`) and 2 alerts on completed MTTs (`e23c72d9` on `fc377a58`, `a8dcb8fc` on `0b238562`) remained open after their events settled cleanly to zero escrow.

3. **`auditFreeBuyBoard` counted `CANCELLED` rows as live duplicate slots:**
   - While `fn_sp_midway_free_buy_watch()` and `freeBuyVerify.ts` skip `CANCELLED` rows, `auditFreeBuyBoard` in `server/src/services/FreeBuy.ts` and `TournamentRecurringService.auditFreeBuyBoardOnce` did not filter out `CANCELLED` rows when checking for duplicate `(club_id, slot, Chicago day)` occurrences, leaving a stale `TournamentRecurring.free_buy_board_drift` alert (`fb2aa1fd`) open.

## Root-Cause Fixes

- **Migration `20261109151859_net_guarantee_promo_conservation_and_settled_tournament_aler.sql`:**
  - Patches `public.fn_ca_tournament_escrow_chips(uuid)`, `public.fn_tournament_conservation_delta(uuid)`, and `public.fn_tournament_conservation_deltas(timestamptz, timestamptz)` in place to count `net_guarantee_promo` legs alongside `free_buy_entry_promo`.
  - Patches `public.fn_resolve_settled_financial_alerts(boolean, integer)` to include `'Tournament.satellite_qualifiers_refused_repeatedly'` and `'tournament.real_time_payout_refused'`, and accepts `EXISTS (SELECT 1 FROM public.tournament_satellite_settlements s WHERE s.satellite_id = t.id)` alongside `COALESCE(p.prize_rows, 0) > 0`.
  - Asserts in-transaction that `38936396`, `4cc11151`, and `21c4c6c2` read `0.00` conservation delta and `0.00` escrow shadow drift, then resolves the re-measured false alerts and drift incidents, the 6 settled tournament/satellite refusal alerts, the 2 made-good `fn_ca_bounty_only_final_two_watch` alerts (`dfd96268`, `43c88313`), and the stale `TournamentRecurring.free_buy_board_drift` alert (`fb2aa1fd`).
- **Engine & Verification (`server/src/services/FreeBuy.ts`, `server/src/services/TournamentRecurringService.ts`):**
  - Filters out `CANCELLED` / `CANCELED` rows in `auditFreeBuyBoard` and in `TournamentRecurringService.auditFreeBuyBoardOnce`.
- **Regression Protection:**
  - `tests/net-guarantee-promo-and-settled-tournament-alerts.law.test.ts` + `docs/laws.d/tests-net-guarantee-promo-and-settled-tournament-alerts.md`
  - `server/src/services/FreeBuy.test.ts`
