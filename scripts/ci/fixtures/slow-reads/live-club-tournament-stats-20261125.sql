CREATE OR REPLACE FUNCTION public.fn_club_tournament_stats(p_club_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE("userId" uuid, username text, avatar text, "tournamentsPlayed" integer, wins integer, "finalTables" integer, "itmFinishes" integer, "totalPrizes" numeric, roi numeric, "biggestWin" numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT
        tp.user_id,
        COALESCE(pr.username, tp.username)::text,
        pr.arena_avatar_url::text,
        COUNT(DISTINCT tp.tournament_id)::int,
        COUNT(*) FILTER (WHERE tp.position = 1)::int,
        COUNT(*) FILTER (WHERE tp.position IS NOT NULL AND tp.position <= 9)::int,
        COUNT(*) FILTER (WHERE COALESCE(tp.prize, 0) > 0)::int,
        COALESCE(SUM(tp.prize), 0)::numeric,
        (CASE
            WHEN SUM(COALESCE(t.buy_in_amount, 0) + COALESCE(t.buy_in_fee, 0)) > 0
            THEN ((COALESCE(SUM(tp.prize), 0)
                   - SUM(COALESCE(t.buy_in_amount, 0) + COALESCE(t.buy_in_fee, 0)))
                  / SUM(COALESCE(t.buy_in_amount, 0) + COALESCE(t.buy_in_fee, 0))) * 100.0
            ELSE 0
        END)::numeric,
        COALESCE(MAX(tp.prize), 0)::numeric
    FROM tournament_players tp
    JOIN tournaments t ON t.id = tp.tournament_id
    LEFT JOIN profiles pr ON pr.id = tp.user_id
    WHERE t.club_id = p_club_id
      AND tp.status IN ('eliminated', 'winner')
    GROUP BY tp.user_id, COALESCE(pr.username, tp.username), pr.arena_avatar_url
    -- user_id breaks ties: without it, two players on equal prizes can swap
    -- between pages and the same row appears twice while another never does.
    ORDER BY 8 DESC, tp.user_id
    LIMIT GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0);
$function$
