-- Chicago calendar windows for Member Management and Player Statistics.
-- Purely additive partial-day decomposition: complete interior UTC days come
-- from member_record_daily_facts; the start [cs, (p_from+1) 00:00 UTC) and
-- end [(p_to+1) 00:00 UTC, ce) partial-day slices are added directly from
-- retained timestamped ca_hand_facts.
--
-- Previously, ca_member_record_chicago_facts read UTC buckets for [p_from, p_to+1]
-- and subtracted raw ca_hand_facts in the two edge slices. When a hand's
-- post-commit rake_attributions arrived after ca_hand_facts insert,
-- fn_member_record_fact_club(f) resolved to the player's club at read time
-- even though the UTC daily rollup had incremented the table's union club,
-- producing negative hand counts (e.g. hands = -1) and phantom winnings that
-- caused ClubRosterService.getMemberDetail to reject the response as incomplete
-- ("The Member Ledger Did Not Respond").
--
-- Read-only reporting function only. No table DDL, financial writes, or engine dependency.
-- @live-proof: position('Purely additive partial-day slices' IN pg_get_functiondef('public.ca_member_record_chicago_facts(uuid,uuid,date,date)'::regprocedure)) > 0
-- @live-proof: NOT has_function_privilege('authenticated', 'public.ca_member_record_chicago_facts(uuid,uuid,date,date)', 'EXECUTE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.ca_member_record_chicago_facts(uuid,uuid,date,date)'::regprocedure))
     IS DISTINCT FROM '6dfdf908380225008c1742e29ef0e8d7' THEN
    RAISE EXCEPTION 'ca_member_record_chicago_facts preimage changed before additive fix';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ca_member_record_chicago_facts(
  p_club uuid,
  p_user uuid,
  p_from date,
  p_to date
)
RETURNS SETOF public.club_member_daily_facts
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $chicago$
 WITH b AS (
  SELECT
    p_from::timestamp AT TIME ZONE 'America/Chicago' AS cs,
    (p_from + 1)::timestamp AT TIME ZONE 'UTC' AS u1,
    (p_to + 1)::timestamp AT TIME ZONE 'UTC' AS u2,
    (p_to + 1)::timestamp AT TIME ZONE 'America/Chicago' AS ce
 ), rows AS (
  SELECT * FROM public.ca_member_record_daily_facts(
    p_club,
    p_user,
    CASE WHEN p_from IS NULL THEN NULL ELSE p_from + 1 END,
    p_to
  )
  WHERE (p_from IS NULL OR p_to IS NULL OR p_from < p_to)
  UNION ALL
  -- Purely additive partial-day slices from retained timestamped facts.
  SELECT p_club, f.user_id, (f.played_at AT TIME ZONE 'UTC')::date,
    lower(f.game_variant), f.tournament_id IS NOT NULL,
    1,
    CASE WHEN f.net > 0 THEN 1 ELSE 0 END,
    CASE WHEN f.vpip THEN 1 ELSE 0 END,
    CASE WHEN f.pfr THEN 1 ELSE 0 END,
    CASE WHEN f.three_bet THEN 1 ELSE 0 END,
    CASE WHEN f.faced_three_bet THEN 1 ELSE 0 END,
    CASE WHEN f.folded_to_three_bet THEN 1 ELSE 0 END,
    CASE WHEN f.cbet_flop THEN 1 ELSE 0 END,
    CASE WHEN f.had_cbet_flop_opp THEN 1 ELSE 0 END,
    coalesce(f.rake_paid, 0),
    coalesce(f.net, 0)
  FROM b
  CROSS JOIN LATERAL (VALUES (b.cs, b.u1), (b.u2, b.ce)) edge(start_at, end_at)
  JOIN public.ca_hand_facts f
    ON f.user_id = p_user
   AND f.played_at >= edge.start_at
   AND f.played_at < edge.end_at
  WHERE (p_from IS NULL OR p_to IS NULL OR p_from <= p_to)
    AND edge.start_at IS NOT NULL
    AND edge.end_at IS NOT NULL
    AND public.fn_member_record_fact_club(f) = p_club
    AND public.fn_ca_launch_accounting_accepts(p_club, f.played_at)
 )
 SELECT club_id, user_id, played_on, game_variant, is_mtt,
   sum(hands)::bigint, sum(wins)::bigint, sum(vpip_hands)::bigint, sum(pfr_hands)::bigint,
   sum(tb_hands)::bigint, sum(faced_tb)::bigint, sum(folded_tb)::bigint,
   sum(cb_hands)::bigint, sum(cb_opps)::bigint, sum(fees), sum(net)
 FROM rows
 GROUP BY club_id, user_id, played_on, game_variant, is_mtt;
$chicago$;

REVOKE ALL ON FUNCTION public.ca_member_record_chicago_facts(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
