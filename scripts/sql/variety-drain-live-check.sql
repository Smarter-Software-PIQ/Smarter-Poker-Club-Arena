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
--   heartbeats            a shipped release exists and the fleet published heartbeats since it
--   released_tables       every table the drain named, as a list (INFO)
--   fresh_releases_in_window  how many times a table was newly named (INFO)
--   no_person_released    at no heartbeat was a table named while a person had
--                         been seated there for more than one fleet cycle (35 s)
--   no_rejoin_while_named no Horse sat down at a table within 10 minutes after a
--                         heartbeat that named it while starts were still owed
--                         (catches the 2026-11-26 churn, also after the last naming)
--   named_tables_closed   named tables that are now closed or empty (INFO)
--   tables_within_cap     occupied counted tables do not exceed the hour's cap now
--   cap_every_cycle       no heartbeat read more counted tables than its cap
--                         (detail.cash_room; INFO until a build that writes it)
--   owed_starts_made      owed games that started since the release, with the
--                         median and longest wait. A wait ends at the game's first
--                         cash hand dealt, never at the game leaving the owed list
--                         (2026-11-27: one Lightning game left and re-entered the
--                         list 104 times while dealing, which read as 114 "starts"
--                         and a 2-minute median; the true median was 429 minutes).
--                         An owed beat within 3 minutes after a hand of that game
--                         is a game that is dealing, not waiting.
--   owed_waiting_now      owed games still waiting, and the longest wait so far.
--                         Both rows say how many waits began before the window
--                         (already owed at the release): those waits are minimums.
--   horse_error_log       zero rows in the window
WITH rel AS (
  SELECT at FROM public.ca_engine_deploy_attempts WHERE shipped ORDER BY at DESC LIMIT 1
),
hb AS (
  SELECT h.beat_at,
         coalesce(h.detail -> 'variety_drain_tables',
                  CASE WHEN h.detail ->> 'variety_drain_table' IS NOT NULL
                       THEN jsonb_build_array(h.detail ->> 'variety_drain_table') ELSE '[]'::jsonb END) AS named,
         jsonb_array_length(coalesce(h.detail -> 'variety_owed_games', '[]'::jsonb)) AS owed,
         coalesce(h.detail -> 'variety_owed_games', '[]'::jsonb) AS owed_games,
         h.detail -> 'cash_room' AS room
    FROM public.ca_horse_fleet_heartbeat h, rel
   WHERE h.beat_at > rel.at
),
naming AS (
  SELECT hb.beat_at, hb.owed, (x)::uuid AS table_id
    FROM hb, jsonb_array_elements_text(hb.named) x
),
named AS (
  SELECT table_id, min(beat_at) AS first_named, max(beat_at) AS last_named, count(*) AS beats
    FROM naming GROUP BY 1
),
fresh AS (
  SELECT n.beat_at, n.table_id
    FROM naming n
   WHERE NOT EXISTS (
     SELECT 1 FROM naming p
      WHERE p.table_id = n.table_id
        AND p.beat_at = (SELECT max(q.beat_at) FROM hb q WHERE q.beat_at < n.beat_at))
),
owing AS (
  SELECT hb.beat_at, g AS game FROM hb, jsonb_array_elements_text(hb.owed_games) g
),
dealt AS (
  SELECT t.cluster_id::text AS game, hh.created_at AS at
    FROM public.hand_history hh JOIN public.tables t ON t.id = hh.table_id, rel
   WHERE hh.created_at > rel.at - interval '3 minutes' AND hh.tournament_id IS NULL
     AND t.cluster_id::text IN (SELECT DISTINCT game FROM owing)
),
ev AS (
  SELECT game, beat_at AS ts, 0 AS deal FROM owing
  UNION ALL SELECT game, at, 1 FROM dealt
),
ep AS (
  SELECT game, ts, deal,
         sum(deal) OVER (PARTITION BY game ORDER BY ts, deal ROWS UNBOUNDED PRECEDING) AS k
    FROM ev
),
deals AS (SELECT game, k, ts FROM ep WHERE deal = 1),
waiting AS (
  SELECT o.game, o.k, o.ts
    FROM ep o LEFT JOIN deals d ON d.game = o.game AND d.k = o.k
   WHERE o.deal = 0 AND (d.ts IS NULL OR d.ts < o.ts - interval '3 minutes')
),
waits AS (
  SELECT w.game, w.k, min(w.ts) AS s, max(w.ts) AS last_beat,
         (SELECT d.ts FROM deals d WHERE d.game = w.game AND d.k = w.k + 1) AS started_at,
         min(w.ts) <= (SELECT min(beat_at) FROM hb) + interval '60 seconds' AS truncated
    FROM waiting w GROUP BY w.game, w.k
),
cap AS (SELECT table_cap FROM public.fn_cash_hourly_table_range()),
census AS (SELECT count(*) AS counted FROM public.fn_cash_hourly_table_capacity_census())
SELECT 'heartbeats' AS check_name,
       CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS verdict,
       count(*) || ' heartbeats since ' || coalesce((SELECT at::text FROM rel), 'NO SHIPPED RELEASE') ||
         '; owed now ' || coalesce((SELECT owed FROM hb ORDER BY beat_at DESC LIMIT 1), 0) AS evidence
  FROM hb
UNION ALL
SELECT 'released_tables', 'INFO',
       coalesce(string_agg(t.name || ' (' || n.beats || ' beats, ' || t.lifecycle || ')', '; '), 'none')
  FROM named n JOIN public.tables t ON t.id = n.table_id
UNION ALL
SELECT 'no_person_released',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' heartbeat(s) naming a table a person had sat at for over 35 s'
  FROM naming n
 WHERE EXISTS (
   SELECT 1 FROM public.table_seats s JOIN public.profiles p ON p.id = s.user_id
    WHERE s.table_id = n.table_id AND coalesce(p.is_horse, false) = false
      AND s.joined_at < n.beat_at - interval '35 seconds'
      AND (s.left_at IS NULL OR s.left_at > n.beat_at))
UNION ALL
SELECT 'no_rejoin_while_named',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' Horse seat(s) joined a table within 10 min after a heartbeat named it while starts were owed'
  FROM public.table_seats s
  JOIN public.profiles p ON p.id = s.user_id AND coalesce(p.is_horse, false) = true
 WHERE s.table_id IN (SELECT table_id FROM named)
   AND EXISTS (
     SELECT 1 FROM naming n
      WHERE n.table_id = s.table_id AND n.owed > 0
        AND n.beat_at < s.joined_at AND n.beat_at >= s.joined_at - interval '10 minutes')
UNION ALL
SELECT 'named_tables_closed', 'INFO',
       count(*) FILTER (WHERE t.lifecycle = 'closed') || ' closed, ' ||
       count(*) FILTER (WHERE t.lifecycle <> 'closed'
                          AND NOT EXISTS (SELECT 1 FROM public.table_seats s WHERE s.table_id = t.id AND s.left_at IS NULL))
         || ' empty and open, of ' || count(*)
  FROM named n JOIN public.tables t ON t.id = n.table_id
UNION ALL
SELECT 'fresh_releases_in_window', 'INFO',
       count(*) || ' new release(s) over ' || (SELECT count(*) FROM named) || ' table(s)'
  FROM fresh
UNION ALL
SELECT 'tables_within_cap',
       CASE WHEN (SELECT counted FROM census) <= (SELECT table_cap FROM cap) THEN 'PASS' ELSE 'FAIL' END,
       (SELECT counted FROM census) || ' counted, cap ' || (SELECT table_cap FROM cap) || ' (now)'
UNION ALL
SELECT 'cap_every_cycle',
       CASE WHEN count(*) = 0 THEN 'INFO'
            WHEN count(*) FILTER (WHERE (room ->> 'counted')::int > (room ->> 'cap')::int) = 0 THEN 'PASS'
            ELSE 'FAIL' END,
       count(*) FILTER (WHERE (room ->> 'counted')::int > (room ->> 'cap')::int) || ' of ' || count(*) ||
         ' heartbeat(s) over the cap they read'
  FROM hb WHERE jsonb_typeof(room) = 'object'
UNION ALL
SELECT 'owed_starts_made', 'INFO',
       count(*) || ' started; median wait ' ||
         coalesce(round(extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY started_at - s)) / 60)::text, '-') ||
         ' min, longest ' || coalesce(round(extract(epoch FROM max(started_at - s)) / 60)::text, '-') || ' min' ||
         CASE WHEN count(*) FILTER (WHERE truncated) > 0
              THEN ' (' || count(*) FILTER (WHERE truncated) || ' already owed at the release: their waits are minimums)'
              ELSE '' END
  FROM waits WHERE started_at IS NOT NULL
UNION ALL
SELECT 'owed_waiting_now', 'INFO',
       count(*) || ' waiting; longest so far ' ||
         coalesce(round(extract(epoch FROM max((SELECT max(beat_at) FROM hb) - s)) / 60)::text, '-') || ' min' ||
         CASE WHEN count(*) FILTER (WHERE truncated) > 0
              THEN ' (' || count(*) FILTER (WHERE truncated) || ' already owed at the release: their waits are minimums)'
              ELSE '' END
  FROM waits WHERE started_at IS NULL AND last_beat = (SELECT max(beat_at) FROM hb)
UNION ALL
SELECT 'horse_error_log',
       CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' row(s) since the release'
  FROM public.horse_error_log e, rel
 WHERE e.created_at > rel.at;
