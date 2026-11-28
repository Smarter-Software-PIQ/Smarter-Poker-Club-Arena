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
--   no_rejoin_while_named no Horse sat down at a table while it was still named:
--                         a beat with a start owed named it at or before the join,
--                         every beat from that naming to the join still named it,
--                         the newest beat before the join is under 65 s old
--                         (VARIETY_DRAIN_FRESH_MS). A Horse joining after the drain
--                         ended (an un-naming beat, or a stale publication) or on a
--                         break move is not a re-join (review follow-up 2026-11-27;
--                         the old form counted any join within 10 minutes after a
--                         naming). Catches the 2026-11-26 churn. A join seated by
--                         the cycle that un-names the table (its beat comes after
--                         the join) IS counted: excusing it hid the 7 PM CST
--                         2026-11-27 churn, where the drain un-named and refilled
--                         tables every ~8 minutes for games that cannot start.
--   named_tables_closed   named tables that are now closed or empty (INFO)
--   cap_every_cycle       no table entered the counted room while it was at or
--                         above the cap, unless a person put it there. Judged on
--                         every pair of consecutive heartbeats that carry the
--                         room (detail.cash_room; INFO when none does): the
--                         count rose AND ended above the cap the beat read, the
--                         cap the beat before read, and every hourly cap in
--                         force between them. The tables above that level are
--                         the ones that entered at or above the cap; each needs
--                         a person-side cause in that interval (a person left a
--                         person-started table whose Horses stayed, so it came
--                         back into fn_cash_hourly_table_capacity_census; or a
--                         person was on a game's waiting list: a person is never
--                         gated by the hourly policy). A rise with no such cause
--                         is a Horse-side open over the cap: FAIL, with the beat.
--                         A rise a person explains is named in the evidence.
--                         (2026-11-28: the row used to FAIL on every beat that
--                         read counted > cap. The hourly cap falls from 40 at
--                         10 PM CST to 7 at 6 AM, so every night the room sat
--                         above a cap that had just dropped under it while it
--                         wound down, and the row failed with nothing opened.
--                         The beat before the release is read as the first
--                         pair's earlier beat, never judged itself.)
--   tables_within_cap     the room now. PASS within the cap. Over the cap it is
--                         FAIL when a table entered at or above the cap since
--                         the newest heartbeat that carries the room with no
--                         person-side cause (the same rule, with "now" as the
--                         last reading), when cap_every_cycle fails, or when
--                         the count is above every cap of the last 24 hours
--                         (no falling cap explains that);
--                         otherwise INFO: the room is winding down to a cap
--                         that fell.
--   cap_wind_down         how many heartbeats read more counted tables than the
--                         cap, how far over, the count at the first and the
--                         newest of them (falling, level or rising) and each
--                         fall of the cap in the window (INFO)
--   owed_starts_made      owed games that started since the release, with the
--                         median and longest wait. A wait ends at the game's first
--                         cash hand dealt, never at the game leaving the owed list
--                         (2026-11-27: one Lightning game left and re-entered the
--                         list 104 times while dealing, which read as 114 "starts"
--                         and a 2-minute median; the true median was 429 minutes).
--                         An owed beat within 3 minutes after a hand of that game
--                         is a game that is dealing, not waiting.
--   owed_waiting_now      owed games still waiting, and the longest wait so far.
--                         A wait that began before the window (already owed at the
--                         release) is timed from the game's first-owed time on the
--                         heartbeat (detail.variety_owed_since, review follow-up
--                         2026-11-27), never before the game's last dealt hand,
--                         and only when that time is at or before the release.
--                         The fleet keeps first-owed times in memory and restarts
--                         with the release, so a time after the release is the
--                         restarted fleet's first cycle, not when the game began
--                         to wait (2026-11-28: after the 1 AM CST seal all nine
--                         owed games carried the same instant, 1:05:15 AM, and
--                         the rows dropped the label though every true wait was
--                         unknown). Such a wait, and one with no first-owed time
--                         at all, is counted by both rows: those are minimums.
--   drain_why             why the drain released what it did, counted over the
--                         beats with a start owed, plus the withheld beats
--                         (detail.variety_drain_why; "not recorded" until a
--                         build that writes it) (INFO). A withheld beat
--                         publishes no owed games: "owed now" and
--                         owed_waiting_now read the newest beat that was not
--                         withheld, or a withheld newest beat reads as
--                         "0 waiting" (review 2026-11-27).
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
         h.detail ->> 'variety_drain_why' AS why,
         CASE WHEN jsonb_typeof(h.detail -> 'variety_owed_since') = 'object'
              THEN h.detail -> 'variety_owed_since' END AS owed_since
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
  SELECT hb.beat_at, g AS game,
         CASE WHEN hb.owed_since ->> g ~ '^\d{4}-\d{2}-\d{2}T'
              THEN (hb.owed_since ->> g)::timestamptz END AS since
    FROM hb, jsonb_array_elements_text(hb.owed_games) g
),
dealt AS (
  SELECT t.cluster_id::text AS game, hh.created_at AS at
    FROM public.hand_history hh JOIN public.tables t ON t.id = hh.table_id, rel
   WHERE hh.created_at > rel.at - interval '3 minutes' AND hh.tournament_id IS NULL
     AND t.cluster_id::text IN (SELECT DISTINCT game FROM owing)
),
ev AS (
  SELECT game, beat_at AS ts, 0 AS deal, since FROM owing
  UNION ALL SELECT game, at, 1, NULL::timestamptz FROM dealt
),
ep AS (
  SELECT game, ts, deal, since,
         sum(deal) OVER (PARTITION BY game ORDER BY ts, deal ROWS UNBOUNDED PRECEDING) AS k
    FROM ev
),
deals AS (SELECT game, k, ts FROM ep WHERE deal = 1),
waiting AS (
  SELECT o.game, o.k, o.ts, o.since
    FROM ep o LEFT JOIN deals d ON d.game = o.game AND d.k = o.k
   WHERE o.deal = 0 AND (d.ts IS NULL OR d.ts < o.ts - interval '3 minutes')
),
wait_runs AS (
  SELECT w.game, w.k, min(w.ts) AS s, max(w.ts) AS last_beat,
         (array_agg(w.since ORDER BY w.ts))[1] AS since,
         (SELECT d.ts FROM deals d WHERE d.game = w.game AND d.k = w.k) AS after_deal,
         (SELECT d.ts FROM deals d WHERE d.game = w.game AND d.k = w.k + 1) AS started_at,
         min(w.ts) <= (SELECT min(beat_at) FROM hb) + interval '60 seconds' AS truncated
    FROM waiting w GROUP BY w.game, w.k
),
waits AS (
  SELECT game, k, last_beat, started_at,
         CASE WHEN truncated AND since <= (SELECT at FROM rel)
              THEN greatest(least(s, since), coalesce(after_deal, '-infinity'::timestamptz))
              ELSE s END AS s,
         truncated AND (since IS NULL OR since > (SELECT at FROM rel)) AS truncated
    FROM wait_runs
),
cap AS (SELECT table_cap FROM public.fn_cash_hourly_table_range()),
census AS (SELECT count(*) AS counted FROM public.fn_cash_hourly_table_capacity_census()),
cap_day AS (
  SELECT max(c.table_cap) AS highest
    FROM generate_series(0, 23) k
   CROSS JOIN LATERAL public.fn_cash_hourly_table_range(clock_timestamp() - make_interval(hours => k)) c
),
room AS (
  SELECT h.beat_at,
         (h.detail -> 'cash_room' ->> 'cap')::int AS cap,
         (h.detail -> 'cash_room' ->> 'counted')::int AS counted,
         h.beat_at > rel.at AS in_window, false AS is_now
    FROM public.ca_horse_fleet_heartbeat h, rel
   WHERE h.beat_at > rel.at - interval '30 minutes'
     AND jsonb_typeof(h.detail -> 'cash_room') = 'object'
  UNION ALL
  SELECT clock_timestamp(), (SELECT table_cap FROM cap), (SELECT counted FROM census)::int, true, true
    FROM rel
),
steps AS (
  SELECT r.beat_at, r.cap, r.counted, r.in_window, r.is_now,
         lag(r.beat_at) OVER w AS p_at, lag(r.cap) OVER w AS p_cap, lag(r.counted) OVER w AS p_counted
    FROM room r WINDOW w AS (ORDER BY r.beat_at)
),
rises AS (
  SELECT s.beat_at, s.is_now, s.cap, s.counted, s.p_at, s.p_counted,
         s.counted - greatest(s.p_counted, s.p_cap, s.cap,
           (SELECT max(c.table_cap)
              FROM generate_series(s.p_at, s.beat_at, interval '1 hour') g
             CROSS JOIN LATERAL public.fn_cash_hourly_table_range(g) c)) AS entered
    FROM steps s
   WHERE s.in_window AND s.p_at IS NOT NULL AND s.counted > s.p_counted AND s.counted > s.cap
),
person_left AS (
  SELECT x.table_id, x.at AS from_ts,
         least(coalesce(x.next_at, 'infinity'::timestamptz), x.at + interval '3 minutes') AS to_ts
    FROM (
      SELECT hh.table_id, hh.created_at AS at, hh.has_human,
             lead(hh.created_at) OVER w AS next_at, lead(hh.has_human) OVER w AS next_human
        FROM public.hand_history hh
        JOIN public.cash_hourly_table_origins o ON o.table_id = hh.table_id AND o.human_started, rel
       WHERE hh.created_at > rel.at - interval '35 minutes' AND hh.tournament_id IS NULL
      WINDOW w AS (PARTITION BY hh.table_id ORDER BY hh.created_at)) x
   WHERE x.has_human IS TRUE
     AND CASE WHEN x.next_at IS NOT NULL THEN x.next_human IS NOT TRUE
              ELSE NOT EXISTS (
                SELECT 1 FROM public.table_seats s JOIN public.profiles p ON p.id = s.user_id
                 WHERE s.table_id = x.table_id AND s.left_at IS NULL AND coalesce(p.is_horse, false) = false) END
  UNION ALL
  SELECT s.table_id, s.left_at, s.left_at
    FROM public.table_seats s
    JOIN public.cash_hourly_table_origins o ON o.table_id = s.table_id AND o.human_started
    JOIN public.profiles p ON p.id = s.user_id AND coalesce(p.is_horse, false) = false, rel
   WHERE s.left_at > rel.at - interval '35 minutes'
),
person_waiting AS (
  SELECT w.game_id, w.created_at AS from_ts,
         CASE WHEN w.status IN ('waiting', 'notified') THEN 'infinity'::timestamptz
              ELSE coalesce(w.updated_at, w.created_at) END AS to_ts
    FROM public.cash_game_waitlist w
    JOIN public.profiles p ON p.id = w.user_id AND coalesce(p.is_horse, false) = false, rel
   WHERE w.status IN ('waiting', 'notified') OR coalesce(w.updated_at, w.created_at) > rel.at - interval '35 minutes'
),
causes AS (
  SELECT r.beat_at, 'the person left person-started table ' || t.name AS cause
    FROM rises r
    JOIN person_left e ON e.from_ts <= r.beat_at AND e.to_ts > r.p_at - interval '35 seconds'
    JOIN public.tables t ON t.id = e.table_id
   WHERE r.entered > 0
  UNION
  SELECT r.beat_at, 'a person was on the waiting list of ' ||
           coalesce((SELECT t.name FROM public.tables t WHERE t.cluster_id = e.game_id
                      ORDER BY t.main_index NULLS LAST, t.created_at LIMIT 1), e.game_id::text)
    FROM rises r
    JOIN person_waiting e ON e.from_ts <= r.beat_at AND e.to_ts > r.p_at - interval '35 seconds'
   WHERE r.entered > 0
),
judged AS (
  SELECT r.beat_at, r.is_now, r.entered, r.p_counted,
         (SELECT count(*) FROM causes c WHERE c.beat_at = r.beat_at) AS explained,
         to_char(r.beat_at AT TIME ZONE 'America/Chicago', 'HH12:MI:SS AM') || ' CT ' || r.p_counted ||
           ' to ' || r.counted || ' at cap ' || r.cap ||
           coalesce(' (' || (SELECT string_agg(c.cause, ' and ' ORDER BY c.cause) FROM causes c
                              WHERE c.beat_at = r.beat_at) || ')', '') AS said
    FROM rises r
   WHERE r.entered > 0
)
SELECT 'heartbeats' AS check_name,
       CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) > 0 THEN 'PASS' ELSE 'FAIL' END AS verdict,
       count(*) || ' heartbeats since ' || coalesce((SELECT at::text FROM rel), 'NO SHIPPED RELEASE') ||
         '; owed now ' || coalesce((SELECT owed FROM hb WHERE why IS DISTINCT FROM 'withheld' ORDER BY beat_at DESC LIMIT 1), 0) AS evidence
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
       count(*) || ' Horse seat(s) joined a table while it was still named for an owed start'
  FROM public.table_seats s
  JOIN public.profiles p ON p.id = s.user_id AND coalesce(p.is_horse, false) = true
 WHERE s.table_id IN (SELECT table_id FROM named)
   AND s.joined_at < (SELECT max(q.beat_at) FROM hb q WHERE q.beat_at <= s.joined_at) + interval '65 seconds'
   AND EXISTS (
     SELECT 1 FROM naming n
      WHERE n.table_id = s.table_id AND n.owed > 0 AND n.beat_at <= s.joined_at
        AND NOT EXISTS (
          SELECT 1 FROM hb q
           WHERE q.beat_at > n.beat_at AND q.beat_at <= s.joined_at
             AND NOT q.named @> to_jsonb(s.table_id::text)))
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
       CASE WHEN (SELECT counted FROM census) <= (SELECT table_cap FROM cap) THEN 'PASS'
            WHEN (SELECT counted FROM census) > (SELECT highest FROM cap_day)
              OR EXISTS (SELECT 1 FROM judged j WHERE j.entered > j.explained) THEN 'FAIL'
            ELSE 'INFO' END,
       (SELECT counted FROM census) || ' counted, cap ' || (SELECT table_cap FROM cap) || ' (now)' ||
         CASE WHEN (SELECT counted FROM census) <= (SELECT table_cap FROM cap) THEN ''
              WHEN (SELECT counted FROM census) > (SELECT highest FROM cap_day)
              THEN '; above every cap of the last 24 hours (highest ' || (SELECT highest FROM cap_day) || ')'
              WHEN EXISTS (SELECT 1 FROM judged j WHERE j.is_now AND j.entered > j.explained)
              THEN '; a table entered the counted room at or above the cap since the newest heartbeat with no person-side cause: ' ||
                   (SELECT j.said FROM judged j WHERE j.is_now)
              WHEN EXISTS (SELECT 1 FROM judged j WHERE j.entered > j.explained)
              THEN '; over the cap after a table entered at or above it with no person-side cause (cap_every_cycle)'
              ELSE '; ' || ((SELECT counted FROM census) - (SELECT table_cap FROM cap)) ||
                   ' over a cap that fell, winding down: no table entered at or above the cap since the newest heartbeat that carries the room' ||
                   coalesce((SELECT ' (' || s.p_counted || ' counted at ' ||
                                    to_char(s.p_at AT TIME ZONE 'America/Chicago', 'HH12:MI:SS AM') || ' CT)'
                               FROM steps s WHERE s.is_now AND s.p_at IS NOT NULL),
                            ' (none carries it: judged against the caps of the last 24 hours only)') ||
                   coalesce('; ' || (SELECT j.said FROM judged j WHERE j.is_now), '') END
UNION ALL
SELECT 'cap_every_cycle',
       CASE WHEN (SELECT count(*) FROM room WHERE in_window AND NOT is_now) = 0 THEN 'INFO'
            WHEN count(*) FILTER (WHERE j.entered > j.explained) = 0 THEN 'PASS'
            ELSE 'FAIL' END,
       coalesce(sum(j.entered - j.explained) FILTER (WHERE j.entered > j.explained), 0) ||
         ' table(s) entered the counted room at or above the cap with no person-side cause, over ' ||
         (SELECT count(*) FROM room WHERE in_window AND NOT is_now) || ' heartbeat(s) that carry the room' ||
         coalesce('; unexplained: ' || string_agg(j.said, '; ' ORDER BY j.beat_at) FILTER (WHERE j.entered > j.explained), '') ||
         coalesce('; explained by a person: ' || string_agg(j.said, '; ' ORDER BY j.beat_at) FILTER (WHERE j.entered <= j.explained), '')
  FROM judged j WHERE NOT j.is_now
UNION ALL
SELECT 'cap_wind_down', 'INFO',
       count(*) FILTER (WHERE s.counted > s.cap) || ' of ' || count(*) ||
         ' heartbeat(s) read more counted tables than the cap' ||
         CASE WHEN count(*) FILTER (WHERE s.counted > s.cap) > 0
              THEN ', at most ' || max(s.counted - s.cap) || ' over; ' ||
                   (array_agg(s.counted ORDER BY s.beat_at) FILTER (WHERE s.counted > s.cap))[1] ||
                   ' counted at the first, ' ||
                   (array_agg(s.counted ORDER BY s.beat_at DESC) FILTER (WHERE s.counted > s.cap))[1] ||
                   ' at the newest (' ||
                   CASE sign((array_agg(s.counted ORDER BY s.beat_at DESC) FILTER (WHERE s.counted > s.cap))[1] -
                             (array_agg(s.counted ORDER BY s.beat_at) FILTER (WHERE s.counted > s.cap))[1])
                        WHEN -1 THEN 'falling' WHEN 0 THEN 'level' ELSE 'rising' END || ')'
              ELSE '' END ||
         coalesce('; the cap fell: ' || string_agg(
           to_char(s.beat_at AT TIME ZONE 'America/Chicago', 'HH12:MI:SS AM') || ' CT ' || s.p_cap || ' to ' || s.cap ||
             ' (' || s.counted || ' counted)', '; ' ORDER BY s.beat_at) FILTER (WHERE s.cap < s.p_cap), '')
  FROM steps s WHERE s.in_window AND NOT s.is_now
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
  FROM waits WHERE started_at IS NULL
   AND last_beat = (SELECT max(beat_at) FROM hb WHERE why IS DISTINCT FROM 'withheld')
UNION ALL
SELECT 'drain_why', 'INFO',
       coalesce(string_agg(w.why || ' ' || w.n, ', ' ORDER BY w.n DESC, w.why), 'no beat with a start owed')
  FROM (SELECT coalesce(why, 'not recorded') AS why, count(*) AS n FROM hb WHERE owed > 0 OR why = 'withheld' GROUP BY 1) w
UNION ALL
SELECT 'horse_error_log',
       CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       count(*) || ' row(s) since the release'
  FROM public.horse_error_log e, rel
 WHERE e.created_at > rel.at;
