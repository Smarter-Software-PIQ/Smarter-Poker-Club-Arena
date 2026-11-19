# An unintended delay between hands pages within minutes (2026-11-19)

Incident 075013fd, lane E5. Dan 2026-11-18: "i just don't want any 'un intended delays'".

`scripts/sql/hand-gap-unintended-delay.sql` grades every hand's gap against the
beats its shape is owed plus the 250 ms engine budget, but only when a person
runs it. Migration `20261119052955` makes it a production watch:

- `fn_ca_hand_gap_unintended_delay(window_end, minutes)` (STABLE): the same
  grade for the hands whose next hand was written in the window, per kind x
  shape: p50 gap, p50 owed, p50/p95/p99 unintended delay, over-budget count.
  Lightning, gaps of 60 s or more, recorded maintenance breaks and tournament
  breaks are skipped; run-it-twice (`rit`) and cash busts (`cash_bust`) are
  recorded as their own shapes and never counted over budget.
- `ca_hand_gap_watch_history`: one row per 5-minute window x kind x shape,
  30 days.
- `fn_ca_hand_gap_watch()`, cron `hand-gap-unintended-delay-watch-5m`
  (`1-59/5 * * * *`): records the window that closed a minute ago and raises
  one critical `financial_alerts` row (one incident, which is the page) per
  kind x shape whose p95 is over the budget in two consecutive windows with at
  least 5 graded hands each; it resolves itself when the shape is back within
  the budget.

Cost on production (EXPLAIN ANALYZE of the grade, read-only, 2026-11-19 05:30
UTC): 627 hands, index scans only, 11,316 buffers all hit, 56 ms.

What it saw at install time (same read): cash fold p95 +69 ms, cash showdown
with river chips +14 ms (both within budget); cash checked-river showdown +556
ms, tournament fold +649 ms, tournament all-in showdown +1,652 ms (over). Those
are the delays the alert names; the watch is a detector, not their fix.

Law: `tests/hand-gap-watch-pages-on-unintended-delay.law.test.ts`. Proof:
`scripts/ci/test-hand-gap-watch.py` (PostgreSQL 16), workflow
`hand-gap-watch-proof.yml`.
