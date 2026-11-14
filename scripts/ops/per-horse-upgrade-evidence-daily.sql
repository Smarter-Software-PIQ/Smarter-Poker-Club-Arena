-- Per-Horse upgrade evidence for one UTC day. Explicit read-only; never scheduled, repairs nothing.
--
-- Usage:  psql "$DATABASE_URL" -X -v day=2026-11-14 -f scripts/ops/per-horse-upgrade-evidence-daily.sql
--
-- One line per upgrade, counts only, no Horse ids:
--   fleet                  unretired roster Horses (profiles.is_horse, not deleted, on
--                          ca_horse_fleet_register with retired_at null), the same roster
--                          fn_horse_daily_brain_coverage_upsert uses
--   horses_with_decisions  of those, Horses with at least one decision that day in a variant and lane
--                          where the upgrade is declared (the opportunity baseline)
--   horses_with_invoked    of those, Horses with at least one decision in which an evidence counter
--                          of the upgrade fired
--   decisions, invoked     the day's totals over the same Horses
--
-- READ IT WITH ITS LIMITS (docs/changelog/2026-11-14-per-horse-upgrade-evidence.md):
--   - a counter firing in a Horse's decision proves that decision ran the upgrade's path, not that the
--     upgrade changed the action;
--   - upgrades whose evidence is not a per-decision brain counter read zero invoked here by design
--     (05 prewarm and 13 watchcounters are /metrics series or main-process counters; 04 is a
--     once-per-process reservoir build credited to the one decision that built it);
--   - DEEP second looks and style-shadow re-decisions are not counted;
--   - a worker that dies loses up to one flush interval, so the table can undercount, never overcount.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH fleet AS (
  SELECT p.id
    FROM public.profiles p
    JOIN public.ca_horse_fleet_register r ON r.horse_id = p.id AND r.retired_at IS NULL
   WHERE p.is_horse AND coalesce(p.status, '') <> 'deleted'
), per_horse AS (
  SELECT e.upgrade_id, e.horse_user_id, sum(e.decisions) AS decisions, sum(e.invoked) AS invoked
    FROM public.horse_upgrade_evidence_daily e
    JOIN fleet f ON f.id = e.horse_user_id
   WHERE e.day = :'day'::date
   GROUP BY e.upgrade_id, e.horse_user_id
)
SELECT upgrade_id,
       (SELECT count(*) FROM fleet) AS fleet,
       count(*) FILTER (WHERE decisions > 0) AS horses_with_decisions,
       count(*) FILTER (WHERE invoked > 0) AS horses_with_invoked,
       sum(decisions) AS decisions,
       sum(invoked) AS invoked
  FROM per_horse
 GROUP BY upgrade_id
 ORDER BY upgrade_id;
COMMIT;
