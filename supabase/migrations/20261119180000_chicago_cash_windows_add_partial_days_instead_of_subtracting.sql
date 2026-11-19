-- Chicago calendar cash windows for Roster and Member Win/Loss.
-- Purely additive disjoint interval decomposition:
--   - ca_club_member_chicago_today_cash: a single Chicago day contains zero
--     complete UTC days, so read [chicago_start, chicago_end) directly from
--     retained timestamped ca_hand_facts.
--   - ca_club_member_chicago_cash & ca_club_members_cash_window: complete
--     interior UTC days (p_from+1 .. p_to-1) come from member_record_daily_facts
--     / ca_stats_member_record_daily_facts; the start [chicago_start, (p_from+1)
--     00:00 UTC) and end [p_to 00:00 UTC, chicago_end) partial-day slices are
--     added directly from retained timestamped ca_hand_facts.
--
-- Previously, all three functions read UTC buckets covering [p_from, p_to] and
-- subtracted raw ca_hand_facts in the two edge slices. When a hand's post-commit
-- rake_attributions arrived after ca_hand_facts insert, fn_member_record_fact_club(f)
-- resolved to the player's club at read time even though the UTC daily rollup had
-- incremented the table's union club, producing phantom positive winnings (e.g.
-- +$5.00 on a day with 0 hands in the club).
--
-- Read-only reporting functions only. No table DDL, financial writes, or engine dependency.
-- @live-proof: position('Purely additive single Chicago day' IN pg_get_functiondef('public.ca_club_member_chicago_today_cash(uuid,uuid,timestamp with time zone)'::regprocedure)) > 0
-- @live-proof: position('Purely additive partial-day slices' IN pg_get_functiondef('public.ca_club_member_chicago_cash(uuid,uuid,date,date)'::regprocedure)) > 0
-- @live-proof: position('Purely additive partial-day slices' IN pg_get_functiondef('public.ca_club_members_cash_window(uuid,uuid[],date,date)'::regprocedure)) > 0
-- @live-proof: NOT has_function_privilege('authenticated', 'public.ca_club_member_chicago_today_cash(uuid,uuid,timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.ca_club_member_chicago_cash(uuid,uuid,date,date)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.ca_club_members_cash_window(uuid,uuid[],date,date)', 'EXECUTE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.ca_club_member_chicago_today_cash(uuid,uuid,timestamp with time zone)'::regprocedure))
     IS DISTINCT FROM '06a865d12318b40786f3279090a5004e' THEN
    RAISE EXCEPTION 'ca_club_member_chicago_today_cash preimage changed before additive fix';
  END IF;
  IF md5(pg_get_functiondef('public.ca_club_member_chicago_cash(uuid,uuid,date,date)'::regprocedure))
     IS DISTINCT FROM '82abafd6136f114a449c2aae9dc1dae6' THEN
    RAISE EXCEPTION 'ca_club_member_chicago_cash preimage changed before additive fix';
  END IF;
  IF md5(pg_get_functiondef('public.ca_club_members_cash_window(uuid,uuid[],date,date)'::regprocedure))
     IS DISTINCT FROM '8844cabc5f0de8bacba3dc0116988e0e' THEN
    RAISE EXCEPTION 'ca_club_members_cash_window preimage changed before additive fix';
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
  -- Purely additive single Chicago day from retained timestamped facts.
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
      p_from::timestamp AT TIME ZONE 'America/Chicago' AS chicago_start,
      (p_from + 1)::timestamp AT TIME ZONE 'UTC' AS u1,
      p_to::timestamp AT TIME ZONE 'UTC' AS u2,
      p_to::timestamp AT TIME ZONE 'America/Chicago' AS chicago_end
  )
  -- Purely additive partial-day slices: complete interior UTC days come from
  -- ca_member_record_daily_facts; start and end partial-day slices are added
  -- directly from retained timestamped ca_hand_facts.
  SELECT CASE WHEN p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN 0::numeric ELSE
         coalesce((
           SELECT sum(d.net)
             FROM public.ca_member_record_daily_facts(p_club_id, p_user_id, p_from + 1, p_to - 1) d
            WHERE p_to > p_from + 1
              AND NOT d.is_mtt
         ), 0)
       + coalesce((
           SELECT sum(f.net)
             FROM LATERAL (VALUES (b.chicago_start, b.u1), (b.u2, b.chicago_end)) slice(start_at, end_at)
             JOIN public.ca_hand_facts f
               ON f.user_id = p_user_id
              AND f.tournament_id IS NULL
              AND f.played_at >= slice.start_at
              AND f.played_at < slice.end_at
            WHERE public.fn_member_record_fact_club(f) = p_club_id
              AND public.fn_ca_launch_accounting_accepts(p_club_id, f.played_at)
         ), 0) END
    FROM bounds b;
$function$;

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
AS $function$
 WITH b AS MATERIALIZED (
  SELECT public.fn_ca_launch_accounting_cutoff('club',p_club_id) cutoff,
   (p_from IS NULL AND p_to IS NULL) overall,
   (p_from IS NULL AND p_to IS NULL) OR
    (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to>p_from) valid,
   p_from::timestamp AT TIME ZONE 'America/Chicago' cs,
   (p_from+1)::timestamp AT TIME ZONE 'UTC' u1,
   p_to::timestamp AT TIME ZONE 'UTC' u2,
   p_to::timestamp AT TIME ZONE 'America/Chicago' ce
 ), wanted AS MATERIALIZED (
  SELECT DISTINCT uid FROM unnest(coalesce(p_user_ids,ARRAY[]::uuid[])) uid WHERE uid IS NOT NULL
 ), daily AS MATERIALIZED (
  SELECT f.user_id uid,sum(f.net) net
  FROM wanted w JOIN public.ca_stats_member_record_daily_facts f ON f.user_id=w.uid CROSS JOIN b
  WHERE b.valid AND f.club_id=p_club_id AND NOT f.is_mtt
   AND f.accounting_cutoff IS NOT DISTINCT FROM b.cutoff
   AND (b.overall OR (p_to>p_from+1 AND f.played_on>=p_from+1 AND f.played_on<=p_to-1))
  GROUP BY f.user_id
 ), slices AS MATERIALIZED (
  -- Purely additive partial-day slices from retained timestamped facts.
  SELECT f.user_id,f.table_id,f.hand_id,f.played_at,f.club_id,f.net
  FROM wanted w CROSS JOIN b
  CROSS JOIN LATERAL(VALUES(b.cs,b.u1),(b.u2,b.ce)) slice(start_at,end_at)
  JOIN public.ca_hand_facts f ON f.user_id=w.uid
   AND f.played_at>=slice.start_at AND f.played_at<slice.end_at
  WHERE b.valid AND NOT b.overall AND f.tournament_id IS NULL
   AND CASE WHEN b.cutoff IS NULL THEN true ELSE
    f.played_at IS NOT NULL AND isfinite(f.played_at) AND f.played_at>=b.cutoff END
 ), occupancies AS MATERIALIZED (
  SELECT DISTINCT table_id,user_id FROM slices
 ), funding AS MATERIALIZED (
  SELECT DISTINCT ON(x.table_id,x.account_entity_id,x.seat_joined_at)
   x.table_id,x.account_entity_id,x.seat_joined_at,x.funding_club_id
  FROM public.cash_participant_funding_receipts x JOIN occupancies o
   ON o.table_id=x.table_id AND o.user_id=x.account_entity_id
  WHERE x.operation_kind='buyin'
  ORDER BY x.table_id,x.account_entity_id,x.seat_joined_at,x.recorded_at DESC,x.id DESC
 ), timeline AS MATERIALIZED (
  SELECT *,lead(seat_joined_at) OVER(
   PARTITION BY table_id,account_entity_id ORDER BY seat_joined_at) next_joined_at FROM funding
 ), resolved AS MATERIALIZED (
  SELECT f.*,x.funding_club_id FROM slices f
  LEFT JOIN timeline x ON x.table_id=f.table_id AND x.account_entity_id=f.user_id
   AND x.seat_joined_at<=f.played_at AND (x.next_joined_at IS NULL OR f.played_at<x.next_joined_at)
 ), unfunded AS MATERIALIZED (
  SELECT * FROM resolved WHERE funding_club_id IS NULL
 ), amounts AS (
  SELECT f.user_id uid,f.net FROM resolved f WHERE f.funding_club_id=p_club_id
  UNION ALL
  SELECT f.user_id uid,f.net FROM unfunded f
  LEFT JOIN public.rake_attributions ra ON ra.hand_id=f.hand_id AND ra.player_id=f.user_id
  WHERE coalesce(ra.club_id,f.club_id)=p_club_id
 ), added AS MATERIALIZED (
  SELECT uid,sum(net) net FROM amounts GROUP BY uid
 )
 SELECT w.uid,coalesce(d.net,0)+coalesce(a.net,0)
 FROM wanted w LEFT JOIN daily d ON d.uid=w.uid LEFT JOIN added a ON a.uid=w.uid;
$function$;

REVOKE ALL ON FUNCTION public.ca_club_member_chicago_today_cash(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_club_member_chicago_cash(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ca_club_members_cash_window(uuid, uuid[], date, date) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
