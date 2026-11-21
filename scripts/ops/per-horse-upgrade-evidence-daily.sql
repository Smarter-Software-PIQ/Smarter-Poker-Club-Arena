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
--                          of the upgrade fired (opportunity-only needles excluded: upgrade 10's
--                          fast_window_ready; before the release carrying that correction, upgrade 10
--                          rows count a ready window as invoked)
--   decisions, invoked     the day's totals over the same Horses
--   verdict                per_decision for an ordinary upgrade (no verdict: read the counts). For a GUARD
--                          (2026-11-21, HorseUpgradeEvidence PER_HORSE_GUARD_UPGRADES: upgrade 09) decisions are
--                          its opportunities and invoked the ones it acted on, and the verdict is guard_idle (no
--                          opportunity: healthy, always listed), guard_held (acted on every one: healthy) or
--                          guard_missed (an opportunity it did not act on: FLAGGED). Days before the release
--                          carrying this hold upgrade 09 with every brain decision as decisions and read missed.
--
-- READ IT WITH ITS LIMITS (docs/changelog/2026-11-14-per-horse-upgrade-evidence.md):
--   - a counter firing in a Horse's decision proves that decision ran the upgrade's path, not that the
--     upgrade changed the action;
--   - upgrades whose evidence is not a per-decision brain counter read zero invoked here by design
--     (05 prewarm and 13 watchcounters are /metrics series or main-process counters); 04 counts a
--     decision that read an Omaha reservoir (upgrade04_reservoir_used_seen) since 2026-11-21, before
--     that only the one decision per process that built it;
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
), per_upgrade AS (
  SELECT upgrade_id,
         count(*) FILTER (WHERE decisions > 0) AS horses_with_decisions,
         count(*) FILTER (WHERE invoked > 0) AS horses_with_invoked,
         sum(decisions) AS decisions,
         sum(invoked) AS invoked
    FROM per_horse
   GROUP BY upgrade_id
), guards(upgrade_id) AS (
  -- PER_HORSE_GUARD_UPGRADES (HorseUpgradeEvidence.ts); a law test holds the two lists equal.
  VALUES ('upgrade_09_preaction_purge')
)
SELECT upgrade_id,
       (SELECT count(*) FROM fleet) AS fleet,
       coalesce(u.horses_with_decisions, 0) AS horses_with_decisions,
       coalesce(u.horses_with_invoked, 0) AS horses_with_invoked,
       coalesce(u.decisions, 0) AS decisions,
       coalesce(u.invoked, 0) AS invoked,
       CASE WHEN g.upgrade_id IS NULL THEN 'per_decision'
            WHEN coalesce(u.decisions, 0) = 0 THEN 'guard_idle'
            WHEN u.invoked >= u.decisions THEN 'guard_held'
            ELSE 'guard_missed' END AS verdict
  FROM per_upgrade u
  FULL JOIN guards g USING (upgrade_id)
 ORDER BY upgrade_id;
COMMIT;
