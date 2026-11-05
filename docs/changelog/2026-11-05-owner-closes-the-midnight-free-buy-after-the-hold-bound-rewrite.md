# Owner Closes The Midnight Free Buy After The Hold Bound Rewrite (Draft)

Status: draft, awaiting Dan. Not merged, not installed.

## What Happened

- PR #9573 (migration 20261105210545) installed Dan's one-event waiver of the
  04:00 Chicago rule for Midnight Free Buy (NLH) 6429087f at 22:04 UTC.
- Seconds later 20261105200238 (another session, owner approved) replaced
  `smarter_private.bulk_closure_admission`, removing the waiver, and added a
  2 s hold ceiling for any closure during play.
- Measured read-only: this event's 1,744 hands (10 MB) take about 2.1 s per
  hash and the retirement hashes them twice, so it needs about 4.3 s and can
  never close under the 2 s live ceiling.

## What This Draft Does If Approved

For that one event, kind `owner_retire`, until 2026-11-06 10:00 UTC: waive the
size rule and allow a live hold of up to 6 s (a waiting hand's ceiling is 8 s,
so no hand fails). Break window, maintenance, resume settling, unbounded caller
and cooldown are still checked. Every other event keeps the 2 s rule.

## Approval Line

"APPROVE A 6 SECOND PAUSE TO CLOSE THE MIDNIGHT FREE BUY NOW". If Dan picks the
04:00 to 06:00 Chicago quiet window instead, this branch closes unmerged.

Also in this session: Diamond Arena cash game NLH 50/100 (a5b77d68), closed and
disabled since 2026-10-14 but left at state `live`, was settled to `dormant`
through `fn_cash_cluster_tick(game, 0)`; no tables opened, no chips moved.
