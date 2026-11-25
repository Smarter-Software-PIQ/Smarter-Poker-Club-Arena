-- THE LEADERBOARD READS ITS UNFOLDED TAIL BY INDEX (2026-11-25)
--
-- What production showed. After 20261125022320 folded finished history,
-- fn_club_tournament_stats answered Deep Stack Society in about 40 ms but
-- Midway Union still took about 1.4 s. The function is LANGUAGE sql, so it
-- runs on a generic plan, and its live tail was one predicate
--   unfolded_ended_at IS NULL OR unfolded_ended_at >= (SELECT folded_before ...)
-- which a generic plan cannot turn into an index range. It walked every one of
-- Midway Union's 836,174 tournaments through the club_id prefix of
-- tournaments_leaderboard_club_unfolded and filtered them one by one.
--
-- The rule. The tail is read as two index ranges joined by UNION ALL: the
-- tournaments whose unfolded end is NULL (still running, or private), and
-- those whose unfolded end is at or after folded_before. The boundary stays a
-- scalar sub-select, computed once, so it bounds the second column of
-- tournaments_leaderboard_club_unfolded instead of being re-checked row by
-- row. The two halves are disjoint (a NULL is never >= anything), so the
-- union is exactly the old OR, row for row. Measured on production 2026-11-25 with a forced generic
-- plan: Midway Union 1,243 ms before, 40.7 ms after, and the same 1,135
-- rows (row-by-row difference 0).
--
-- Only the tail's FROM/WHERE changes. Security, owner, grants, search_path
-- and every output column stay as they are (the function is SECURITY
-- INVOKER, so the caller's row security still applies to the tail).
--
-- @live-proof: md5(pg_get_functiondef('public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure)) = '293e23383210c9ea4e7e4afe7bc8b1f1'
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $pin$
BEGIN
  IF md5(pg_get_functiondef('public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure))
     <> '9159627c91761041d511d910fd94c923' THEN
    RAISE EXCEPTION 'fn_club_tournament_stats changed since 20261125022320; rebase this migration on the live body';
  END IF;
END $pin$;

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
        -- The two halves of the tail are read as two index ranges joined by
        -- UNION ALL, never as one OR: inside this function the plan is
        -- generic, and an OR against the boundary sub-select made it walk
        -- every tournament of the club (Midway Union: 836,174 rows, 1.2 s).
        -- A fold key is NULL or a timestamp, so the halves are disjoint. The
        -- boundary stays a scalar sub-select so it is computed once and both
        -- columns of the index bound the second range.
        SELECT tp.user_id,
               count(*)::integer AS tournaments_played,
               (count(*) FILTER (WHERE tp.position = 1))::integer AS wins,
               (count(*) FILTER (WHERE tp.position IS NOT NULL AND tp.position <= 9))::integer AS final_tables,
               (count(*) FILTER (WHERE COALESCE(tp.prize, 0) > 0))::integer AS itm_finishes,
               COALESCE(sum(tp.prize), 0)::numeric AS total_prizes,
               sum(COALESCE(t.buy_in_amount, 0) + COALESCE(t.buy_in_fee, 0))::numeric AS total_buy_ins,
               COALESCE(max(tp.prize), 0)::numeric AS biggest_win,
               max(tp.username) AS username
          FROM (
                SELECT u.id, u.buy_in_amount, u.buy_in_fee
                  FROM tournaments u
                 WHERE u.club_id = p_club_id
                   AND (CASE WHEN u.is_private IS TRUE THEN NULL::timestamptz ELSE u.ended_at END) IS NULL
                UNION ALL
                SELECT u.id, u.buy_in_amount, u.buy_in_fee
                  FROM tournaments u
                 WHERE u.club_id = p_club_id
                   AND (CASE WHEN u.is_private IS TRUE THEN NULL::timestamptz ELSE u.ended_at END)
                       >= (SELECT b.folded_before FROM boundary b)
               ) t
          JOIN tournament_players tp ON tp.tournament_id = t.id
         WHERE tp.status IN ('eliminated', 'winner')
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
$function$
;

DO $verify$
BEGIN
  IF md5(pg_get_functiondef('public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure))
     <> '293e23383210c9ea4e7e4afe7bc8b1f1' THEN
    RAISE EXCEPTION 'fn_club_tournament_stats body is not the reviewed post-image';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure
      AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_temp'] AND pg_get_userbyid(p.proowner)='postgres'
      AND (SELECT array_agg(a ORDER BY a COLLATE "C") FROM unnest(p.proacl::text[]) a)
          = ARRAY['=X/postgres','anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']) THEN
    RAISE EXCEPTION 'fn_club_tournament_stats metadata changed';
  END IF;
END $verify$;
COMMIT;
