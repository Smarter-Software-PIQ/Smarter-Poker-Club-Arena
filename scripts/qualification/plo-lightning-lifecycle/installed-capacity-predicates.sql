-- Exact installed read-only capacity and label predicates, November10; no credentials.
CREATE OR REPLACE FUNCTION public.fn_cash_money_text(p numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p = trunc(p) THEN trunc(p)::bigint::text
              ELSE to_char(p, 'FM999999990.00') END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_cash_game_never_moves_players(p_template text, p_ruleset jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Dan 2026-11-07: "EVERY SINGLE GAME IS A MUST MOVE GAME". Classic games do
  -- not convert to Lightning; they still move players like every other game.
  SELECT false
$function$
;


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
$function$
;


CREATE OR REPLACE FUNCTION public.fn_cash_stakes_label(p_sb numeric, p_bb numeric, p_variant text DEFAULT 'nlh'::text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN lower(coalesce(p_variant, 'nlh')) IN ('flh', 'flo8')
              THEN public.fn_cash_money_text(p_bb) || '/' || public.fn_cash_money_text(p_bb * 2)
              ELSE public.fn_cash_money_text(p_sb) || '/' || public.fn_cash_money_text(p_bb) END;
$function$
;


CREATE OR REPLACE FUNCTION public.fn_cash_cluster_census(p_game_id uuid, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS cash_cluster_census_row[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(array_agg(
           (q.id, q.role, q.main_index, q.lifecycle, q.status, q.created_at, q.max_players,
            q.seated, q.reserved, GREATEST(0, q.max_players - q.seated - q.reserved),
            q.lifecycle = 'breaking')::public.cash_cluster_census_row
           ORDER BY q.created_at), '{}'::public.cash_cluster_census_row[])
    FROM (
      SELECT tb.id, tb.role, tb.main_index, tb.lifecycle, tb.status, tb.created_at,
             coalesce(tb.max_players, 9) AS max_players,
             (SELECT count(*) FROM public.table_seats ts WHERE ts.table_id = tb.id AND ts.left_at IS NULL)::integer AS seated,
             (SELECT count(*) FROM public.table_waitlist w
               WHERE w.table_id = tb.id AND w.status = 'notified' AND w.hold_expires_at > p_now)::integer
             -- A FULL-RING FEEDER START HOLDS ITS CHAIRS (Dan 2026-11-08).
             + coalesce((SELECT fs.held FROM public.cash_cluster_feeder_starts fs
                          WHERE fs.main_table_id = tb.id), 0)::integer AS reserved
        FROM public.tables tb
       WHERE tb.cluster_id = p_game_id AND coalesce(tb.is_deleted, false) = false
         AND coalesce(tb.lifecycle, '') <> 'closed'
    ) q;
$function$
;
