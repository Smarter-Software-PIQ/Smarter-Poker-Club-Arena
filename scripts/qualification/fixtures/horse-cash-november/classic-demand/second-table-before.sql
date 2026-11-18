CREATE OR REPLACE FUNCTION public.fn_cash_game_second_table_picked(p_game_id uuid, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH c AS (
    SELECT extract(hour FROM p_at AT TIME ZONE 'America/Chicago')::int AS h,
           extract(isodow FROM p_at AT TIME ZONE 'America/Chicago')::int AS d
  ), base AS (
    SELECT CASE
             WHEN (c.d IN (5, 6) AND c.h >= 18) OR (c.d IN (6, 7) AND c.h < 4) THEN 70
             WHEN c.h >= 18 THEN 60
             WHEN c.h >= 10 THEN 50
             WHEN c.d BETWEEN 1 AND 4 AND c.h >= 4 THEN 15
             WHEN c.h >= 4 THEN 20
             ELSE 30
           END AS rate
      FROM c
  ), g AS (
    SELECT coalesce(cg.bb, 0)::numeric AS bb, lower(coalesce(cg.variant, '')) AS variant
      FROM public.cash_games cg WHERE cg.id = p_game_id
  ), r AS (
    SELECT CASE
             WHEN g.bb >= 5 OR g.variant IN ('flh', 'flo8', 'plo8', 'short_deck', 'pineapple')
               THEN (base.rate + 2) / 4
             WHEN g.bb BETWEEN 0.25 AND 2 AND g.variant IN ('nlh', 'plo4', 'plo5', 'plo6')
               THEN least(90, (base.rate * 13 + 5) / 10)
             ELSE base.rate
           END AS rate
      FROM base LEFT JOIN g ON true
  )
  SELECT (('x' || lpad(substr(md5(p_game_id::text || ':second_table:'
             || floor(extract(epoch FROM p_at) / 10800)::bigint::text), 1, 8), 16, '0'))::bit(64)::bigint % 100)
         < (SELECT rate FROM r)
$function$;
