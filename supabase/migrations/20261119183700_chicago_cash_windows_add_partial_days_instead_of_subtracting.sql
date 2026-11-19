-- Chicago calendar cash windows for Player Record Win/Loss and Club Roster.
-- Purely additive partial-day decomposition: complete interior UTC days come
-- from member_record_daily_facts / ca_stats_member_record_daily_facts; partial
-- Chicago boundary slices [cs, u1) and [u2, ce) are added directly from
-- retained timestamped ca_hand_facts. Single-day Today reads skip UTC daily
-- rollups completely and scan only [chicago_start, chicago_end).
--
-- Previously, ca_club_member_chicago_today_cash, ca_club_member_chicago_cash,
-- and ca_club_members_cash_window read UTC daily buckets and subtracted raw
-- ca_hand_facts in the UTC/Chicago edge slices. When a player moved from a
-- Feeder to a Main union table without a new buyin funding receipt and
-- post-commit rake_attributions arrived after ca_hand_facts insert, the daily
-- rollup had incremented the table's union club while read-time attribution
-- resolved to the player's club -- subtracting a -5.00 edge hand from 0
-- produced phantom +5.00 Today Cash win/loss on a day with 0 hands played
-- (observed live on Kings Club member fa407ee1-5473-42ec-a9ac-a1eee50983fe
-- on 2026-11-19).
--
-- Read-only reporting functions only. No table DDL, financial writes, or engine dependency.
-- @live-proof: position('Purely additive' IN pg_get_functiondef('public.ca_club_member_chicago_today_cash(uuid,uuid,timestamp with time zone)'::regprocedure)) > 0
-- @live-proof: position('Purely additive' IN pg_get_functiondef('public.ca_club_member_chicago_cash(uuid,uuid,date,date)'::regprocedure)) > 0
-- @live-proof: position('Purely additive' IN pg_get_functiondef('public.ca_club_members_cash_window(uuid,uuid[],date,date)'::regprocedure)) > 0
-- @live-proof: NOT has_function_privilege('authenticated', 'public.ca_club_member_chicago_today_cash(uuid,uuid,timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.ca_club_member_chicago_cash(uuid,uuid,date,date)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.ca_club_members_cash_window(uuid,uuid[],date,date)', 'EXECUTE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF to_regprocedure('public.ca_club_member_chicago_today_cash(uuid,uuid,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.ca_club_member_chicago_cash(uuid,uuid,date,date)') IS NULL
     OR to_regprocedure('public.ca_club_members_cash_window(uuid,uuid[],date,date)') IS NULL THEN
    RAISE EXCEPTION 'chicago cash window helper missing before additive fix';
  END IF;
  IF position(
    'ca_stats_member_record_daily_facts'
    IN pg_get_functiondef('public.ca_club_members_cash_window(uuid,uuid[],date,date)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'ca_club_members_cash_window preimage missing ca_stats_member_record_daily_facts';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ca_club_member_chicago_today_cash(
  p_club_id uuid,
  p_user_id uuid,
  p_at timestamp with time zone DEFAULT now()
)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH day AS (
    SELECT (p_at AT TIME ZONE 'America/Chicago')::date AS local_day
  ), bounds AS (
    SELECT
      local_day::timestamp AT TIME ZONE 'America/Chicago' AS chicago_start,
      (local_day + 1)::timestamp AT TIME ZONE 'America/Chicago' AS chicago_end
    FROM day
  )
  -- Purely additive single-day Chicago read from retained timestamped facts.
  -- Skips UTC daily rollups completely so post-commit club attribution lag
  -- can never subtract an unattributed edge hand and invert win/loss.
  SELECT coalesce(sum(f.net), 0)
    FROM bounds b
    JOIN public.ca_hand_facts f
      ON f.user_id = p_user_id
     AND f.tournament_id IS NULL
     AND f.played_at >= b.chicago_start
     AND f.played_at < b.chicago_end
   WHERE public.fn_member_record_fact_club(f) = p_club_id
     AND public.fn_ca_launch_accounting_accepts(p_club_id, f.played_at);
$function$;

REVOKE ALL ON FUNCTION public.ca_club_member_chicago_today_cash(uuid, uuid, timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ca_club_member_chicago_cash(
  p_club_id uuid,
  p_user_id uuid,
  p_from date,
  p_to date
)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH bounds AS (
    SELECT
      p_from::timestamp AT TIME ZONE 'America/Chicago' AS cs,
      (p_from + 1)::timestamp AT TIME ZONE 'UTC' AS u1,
      p_to::timestamp AT TIME ZONE 'UTC' AS u2,
      p_to::timestamp AT TIME ZONE 'America/Chicago' AS ce
  )
  -- Purely additive disjoint Chicago decomposition (p_to is exclusive):
  -- complete interior UTC days (p_from + 1 .. p_to - 1) from daily rollups
  -- plus start [cs, u1) and end [u2, ce) partial-day slices from ca_hand_facts.
  SELECT CASE WHEN p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN 0::numeric ELSE
         (SELECT coalesce(sum(d.net), 0)
            FROM public.ca_member_record_daily_facts(p_club_id, p_user_id, p_from + 1, p_to - 1) d
           WHERE p_to >= p_from + 2
             AND NOT d.is_mtt)
       + (SELECT coalesce(sum(f.net), 0)
            FROM LATERAL (VALUES (b.cs, b.u1), (b.u2, b.ce)) edge(start_at, end_at)
            JOIN public.ca_hand_facts f
              ON f.user_id = p_user_id
             AND f.tournament_id IS NULL
             AND f.played_at >= edge.start_at
             AND f.played_at < edge.end_at
           WHERE public.fn_member_record_fact_club(f) = p_club_id
             AND public.fn_ca_launch_accounting_accepts(p_club_id, f.played_at))
         END
    FROM bounds b;
$function$;

REVOKE ALL ON FUNCTION public.ca_club_member_chicago_cash(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ca_club_members_cash_window(
  p_club_id uuid,
  p_user_ids uuid[],
  p_from date,
  p_to date
)
RETURNS TABLE(user_id uuid, cash_net numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $cash_window$
  WITH b AS MATERIALIZED (
    SELECT
      public.fn_ca_launch_accounting_cutoff('club', p_club_id) AS cutoff,
      (p_from IS NULL AND p_to IS NULL) AS overall,
      (p_from IS NULL AND p_to IS NULL) OR
        (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to > p_from) AS valid,
      p_from::timestamp AT TIME ZONE 'America/Chicago' AS cs,
      (p_from + 1)::timestamp AT TIME ZONE 'UTC' AS u1,
      p_to::timestamp AT TIME ZONE 'UTC' AS u2,
      p_to::timestamp AT TIME ZONE 'America/Chicago' AS ce
  ), wanted AS MATERIALIZED (
    SELECT DISTINCT uid
      FROM unnest(coalesce(p_user_ids, ARRAY[]::uuid[])) uid
     WHERE uid IS NOT NULL
  ), daily AS MATERIALIZED (
    -- Purely additive interior complete UTC days (p_from + 1 .. p_to - 1),
    -- or all days for Overall. Single-day windows skip daily rollups.
    SELECT f.user_id AS uid, sum(f.net) AS net
      FROM wanted w
      JOIN public.ca_stats_member_record_daily_facts f ON f.user_id = w.uid
      CROSS JOIN b
     WHERE b.valid
       AND f.club_id = p_club_id
       AND NOT f.is_mtt
       AND f.accounting_cutoff IS NOT DISTINCT FROM b.cutoff
       AND (
         b.overall
         OR (p_to >= p_from + 2 AND f.played_on >= p_from + 1 AND f.played_on <= p_to - 1)
       )
     GROUP BY f.user_id
  ), edges AS MATERIALIZED (
    -- Purely additive start [cs, u1) and end [u2, ce) partial-day slices.
    SELECT f.user_id, f.table_id, f.hand_id, f.played_at, f.club_id, f.net
      FROM wanted w
      CROSS JOIN b
      CROSS JOIN LATERAL (VALUES (b.cs, b.u1), (b.u2, b.ce)) edge(start_at, end_at)
      JOIN public.ca_hand_facts f
        ON f.user_id = w.uid
       AND f.played_at >= edge.start_at
       AND f.played_at < edge.end_at
     WHERE b.valid
       AND NOT b.overall
       AND f.tournament_id IS NULL
       AND CASE WHEN b.cutoff IS NULL THEN true ELSE
         f.played_at IS NOT NULL AND isfinite(f.played_at) AND f.played_at >= b.cutoff END
  ), occupancies AS MATERIALIZED (
    SELECT DISTINCT table_id, user_id FROM edges
  ), funding AS MATERIALIZED (
    SELECT DISTINCT ON (x.table_id, x.account_entity_id, x.seat_joined_at)
      x.table_id, x.account_entity_id, x.seat_joined_at, x.funding_club_id
      FROM public.cash_participant_funding_receipts x
      JOIN occupancies o
        ON o.table_id = x.table_id AND o.user_id = x.account_entity_id
     WHERE x.operation_kind = 'buyin'
     ORDER BY x.table_id, x.account_entity_id, x.seat_joined_at, x.recorded_at DESC, x.id DESC
  ), timeline AS MATERIALIZED (
    SELECT *, lead(seat_joined_at) OVER (
      PARTITION BY table_id, account_entity_id ORDER BY seat_joined_at
    ) AS next_joined_at
      FROM funding
  ), resolved AS MATERIALIZED (
    SELECT f.*, x.funding_club_id
      FROM edges f
      LEFT JOIN timeline x
        ON x.table_id = f.table_id
       AND x.account_entity_id = f.user_id
       AND x.seat_joined_at <= f.played_at
       AND (x.next_joined_at IS NULL OR f.played_at < x.next_joined_at)
  ), unfunded AS MATERIALIZED (
    SELECT * FROM resolved WHERE funding_club_id IS NULL
  ), amounts AS (
    SELECT f.user_id AS uid, f.net FROM resolved f WHERE f.funding_club_id = p_club_id
    UNION ALL
    SELECT f.user_id AS uid, f.net
      FROM unfunded f
      LEFT JOIN public.rake_attributions ra
        ON ra.hand_id = f.hand_id AND ra.player_id = f.user_id
     WHERE coalesce(ra.club_id, f.club_id) = p_club_id
  ), added AS MATERIALIZED (
    SELECT uid, sum(net) AS net FROM amounts GROUP BY uid
  )
  SELECT w.uid, coalesce(d.net, 0) + coalesce(a.net, 0)
    FROM wanted w
    LEFT JOIN daily d ON d.uid = w.uid
    LEFT JOIN added a ON a.uid = w.uid;
$cash_window$;

REVOKE ALL ON FUNCTION public.ca_club_members_cash_window(uuid, uuid[], date, date)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.ca_club_member_chicago_today_cash
-- @probe-for: public.ca_club_member_chicago_cash
-- @probe-for: public.ca_club_members_cash_window
DO $probe$
DECLARE
  v_zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_today numeric;
  v_range numeric;
  v_batch numeric;
BEGIN
  v_today := public.ca_club_member_chicago_today_cash(v_zero, v_zero, timestamptz '2026-11-19 18:00:00Z');
  IF v_today IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe ca_club_member_chicago_today_cash returned %', v_today;
  END IF;
  v_range := public.ca_club_member_chicago_cash(v_zero, v_zero, DATE '2026-11-19', DATE '2026-11-20');
  IF v_range IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe ca_club_member_chicago_cash returned %', v_range;
  END IF;
  SELECT cash_net INTO v_batch
    FROM public.ca_club_members_cash_window(v_zero, ARRAY[v_zero], DATE '2026-11-19', DATE '2026-11-20');
  IF v_batch IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe ca_club_members_cash_window returned %', v_batch;
  END IF;
END $probe$;

COMMIT;
