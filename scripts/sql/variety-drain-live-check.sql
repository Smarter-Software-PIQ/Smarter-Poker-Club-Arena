-- variety-drain-live-check.sql
--
-- READ-ONLY live check of the variety drain (HorseVarietyFirst.varietyDrainTables,
-- #12011 / #12037 / #12054 / #12084 / the backlog ramp), run after every engine
-- seal. One SELECT, no writes, no hole cards. Run it with the Supabase SQL
-- editor, psql, or the MCP execute_sql tool against the production project.
--
-- Window: from the newest shipped engine release (ca_engine_deploy_attempts)
-- to now. Each row is one check with PASS / FAIL / INFO and its evidence.
--
-- What each check means (docs/HORSE-DECISIONS-REGRESSION-METHOD.md, R11):
--   heartbeats            the fleet published heartbeats in the window
--   released_tables       every table the drain named, as a list (INFO)
--   fresh_releases_in_window  how many times a table was newly named (INFO)
--   no_person_released    no named table had a person seated while named
--   no_rejoin_while_named no Horse sat down at a named table after it was first
--                         named and before it closed (the 2026-11-26 churn)
--   named_tables_closed   named tables that are now closed or empty (INFO)
--   tables_within_cap     occupied counted tables never exceed the hour's cap now
--   horse_error_log       zero rows in the window
WITH rel AS (
  SELECT at FROM public.ca_engine_deploy_attempts WHERE shipped ORDER BY at DESC LIMIT 1
),
hb AS (
  SELECT h.beat_at,
         coalesce(h.detail -> 'variety_drain_tables',
                  CASE WHEN h.detail ? 'variety_drain_table' AND h.detail ->> 'variety_drain_table' IS NOT NULL
                       THEN jsonb_build_array(h.detail ->> 'variety_drain_table') ELSE '[]'::jsonb END) AS named,
         jsonb_array_length(coalesce(h.detail -> 'variety_owed_games', '[]'::jsonb)) AS owed
    FROM public.ca_horse_fleet_heartbeat h, rel
   WHERE h.beat_at > rel.at
),
named AS (
  SELECT (x)::uuid AS table_id, min(hb.beat_at) AS first_named, max(hb.beat_at) AS last_named, count(*) AS beats
    FROM hb, jsonb_array_elements_text(hb.named) x
   GROUP BY 1
),
fresh AS (
  -- a table named at a heartbeat where it was not named at the previous one
  SELECT hb.beat_at, (x)::uuid AS table_id
    FROM hb, jsonb_array_elements_text(hb.named) x
   WHERE NOT EXISTS (
     SELECT 1 FROM hb p
      WHERE p.beat_at = (SELECT max(q.beat_at) FROM hb q WHERE q.beat_at < hb.beat_at)
        AND p.named ? x)
),
cap AS (SELECT table_cap FROM public.fn_cash_hourly_table_range()),
census AS (SELECT count(*) AS counted FROM public.fn_cash_hourly_table_capacity_census())
SELECT 'heartbeats' AS check_name,
       CASE WHEN count(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS verdict,
       count(*) || ' heartbeats since ' || (SELECT at FROM rel) || '; owed now ' ||
         coalesce((SELECT owed FROM hb ORDER BY beat_at DESC LIMIT 1), 0) AS evidence
  FROM hb
UNION ALL
SELECT 'released_tables', 'INFO',
       coalesce(string_agg(t.name || ' (' || n.beats || ' beats, ' || t.lifecycle || ')', '; '), 'none')
  FROM named n JOIN public.tables t ON t.id = n.table_id
UNION ALL
SELECT 'no_person_released',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' seat(s) held by a person at a named table while named'
  FROM named n
  JOIN public.table_seats s ON s.table_id = n.table_id
  JOIN public.profiles p ON p.id = s.user_id
 WHERE coalesce(p.is_horse, false) = false
   AND s.joined_at <= n.last_named
   AND (s.left_at IS NULL OR s.left_at >= n.first_named)
UNION ALL
SELECT 'no_rejoin_while_named',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' Horse seat(s) joined a named table after it was first named'
  FROM named n
  JOIN public.table_seats s ON s.table_id = n.table_id
 WHERE s.joined_at > n.first_named AND s.joined_at <= n.last_named
UNION ALL
SELECT 'named_tables_closed', 'INFO',
       count(*) FILTER (WHERE t.lifecycle = 'closed') || ' closed, ' ||
       count(*) FILTER (WHERE t.lifecycle <> 'closed'
                          AND NOT EXISTS (SELECT 1 FROM public.table_seats s WHERE s.table_id = t.id AND s.left_at IS NULL))
         || ' empty and open, of ' || count(*)
  FROM named n JOIN public.tables t ON t.id = n.table_id
UNION ALL
SELECT 'fresh_releases_in_window', 'INFO', count(*) || ' new release(s)'
  FROM fresh
UNION ALL
SELECT 'tables_within_cap',
       CASE WHEN (SELECT counted FROM census) <= (SELECT table_cap FROM cap) THEN 'PASS' ELSE 'FAIL' END,
       (SELECT counted FROM census) || ' counted, cap ' || (SELECT table_cap FROM cap)
UNION ALL
SELECT 'horse_error_log',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' row(s) since the release'
  FROM public.horse_error_log e, rel
 WHERE e.created_at > rel.at;
