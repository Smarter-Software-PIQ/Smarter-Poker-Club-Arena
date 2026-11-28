# cycle-not-sealed-owner-note-unrouted

First found 2026-11-27 (board comment 7220521960, patch 907016774, never pushed: the
Club Arena push path was refused). Rebuilt on main 65a64d1f6 on 2026-11-28 with a
fresh version, 20261128151139.

## What was read (production, read-only, 2026-11-28 15:10Z)

- `smarter_private.ca_cutover_cycle_notes`: 7 rows (columns cycle, note, message_id,
  created_at): `2026-11-26T10`, `2026-11-26T13`, `2026-11-26T19`, `2026-11-26T22`,
  `2026-11-27T07`, `2026-11-27T13`, `2026-11-28T07`.
- `operational_alert_events` rows with `event_key LIKE 'cycle-not-sealed:%'`: **0**.
- Live `public.fn_ca_note_cycle_did_not_seal`: `md5(pg_get_functiondef)` begins
  `a48b7a84`, with no reference to the store. The only definition on main is
  `20261126031810`.
- `public.fn_record_operational_alert(p_source, p_event_key, p_alertname, p_status,
  p_severity, p_payload) RETURNS bigint`.

## Root cause

`20261126031810` writes the note row and the Messenger line, and nothing else. Every
missed cycle reaches the owner and no lane.

## Fix

`supabase/migrations/20261128151139_a_missed_cycle_note_is_recorded_in_the_alert_store.sql`:
- the function records `engine-cutover-watch` / `cycle-not-sealed:<cycle>` (warning,
  fleet-addressed) through `fn_record_operational_alert` before it sends the message;
- it refuses to send without a store id;
- it stores that id on the note row and on the message metadata;
- the cycles already noted are recorded once, from their own rows.

## Proof

- `tests/a-missed-cycle-is-recorded-in-the-alert-store.law.test.ts`: 4 of 5 cases fail
  with the migration removed, and all 5 pass with it (vitest 4.0.18).
- Neighbouring suites all pass: 2353 tests in 17 files, plus 2347 tests across the
  cycle law and the installable check, which needed `yaml`. They cover the
  sender-addressing laws, the destination law, the law registry, the
  missed-cycle-note law, the claim check, installable, the install budget, catalog
  literals, the corpus reader, session identity, version uniqueness and N-1 compat.
- `native-proof.sh` (PostgreSQL 16, throwaway cluster, run as a non-root user):
  - pre-fix: 7 notes and 0 store rows;
  - post-fix: 7 back-recorded rows plus 1 new row, all addressed;
  - a replay sends nothing and records nothing;
  - the grants are unchanged;
  - re-sending the file is refused.

  Result: PASS.

## Hold

This must be installed through the protected-main migration route. This lane applied
nothing to the database.
