# hand-delay-owner-page-route

Routing defect, Production Alerts fleet (PRIMARY, 2026-11-20).

## Read from production (read-only, 2026-11-20 ~03:45Z)

- Owner `public.notifications`, type `system`, `data.source = fn_ca_hand_gap_watch`, last 7 days:
  10 x "Unintended Delay Between Hands", 8 x "Hand Delay Cleared"; 18 in 02:01Z-03:41Z;
  all 18 have a `push_outbox` row (`related_entity_id`), none is in
  `operational_notification_destinations`.
  - 02:46:00Z: four pages in the same second (ids 0d44a448, 16b8e73f, 28973433, 9ddc7c4d), one per shape.
- `fn_ca_hand_gap_watch` on production: md5(pg_get_functiondef) `54699f70fe124aa7b441b36710c039e3`,
  two `PERFORM public.fn_raise_notification(` loops (open, clear) over senior platform recipients.
- The watch's `financial_alerts` row already reaches the store as
  `source = financial-alerts-backfill`, `alertname = fn_ca_hand_gap_watch`, `severity = critical`,
  with `payload.target_task_id` (rows 445899..446115 at read time).
- `fn_ca_owner_page_kind` md5 `0b2e47d5b999a429faa4ad1346c90f52`, `fn_ca_a_real_alert_reaches_the_owner`
  md5 `587e68783be087a0a059d674377a7cc9`: no mapping for that row. Fixture
  `scripts/ci/fixtures/owner-page-route-preimage-20261120.sql` reproduces both byte-for-byte
  (the proof asserts the md5s).

## Root cause

20261119180500 notifies directly from the detector on every open and every clear, bypassing the
governed owner page route (20261007000420), so every flap of a shape around the 250 ms budget is a
phone push and every recovery is a push.

## Proof

`python3 scripts/ci/test-hand-gap-watch.py` on PostgreSQL 16: 36 checks pass (`proof-RESULTS.json`).
With 20261120034809 withheld (pre-fix code), the check
"route: the 15-minute breach opens ONE alert and the watch itself notifies nobody" fails
(the pre-fix watch returns `notified_open` and writes its own notification).
