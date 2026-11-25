-- THE CLUB TOURNAMENT LEADERBOARD READS A FOLDED TOTAL (2026-11-25)
--
-- What production showed. fn_club_tournament_stats (the club Tournament
-- leaderboard, LeaderboardService.getClubTournamentStats) was cancelled by
-- the 8 s statement timeout 30 times between 2026-11-24 11:32 and
-- 2026-11-25 01:22 UTC. It aggregated a club's whole tournament history on
-- every page load: Midway Union holds 2,610,480 finished entries in 833,459
-- tournaments and Deep Stack Society 427,908. Measured on production
-- 2026-11-25: 110,066 entries took 6,967 ms with a cold cache and 557 ms warm,
-- so Midway Union (24 times larger) cannot finish inside 8 s at all.
--
-- The rule. Finished history is folded once into
-- smarter_private.club_tournament_leaderboard_totals, one row per (club,
-- player), by smarter_private.refresh_club_tournament_leaderboard_totals()
-- every 30 minutes. The fold covers every non-private tournament whose
-- ended_at is before its recorded folded_before (10 minutes before the run,
-- so late prize writes land first). The reader adds the live tail, read
-- exactly as before under the caller's own row security: every tournament of
-- the club not yet folded (ended_at NULL or at or after folded_before) and
-- every private tournament. The two parts are disjoint by construction, so
-- the totals equal the full aggregate at the moment of the read. Each run
-- recomputes the whole fold and writes only rows whose figures changed, so a
-- prize corrected after the fold is reflected within one run. Measured: the
-- full fold reads 3,193,432 entries in 9.1 s warm and produces 3,594 rows.
--
-- Two deliberate details. A player is one row (grouped by user_id; the old
-- reader split a player whose entries carried different usernames). The
-- folded part is read through a SECURITY DEFINER helper that returns only
-- non-private tournaments, which every role already reads through
-- tournaments_select_scoped, while tournament_players_select is open to all:
-- the helper shows nothing the old reader did not.
--
-- @live-proof: to_regclass('smarter_private.club_tournament_leaderboard_totals') IS NOT NULL AND (SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass('public.tournaments_leaderboard_club_unfolded')) AND (SELECT prosrc LIKE '%fn_club_tournament_leaderboard_folded%' FROM pg_proc WHERE oid='public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure) AND EXISTS (SELECT 1 FROM cron.job WHERE jobname='club-tournament-leaderboard-fold')
CREATE INDEX CONCURRENTLY IF NOT EXISTS tournaments_leaderboard_club_unfolded
 ON public.tournaments (club_id, (CASE WHEN is_private IS TRUE THEN NULL::timestamptz ELSE ended_at END));
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $pin$
BEGIN
  IF md5(pg_get_functiondef('public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure))
     <> '627eccb4daed89a26feeda113eab0118' THEN
    RAISE EXCEPTION 'fn_club_tournament_stats changed since 2026-11-25; rebase this migration on the live body';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid='public.tournaments_leaderboard_club_unfolded'::regclass
      AND i.indrelid='public.tournaments'::regclass AND i.indisvalid AND i.indisready AND i.indpred IS NULL
      AND pg_get_indexdef(i.indexrelid) LIKE '%(club_id, (%is_private IS TRUE%ended_at%') THEN
    RAISE EXCEPTION 'tournaments_leaderboard_club_unfolded is missing, invalid or not the leaderboard index';
  END IF;
END $pin$;

CREATE TABLE smarter_private.club_tournament_leaderboard_totals (
  club_id uuid NOT NULL,
  user_id uuid NOT NULL,
  tournaments_played integer NOT NULL,
  wins integer NOT NULL,
  final_tables integer NOT NULL,
  itm_finishes integer NOT NULL,
  total_prizes numeric NOT NULL,
  total_buy_ins numeric NOT NULL,
  biggest_win numeric NOT NULL,
  username text,
  PRIMARY KEY (club_id, user_id)
);
CREATE TABLE smarter_private.club_tournament_leaderboard_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  folded_before timestamptz NOT NULL,
  refreshed_at timestamptz NOT NULL,
  pairs integer NOT NULL,
  rows_written integer NOT NULL,
  rows_removed integer NOT NULL
);
ALTER TABLE smarter_private.club_tournament_leaderboard_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE smarter_private.club_tournament_leaderboard_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.club_tournament_leaderboard_totals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON smarter_private.club_tournament_leaderboard_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON smarter_private.club_tournament_leaderboard_totals TO service_role;
GRANT SELECT ON smarter_private.club_tournament_leaderboard_state TO service_role;

-- The fold. One run at a time; reads the finished history once and writes
-- only the rows whose figures changed (a scheduled job does only the work it
-- finds). folded_before moves in the same transaction as the rows.
CREATE FUNCTION smarter_private.refresh_club_tournament_leaderboard_totals()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_before timestamptz := date_trunc('minute', now()) - interval '10 minutes';
  v_pairs integer; v_written integer; v_removed integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('club-tournament-leaderboard-fold', 0)) THEN
    RETURN jsonb_build_object('skipped', 'a fold is already running');
  END IF;

  CREATE TEMP TABLE leaderboard_fold ON COMMIT DROP AS
  SELECT t.club_id, tp.user_id,
         count(*)::integer AS tournaments_played,
         (count(*) FILTER (WHERE tp.position = 1))::integer AS wins,
         (count(*) FILTER (WHERE tp.position IS NOT NULL AND tp.position <= 9))::integer AS final_tables,
         (count(*) FILTER (WHERE COALESCE(tp.prize, 0) > 0))::integer AS itm_finishes,
         COALESCE(sum(tp.prize), 0)::numeric AS total_prizes,
         sum(COALESCE(t.buy_in_amount, 0) + COALESCE(t.buy_in_fee, 0))::numeric AS total_buy_ins,
         COALESCE(max(tp.prize), 0)::numeric AS biggest_win,
         max(tp.username) AS username
    FROM public.tournament_players tp
    JOIN public.tournaments t ON t.id = tp.tournament_id
   WHERE tp.status IN ('eliminated', 'winner')
     AND t.club_id IS NOT NULL
     AND (CASE WHEN t.is_private IS TRUE THEN NULL::timestamptz ELSE t.ended_at END) < v_before
   GROUP BY t.club_id, tp.user_id;
  GET DIAGNOSTICS v_pairs = ROW_COUNT;

  DELETE FROM smarter_private.club_tournament_leaderboard_totals x
   WHERE NOT EXISTS (SELECT 1 FROM leaderboard_fold f WHERE f.club_id = x.club_id AND f.user_id = x.user_id);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  INSERT INTO smarter_private.club_tournament_leaderboard_totals AS x
    (club_id, user_id, tournaments_played, wins, final_tables, itm_finishes, total_prizes, total_buy_ins, biggest_win, username)
  SELECT club_id, user_id, tournaments_played, wins, final_tables, itm_finishes, total_prizes, total_buy_ins, biggest_win, username
    FROM leaderboard_fold
  ON CONFLICT (club_id, user_id) DO UPDATE SET
    tournaments_played = EXCLUDED.tournaments_played, wins = EXCLUDED.wins,
    final_tables = EXCLUDED.final_tables, itm_finishes = EXCLUDED.itm_finishes,
    total_prizes = EXCLUDED.total_prizes, total_buy_ins = EXCLUDED.total_buy_ins,
    biggest_win = EXCLUDED.biggest_win, username = EXCLUDED.username
  WHERE (x.tournaments_played, x.wins, x.final_tables, x.itm_finishes, x.total_prizes, x.total_buy_ins, x.biggest_win, x.username)
        IS DISTINCT FROM
        (EXCLUDED.tournaments_played, EXCLUDED.wins, EXCLUDED.final_tables, EXCLUDED.itm_finishes, EXCLUDED.total_prizes, EXCLUDED.total_buy_ins, EXCLUDED.biggest_win, EXCLUDED.username);
  GET DIAGNOSTICS v_written = ROW_COUNT;

  INSERT INTO smarter_private.club_tournament_leaderboard_state AS s
    (singleton, folded_before, refreshed_at, pairs, rows_written, rows_removed)
  VALUES (true, v_before, now(), v_pairs, v_written, v_removed)
  ON CONFLICT (singleton) DO UPDATE SET folded_before = EXCLUDED.folded_before, refreshed_at = EXCLUDED.refreshed_at,
    pairs = EXCLUDED.pairs, rows_written = EXCLUDED.rows_written, rows_removed = EXCLUDED.rows_removed;

  RETURN jsonb_build_object('folded_before', v_before, 'pairs', v_pairs, 'rows_written', v_written, 'rows_removed', v_removed);
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.refresh_club_tournament_leaderboard_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.refresh_club_tournament_leaderboard_totals() TO service_role;
-- @probe-exempt: smarter_private.refresh_club_tournament_leaderboard_totals folds the whole finished history (3,193,432 entries, 9.1 s warm on production), which an install transaction under the 12 s budget must not run; its cron runs it at :07 and :37 under 120 s, and scripts/ci/test-slow-reads-stand-down-and-leaderboard-fold.py executes it at every stage against the old reader

-- The folded part for one club, with the fold boundary. One row carries
-- folded_before even when the club has no folded players (user_id NULL); no
-- row at all means no fold has run yet, and the reader then reads everything
-- live, exactly as before.
CREATE FUNCTION public.fn_club_tournament_leaderboard_folded(p_club_id uuid)
 RETURNS TABLE(folded_before timestamptz, user_id uuid, tournaments_played integer, wins integer, final_tables integer,
               itm_finishes integer, total_prizes numeric, total_buy_ins numeric, biggest_win numeric, username text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.folded_before, x.user_id, x.tournaments_played, x.wins, x.final_tables, x.itm_finishes,
         x.total_prizes, x.total_buy_ins, x.biggest_win, x.username
    FROM smarter_private.club_tournament_leaderboard_state s
    LEFT JOIN smarter_private.club_tournament_leaderboard_totals x ON x.club_id = p_club_id
   WHERE s.singleton;
$function$;
REVOKE ALL ON FUNCTION public.fn_club_tournament_leaderboard_folded(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_club_tournament_leaderboard_folded(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_club_tournament_stats(p_club_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE("userId" uuid, username text, avatar text, "tournamentsPlayed" integer, wins integer, "finalTables" integer, "itmFinishes" integer, "totalPrizes" numeric, roi numeric, "biggestWin" numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH folded AS MATERIALIZED (
        SELECT * FROM public.fn_club_tournament_leaderboard_folded(p_club_id)
    ), boundary AS (
        SELECT COALESCE(max(folded_before), '-infinity'::timestamptz) AS folded_before FROM folded
    ), live AS (
        -- Everything the fold has not taken, read under the caller's own row
        -- security exactly as the full reader did: unfinished, recently
        -- finished, and every private tournament (whose fold key is NULL).
        SELECT tp.user_id,
               count(*)::integer AS tournaments_played,
               (count(*) FILTER (WHERE tp.position = 1))::integer AS wins,
               (count(*) FILTER (WHERE tp.position IS NOT NULL AND tp.position <= 9))::integer AS final_tables,
               (count(*) FILTER (WHERE COALESCE(tp.prize, 0) > 0))::integer AS itm_finishes,
               COALESCE(sum(tp.prize), 0)::numeric AS total_prizes,
               sum(COALESCE(t.buy_in_amount, 0) + COALESCE(t.buy_in_fee, 0))::numeric AS total_buy_ins,
               COALESCE(max(tp.prize), 0)::numeric AS biggest_win,
               max(tp.username) AS username
          FROM tournaments t
          JOIN tournament_players tp ON tp.tournament_id = t.id
         WHERE t.club_id = p_club_id
           AND ((CASE WHEN t.is_private IS TRUE THEN NULL::timestamptz ELSE t.ended_at END) IS NULL
             OR (CASE WHEN t.is_private IS TRUE THEN NULL::timestamptz ELSE t.ended_at END) >= (SELECT b.folded_before FROM boundary b))
           AND tp.status IN ('eliminated', 'winner')
         GROUP BY tp.user_id
    ), parts AS (
        SELECT user_id, tournaments_played, wins, final_tables, itm_finishes, total_prizes, total_buy_ins, biggest_win, username
          FROM folded WHERE user_id IS NOT NULL
        UNION ALL
        SELECT user_id, tournaments_played, wins, final_tables, itm_finishes, total_prizes, total_buy_ins, biggest_win, username
          FROM live
    ), totals AS (
        SELECT user_id,
               sum(tournaments_played)::integer AS tournaments_played,
               sum(wins)::integer AS wins,
               sum(final_tables)::integer AS final_tables,
               sum(itm_finishes)::integer AS itm_finishes,
               sum(total_prizes) AS total_prizes,
               sum(total_buy_ins) AS total_buy_ins,
               max(biggest_win) AS biggest_win,
               max(username) AS username
          FROM parts
         GROUP BY user_id
    )
    SELECT
        x.user_id,
        COALESCE(pr.username, x.username)::text,
        pr.arena_avatar_url::text,
        x.tournaments_played,
        x.wins,
        x.final_tables,
        x.itm_finishes,
        x.total_prizes::numeric,
        (CASE WHEN x.total_buy_ins > 0
              THEN ((x.total_prizes - x.total_buy_ins) / x.total_buy_ins) * 100.0
              ELSE 0 END)::numeric,
        x.biggest_win::numeric
    FROM totals x
    LEFT JOIN profiles pr ON pr.id = x.user_id
    -- user_id breaks ties: without it, two players on equal prizes can swap
    -- between pages and the same row appears twice while another never does.
    ORDER BY 8 DESC, x.user_id
    LIMIT GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
$function$;

SELECT cron.schedule('club-tournament-leaderboard-fold', '7,37 * * * *',
  $job$SET statement_timeout = '120s'; SELECT smarter_private.refresh_club_tournament_leaderboard_totals();$job$);

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner)='postgres'
      AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(p.proacl::text[]) a)
          = ARRAY['=X/postgres','anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) THEN
    RAISE EXCEPTION 'fn_club_tournament_stats metadata changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_club_tournament_leaderboard_folded(uuid)'::regprocedure
      AND p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_temp']
      AND NOT (p.proacl::text LIKE '{=X/%' OR p.proacl::text LIKE '%,=X/%')) THEN
    RAISE EXCEPTION 'fn_club_tournament_leaderboard_folded metadata changed';
  END IF;
  IF has_table_privilege('anon', 'smarter_private.club_tournament_leaderboard_totals', 'SELECT')
     OR has_table_privilege('authenticated', 'smarter_private.club_tournament_leaderboard_totals', 'SELECT') THEN
    RAISE EXCEPTION 'the folded totals must not be readable directly';
  END IF;
END $verify$;
COMMIT;
