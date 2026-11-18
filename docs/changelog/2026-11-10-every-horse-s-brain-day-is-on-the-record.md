# Every Horse's Brain Day Is On The Record

**Date:** 2026-11-10
**Migration:** `supabase/migrations/20261110054654_every_horse_s_brain_day_is_on_the_record.sql`
**Native proof:** `scripts/ci/test-per-horse-brain-coverage.py` via `.github/workflows/per-horse-brain-coverage.yml`

## The gap

`horse_brain_telemetry` is fleet-aggregate: (day, feature, fires), no horse
identity. "Every intended horse exercises the brain stack" was therefore only
provable at fleet level. A roster horse that never decides, or one whose
decisions all come from the exception fallback, disappears into the fleet
totals. The per-action truth exists in `hand_history.actions` (per-action
`userId` and `origin`, `horse_policy` or `horse_fallback`, read back from live
rows on 2026-11-10), but at 936,405 `hand_history` rows on 2026-11-08 a
whole-day pass over that jsonb inside the nightly audit is exactly the scan the
2026-09-05 rewrite removed: 89.9 s measured cold against the engine's 8 s
service_role statement_timeout.

## The change

The pattern `horse_review_rollup` already proved for this audit: arithmetic at
the writing event, the nightly read from the small rollup.

1. `horse_brain_activity_rollup`: per (day, horse, variant, lane) counts of
   decided hands, policy actions and fallback actions, written by a new
   AFTER INSERT row trigger on `hand_history`
   (`zz_horse_brain_activity_rollup`, beside the six row triggers already on
   that table). It reads only `NEW.actions`, upserts at most one row per horse
   seated in the hand in deterministic order, and never raises: a failed
   counter must not block hand recording.
2. `horse_daily_brain_coverage`: the permanent per-horse record, one row per
   roster horse per audited day (`profiles.is_horse`, not deleted, on
   `ca_horse_fleet_register` and not retired). Idle horses get a zero row on
   purpose: an idle horse is now a visible zero instead of an absence.
   Columns: day, horse_id, decided_hands, policy_actions, fallback_actions,
   variant_mix jsonb, lane (cash / tournament / mixed / none),
   PK (day, horse_id).
3. `fn_run_horse_daily_audit` is edited surgically (the 20261107140000
   anchored-insert pattern for this shared function, guarded against a missing
   or duplicated anchor and against double wiring) to call
   `fn_horse_daily_brain_coverage_upsert(p_day)` (idempotent delete+insert for
   the day) and append `fn_audit_per_horse_brain_coverage(p_day)` findings:
   an info summary (active/idle split, policy/fallback totals, fallback
   share), and `per_horse_coverage_absent` when fleet telemetry shows decides
   but the rollup recorded nothing. That finding is critical when the rollup
   holds an earlier day (the writer died) and info when the day predates the
   rollup (a backfill before install).
4. Privileges follow the 20261108191909 stall-page pattern: PUBLIC, anon and
   authenticated revoked on both tables and all three functions; service_role
   may read the tables and execute the two callable functions. Writes happen
   only inside SECURITY DEFINER functions.

No new cron, watcher or loop anywhere: the only schedule touched is the
existing nightly audit, and the trigger runs inside the hand's own insert.

Cost: the trigger expands one hand's actions jsonb (tens of elements) per
insert; the nightly audit adds one delete+insert of about 1,000 coverage rows
from a rollup day slice of a few thousand rows, milliseconds against the 8 s
budget that killed the old whole-day scan.

## Install route

`CREATE TRIGGER` takes SHARE ROW EXCLUSIVE on `hand_history`, a hot table, so
the file carries `-- @install-window: daily-maintenance` and
`-- @locks: public.hand_history` and waits for the daily 04:00 America/Chicago
break installer (CLAUDE.md section 2 rule 10). It reaches production only from
protected main through the owner's migration route (rule 11); nothing was
applied from this branch. No backfill: the trigger starts counting at install,
the next nightly audit writes the first coverage rows, and the first audited
day is partial by design.

## Proof

`scripts/ci/test-per-horse-brain-coverage.py` runs the exact migration file on
a throwaway PostgreSQL 17 cluster with production shapes (uuid ids, jsonb
actions read back from live rows) and the pre-migration audit function carrying
the real rake-pace anchor. Fail-before: the pre-migration audit runs and the
per-horse assertions fail because neither table exists. Pass-after, 12
behaviours: live proof; exact trigger counts per variant and lane; roster
filtering against retired, deleted and human actors; malformed userId, object
payload and NULL actions neither block the hand insert nor corrupt counts; one
coverage row per roster horse with the idle zero row; variant_mix and lane
values; the summary finding's exact fleet numbers; idempotent re-run; the
dead-writer critical and the backfill info severities; anon and authenticated
denied; a second apply refused without double wiring.
