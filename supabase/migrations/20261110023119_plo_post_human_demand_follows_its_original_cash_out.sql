-- Reserved by scripts/new-migration.mjs.
-- Owner: after the last human leaves, 20% of 1/2 PLO games continue with
-- later individually paced Horse arrivals; 80% follow normal session exits.
-- An immutable, actual occupancy cash-out chooses the branch once. No timer,
-- new writer, money mutation, population repair or per-tick random roll.
-- The last human's old seat row can be deleted on chair reuse; it is NOT the
-- durable decision record. The receipt itself remains immutable.
-- Its existing PK cannot serve a per-game lookup, so build the one required
-- read index through the maintained concurrent preamble, never blocking play.
-- @live-proof: md5(pg_get_functiondef('public.fn_plo_lightning_post_human_demand()'::regprocedure))='31cacfcfee59642e06db252773c997e2' AND md5(pg_get_functiondef('public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure))='d80b45b3c5e16a074fe4d83a8f64416b' AND md5(pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure))='d40f49118568a57cfc1a60179188df1c' AND NOT has_function_privilege('authenticated','public.fn_plo_lightning_post_human_demand()','EXECUTE') AND has_function_privilege('service_role','public.fn_plo_lightning_post_human_demand()','EXECUTE')
CREATE INDEX CONCURRENTLY IF NOT EXISTS seat_cashout_receipts_table_exit
  ON public.seat_cashout_receipts (table_id, created_at DESC, occupancy_id DESC);
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $index$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.seat_cashout_receipts_table_exit'::regclass AND indisvalid AND pg_get_indexdef(indexrelid)='CREATE INDEX seat_cashout_receipts_table_exit ON public.seat_cashout_receipts USING btree (table_id, created_at DESC, occupancy_id DESC)')
 THEN RAISE EXCEPTION 'PLO cash-out lookup index is not valid'; END IF;
END $index$;

DO $reader$ BEGIN
 IF to_regprocedure('public.fn_plo_lightning_post_human_demand()') IS NOT NULL AND
   md5(pg_get_functiondef(to_regprocedure('public.fn_plo_lightning_post_human_demand()')))<>'31cacfcfee59642e06db252773c997e2'
 THEN RAISE EXCEPTION 'PLO continuation reader changed'; END IF;
END $reader$;

CREATE OR REPLACE FUNCTION public.fn_plo_lightning_post_human_demand()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
 WITH game AS (
   SELECT id FROM public.cash_games
   WHERE id='c79d8ec2-2281-411d-b4e1-42b5610849e2'::uuid
     AND enabled AND lightning_enabled AND variant='plo4' AND sb=1 AND bb=2 AND handedness=6
     AND ruleset_snapshot#>>'{lightning,on_threshold}'='10'
     AND ruleset_snapshot#>>'{lightning,always_on}'='false'
 ), occupied AS (
   SELECT s.user_id,s.stack,p.is_horse
   FROM game g JOIN public.tables t ON t.cluster_id=g.id
   JOIN public.table_seats s ON s.table_id=t.id
   LEFT JOIN public.profiles p ON p.id=s.user_id
   WHERE NOT coalesce(t.is_deleted,false) AND coalesce(t.lifecycle,'')<>'closed'
     AND s.left_at IS NULL
 ), last_exit AS (
   SELECT r.occupancy_id
   FROM game g JOIN public.tables t ON t.cluster_id=g.id
   JOIN public.seat_cashout_receipts r ON r.table_id=t.id
   JOIN public.profiles p ON p.id=r.user_id AND p.is_horse IS FALSE
   WHERE r.receipt @> jsonb_build_object('ok',true,'tournament_table',false,
     'user_id',r.user_id,'table_id',r.table_id,'seat_number',r.seat_number,
     'occupancy_id',r.occupancy_id,'idempotency_key','cashout:occupancy:'||r.occupancy_id::text)
     AND (r.receipt @> '{"credited":true}'::jsonb OR r.receipt @> '{"credited":false,"stack":0}'::jsonb)
   ORDER BY r.created_at DESC,r.occupancy_id DESC LIMIT 1
 ), choice AS (
   SELECT occupancy_id,
     (('x'||substr(md5(occupancy_id::text),1,8))::bit(32)::bigint % 5)=0 AS keep_playing
   FROM last_exit
 ), active AS (
   -- Paid all-in/rebuy chairs remain occupied while their chips are committed.
   -- A sit-out, all-in or departing human has not actually cashed out yet.
   -- An unknown profile is never treated as an absent human.
   SELECT EXISTS(SELECT 1 FROM occupied WHERE is_horse IS NOT TRUE) AS human_present,
          EXISTS(SELECT 1 FROM occupied) AS occupied
 )
 SELECT jsonb_build_object('game_id','c79d8ec2-2281-411d-b4e1-42b5610849e2',
   'event_id',(SELECT occupancy_id FROM choice),
   'continues',a.occupied AND NOT a.human_present AND coalesce((SELECT keep_playing FROM choice),false),
   'wind_down',a.occupied AND NOT a.human_present AND coalesce((SELECT NOT keep_playing FROM choice),false))
 FROM active a;
$function$;
REVOKE ALL ON FUNCTION public.fn_plo_lightning_post_human_demand() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_plo_lightning_post_human_demand() TO service_role;

DO $admission$
DECLARE s text:=pg_get_functiondef('public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure); n text; before_meta jsonb;
BEGIN
 IF md5(s)='d80b45b3c5e16a074fe4d83a8f64416b' THEN RETURN; END IF;
 SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile,'parallel',proparallel) INTO before_meta FROM pg_proc WHERE oid='public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure;
 IF md5(s)<>'ebda4c17f811ab39b9bffbcdf1d2a84d' THEN RAISE EXCEPTION 'PLO admission predecessor changed'; END IF;
 n:=replace(s,'IF v_humans=0 OR v_population>=10 THEN',
   'IF (v_humans=0 AND NOT (public.fn_plo_lightning_post_human_demand()->>''continues'')::boolean) OR v_population>=10 THEN');
 IF n=s THEN RAISE EXCEPTION 'PLO admission demand decision absent'; END IF;
 IF md5(n)<>'d80b45b3c5e16a074fe4d83a8f64416b' THEN RAISE EXCEPTION 'PLO admission postimage differs'; END IF;
 EXECUTE n;
 IF before_meta IS DISTINCT FROM (SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile,'parallel',proparallel) FROM pg_proc WHERE oid='public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure)
 THEN RAISE EXCEPTION 'PLO admission metadata changed'; END IF;
END $admission$;
DO $opening$
DECLARE s text:=pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure); n text; before_meta jsonb;
BEGIN
 IF md5(s)='d40f49118568a57cfc1a60179188df1c' THEN RETURN; END IF;
 SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile,'parallel',proparallel) INTO before_meta FROM pg_proc WHERE oid='public.fn_cash_cluster_tick(uuid,integer)'::regprocedure;
 IF md5(s)<>'55a0d08c68a0dd5afe3fedd4f1d58e12' THEN RAISE EXCEPTION 'PLO startup feeder prerequisite absent'; END IF;
 n:=replace(s,E'AND coalesce(s.leave_pending, false) = false AND p.is_horse IS NOT TRUE\n      );',
   E'AND coalesce(s.leave_pending, false) = false AND p.is_horse IS NOT TRUE\n      ) OR (public.fn_cash_cluster_live_eligible(g.id) BETWEEN 6 AND 9\n        AND (public.fn_plo_lightning_post_human_demand()->>''continues'')::boolean);');
 IF n=s THEN RAISE EXCEPTION 'PLO continuation feeder decision absent'; END IF;
 IF md5(n)<>'d40f49118568a57cfc1a60179188df1c' THEN RAISE EXCEPTION 'PLO opening postimage differs'; END IF;
 EXECUTE n;
 IF before_meta IS DISTINCT FROM (SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile,'parallel',proparallel) FROM pg_proc WHERE oid='public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)
 THEN RAISE EXCEPTION 'PLO opening metadata changed'; END IF;
END $opening$;
COMMIT;
