-- 20261107085333_club_data_filters_attribution_keys_before_numeric_rows
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 08:53:33 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- Filter the existing reporting projection using indexed identity keys before
-- fetching fee/winnings heap tuples. Kings excluded 272081 of 272351 historical
-- rows only after fetching them; the snapshot exceeded its unchanged 8s budget.
-- Exact full-screen read-only query counterfactual: current 1609ms, previous
-- 1615ms, including live tournaments and the daily newest-game walk.
-- Other scopes retain the existing view and exact-game predicate pushdown.
-- Projection policy and raw facts are unchanged. Source club is retained in
-- the raw primary key even when reporting assigns a different club.
-- @live-proof: position('fn_ca_club_data_fact_window' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $guard$
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') THEN
   RAISE EXCEPTION 'Club Data window reader requires maintained installer';
 END IF;
 IF md5(pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) <> '157cd46995a6f1b1248b8240a7d08b78'
 OR md5(pg_get_viewdef('public.ca_stats_club_data_fact_ct'::regclass,true)) <> 'a95cc5a258f96fbb5b306bcf823314b0'
 OR to_regprocedure('public.fn_ca_club_data_fact_window(uuid[],date,date)') IS NOT NULL THEN
   RAISE EXCEPTION 'Club Data window reader preimage changed';
 END IF;
END $guard$;

CREATE FUNCTION public.fn_ca_club_data_fact_window(p_clubs uuid[],p_from date,p_through date)
RETURNS SETOF public.ca_stats_club_data_fact_ct
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $reader$
WITH keys AS MATERIALIZED (SELECT r.club_id source_club_id, r.club_id, r.stat_date, r.game_id, r.user_id, r.src FROM public.ca_club_data_fact_ct r
  WHERE r.club_id=ANY(p_clubs) AND r.stat_date BETWEEN p_from AND p_through AND (r.club_id <> 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR NOT (EXISTS ( SELECT 1
           FROM public.profiles p
          WHERE p.id = r.user_id AND p.is_horse IS TRUE))) AND (r.club_id <> '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid OR NOT (EXISTS ( SELECT 1
           FROM public.ca_horse_club_assignments x
          WHERE x.horse_id = r.user_id AND x.club_id = 'a0000000-0000-0000-0000-000000000001'::uuid))) AND (r.club_id <> 'a0000000-0000-0000-0000-000000000001'::uuid OR NOT (EXISTS ( SELECT 1
           FROM public.ca_horse_club_assignments x
          WHERE x.horse_id = r.user_id AND x.club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid))) AND NOT (EXISTS ( SELECT 1
           FROM public.ca_horse_fleet_register rr
          WHERE rr.horse_id = r.user_id AND rr.retired_at IS NOT NULL))
UNION ALL
 SELECT r.club_id source_club_id, a.club_id, r.stat_date, r.game_id, r.user_id, r.src FROM public.ca_club_data_fact_ct r
     JOIN public.ca_horse_club_assignments a ON a.horse_id = r.user_id AND a.club_id <> r.club_id
  WHERE a.club_id=ANY(p_clubs) AND r.stat_date BETWEEN p_from AND p_through AND r.club_id = ANY (ARRAY['a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'a0000000-0000-0000-0000-000000000001'::uuid])) SELECT k.club_id,k.stat_date,r.kind,k.game_id,k.user_id,r.fee,r.buyins,r.cashouts,r.winnings,r.last_at,k.src FROM keys k JOIN LATERAL (SELECT r.kind,r.fee,r.buyins,r.cashouts,r.winnings,r.last_at FROM public.ca_club_data_fact_ct r WHERE (r.club_id,r.stat_date,r.game_id,r.user_id,r.src)=(k.source_club_id,k.stat_date,k.game_id,k.user_id,k.src) OFFSET 0) r ON true;
$reader$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_fact_window(uuid[],date,date) FROM PUBLIC,anon,authenticated,service_role;

DO $edit$
DECLARE
 definition text := pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure);
 old text := 'public.ca_stats_club_data_fact_ct ';
 replacement text := $replacement$(
   SELECT * FROM public.fn_ca_club_data_fact_window(public.fn_ca_club_data_clubs(p_club_id),v_start,v_end)
    WHERE p_club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
   UNION ALL
   SELECT * FROM public.ca_stats_club_data_fact_ct
    WHERE p_club_id<>'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid
 ) $replacement$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 8 THEN
   RAISE EXCEPTION 'Club Data window reader sites changed';
 END IF;
 EXECUTE replace(definition,old,replacement);
END $edit$;
COMMIT;

