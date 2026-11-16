-- Owner November 16: paced cash-only capacity; human-started games may expand.
-- No tournament rule, wallet kernel, seat deletion, scheduler or hot-table DDL.
-- Existing owning engines close only after their current hand and presentation.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

CREATE FUNCTION public.fn_cash_hourly_table_range(p_at timestamptz DEFAULT clock_timestamp())
RETURNS TABLE(local_hour integer,target_min integer,table_cap integer)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT h,lo[h+1],hi[h+1] FROM
 (SELECT extract(hour FROM p_at AT TIME ZONE 'America/Chicago')::integer h,
 ARRAY[18,15,15,12,7,5,5,7,9,10,12,13,15,15,15,15,15,18,22,25,30,30,30,25] lo,
 ARRAY[25,18,18,15,10,8,7,9,11,13,16,17,17,18,18,18,20,22,30,33,40,40,40,29] hi) q;
$fn$;

-- A single occupied chair reserves capacity, even waiting/sitting out. Unknown
-- identity protects a table as human. Empty lobby doors consume no game slot.
CREATE FUNCTION public.fn_cash_hourly_table_census()
RETURNS TABLE(table_id uuid,occupied bigint,humans bigint,opened_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 SELECT t.id,count(*),greatest(count(*) FILTER(WHERE p.is_horse IS DISTINCT FROM true),
 CASE WHEN EXISTS(SELECT 1 FROM public.cash_games g WHERE g.id=t.cluster_id AND g.cluster_mode='lightning')
 AND EXISTS(SELECT 1 FROM public.tables a JOIN public.table_seats b ON b.table_id=a.id
 LEFT JOIN public.profiles hp ON hp.id=b.user_id
 WHERE a.cluster_id=t.cluster_id AND b.left_at IS NULL AND hp.is_horse IS DISTINCT FROM true)
 THEN 1 ELSE 0 END),
 coalesce(t.live_at,t.opened_at,t.created_at)
 FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id
 LEFT JOIN public.profiles p ON p.id=s.user_id
 WHERE s.left_at IS NULL AND t.tournament_id IS NULL AND NOT coalesce(t.is_spins,false)
 AND NOT coalesce(t.is_template,false) AND NOT coalesce(t.is_deleted,false)
 AND t.status IN('waiting','running') GROUP BY t.id;
$fn$;

CREATE FUNCTION public.fn_cash_hourly_table_excess(p_table_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_census()),
 budget AS(SELECT greatest(0,r.table_cap-(SELECT count(*) FROM floor WHERE humans>0)) n
 FROM public.fn_cash_hourly_table_range() r),
 ranked AS(SELECT table_id,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n
 FROM floor WHERE humans=0)
 SELECT EXISTS(SELECT 1 FROM ranked,budget WHERE table_id=p_table_id AND ranked.n>budget.n);
$fn$;

-- These records are admission state, not a repair queue. All writes happen in
-- the original seating/closing transaction and roll back with a refusal.
CREATE TABLE public.cash_hourly_table_pacing(
 scope text PRIMARY KEY,enabled_instance_id text,next_open_at timestamptz NOT NULL DEFAULT '-infinity',
 next_close_at timestamptz NOT NULL DEFAULT '-infinity');
INSERT INTO public.cash_hourly_table_pacing(scope) VALUES('floor');
CREATE TABLE public.cash_hourly_table_starts(
 table_id uuid PRIMARY KEY,started_at timestamptz NOT NULL,
 next_horse_at timestamptz NOT NULL);
CREATE TABLE public.cash_hourly_table_closures(
 operation_id uuid PRIMARY KEY,table_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),receipt jsonb NOT NULL);
ALTER TABLE public.cash_hourly_table_pacing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_hourly_table_starts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_hourly_table_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_hourly_table_pacing,public.cash_hourly_table_starts,
 public.cash_hourly_table_closures FROM PUBLIC,anon,authenticated,service_role;

-- Migration-first and rollback compatibility: only a serving leader that has
-- entered the new hand-boundary door activates this policy. An older rollback
-- leader never enters it, so cannot inherit a drain it cannot finish.
CREATE FUNCTION public.fn_cash_hourly_table_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing p JOIN public.engine_leader l
 ON l.id=true AND l.instance_id=p.enabled_instance_id WHERE p.scope='floor');
$fn$;

CREATE FUNCTION public.fn_cash_hourly_table_delay(p_table_id uuid)
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$
 SELECT make_interval(secs=>120+((hashtextextended(p_table_id::text,0)&2147483647)%121)::integer);
$fn$;

-- One game winds down at a time, 2-4 minutes apart. Keeping the newest excess
-- table as the candidate also lets Lightning stop replacing ITS settled hands
-- without interrupting another anchor or any human's shared Lightning pool.
CREATE FUNCTION public.fn_cash_hourly_table_drain_candidate()
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_census()),
 budget AS(SELECT greatest(0,r.table_cap-(SELECT count(*) FROM floor WHERE humans>0)) n
 FROM public.fn_cash_hourly_table_range() r),
 ranked AS(SELECT table_id,opened_at,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n
 FROM floor WHERE humans=0)
 SELECT table_id FROM ranked,budget
 WHERE ranked.n>budget.n AND public.fn_cash_hourly_table_enabled()
 AND NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing
 WHERE scope='floor' AND next_close_at>clock_timestamp())
 ORDER BY opened_at DESC NULLS FIRST,table_id DESC LIMIT 1;
$fn$;

CREATE FUNCTION public.fn_cash_hourly_table_admit(p_table_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE t public.tables%ROWTYPE; n integer; cap integer; human boolean; empty boolean;
 funded_move boolean; releases_source boolean;
 now_at timestamptz:=clock_timestamp(); pace public.cash_hourly_table_starts%ROWTYPE;
BEGIN
 SELECT * INTO t FROM public.tables WHERE id=p_table_id;
 IF NOT FOUND OR t.tournament_id IS NOT NULL OR coalesce(t.is_spins,false) THEN RETURN; END IF;
 IF NOT public.fn_cash_hourly_table_enabled() THEN RETURN; END IF;
 -- A first human seat and boundary close share this lock. Existing stack,
 -- settlement and departure updates bypass this function in the caller.
 SELECT * INTO t FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;
 IF t.status='closed' OR t.lifecycle='closed' THEN
  RAISE EXCEPTION 'cash_hourly_table_closed' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_horse) THEN RETURN; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)
 INTO empty;
 SELECT EXISTS(SELECT 1 FROM public.table_seats s LEFT JOIN public.profiles p ON p.id=s.user_id
 WHERE s.table_id=p_table_id AND s.left_at IS NULL AND p.is_horse IS DISTINCT FROM true) INTO human;
 -- Original funded must-moves change chairs, not player admission. Preserve
 -- occupied destinations and paired moves; only a genuinely new table uses
 -- the floor opening clock/cap. The executor inserts before releasing source.
 SELECT coalesce(public.fn_caller_is_engine(),false)
 AND current_setting('app.cash_seat_move',true)='on' AND t.cluster_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.table_seats s JOIN public.tables src ON src.id=s.table_id
 WHERE s.user_id=p_user_id AND s.left_at IS NULL AND src.id<>t.id
 AND src.cluster_id=t.cluster_id AND src.tournament_id IS NULL AND NOT coalesce(src.is_spins,false))
 INTO funded_move;
 IF funded_move AND NOT empty THEN RETURN; END IF;
 SELECT coalesce(funded_move,false) AND EXISTS(
 SELECT 1 FROM public.table_seats s JOIN public.tables src ON src.id=s.table_id
 WHERE s.user_id=p_user_id AND s.left_at IS NULL AND src.id<>t.id AND src.cluster_id=t.cluster_id
 AND NOT EXISTS(SELECT 1 FROM public.table_seats other WHERE other.table_id=src.id
 AND other.left_at IS NULL AND other.id<>s.id)) INTO releases_source;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0)) THEN
  RAISE EXCEPTION 'cash_hourly_table_capacity_busy' USING ERRCODE='55P03'; END IF;
 IF NOT human THEN
  SELECT table_cap INTO STRICT cap FROM public.fn_cash_hourly_table_range();
  SELECT count(*) INTO n FROM public.fn_cash_hourly_table_census();
  IF (empty AND n-CASE WHEN releases_source THEN 1 ELSE 0 END>=cap) OR (NOT empty AND public.fn_cash_hourly_table_excess(p_table_id)) THEN
   RAISE EXCEPTION 'cash_hourly_table_cap_reached:%',cap USING ERRCODE='42501'; END IF;
  IF empty THEN
   IF EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing WHERE scope='floor' AND next_open_at>now_at) THEN
    RAISE EXCEPTION 'cash_hourly_table_start_paced' USING ERRCODE='42501'; END IF;
   UPDATE public.cash_hourly_table_pacing SET next_open_at=now_at+public.fn_cash_hourly_table_delay(p_table_id)
    WHERE scope='floor';
  END IF;
 END IF;
 -- Every NEW game builds its Horse seats individually over 2-4 minute gaps.
 -- A human who starts an empty table grants only THAT table the cap exception.
 -- Once established, ordinary replenishment keeps its existing behavior.
 IF empty OR NOT EXISTS(SELECT 1 FROM public.table_seats s JOIN public.profiles p ON p.id=s.user_id
                        WHERE s.table_id=p_table_id AND s.left_at IS NULL AND p.is_horse) THEN
  INSERT INTO public.cash_hourly_table_starts(table_id,started_at,next_horse_at)
  VALUES(p_table_id,now_at,'-infinity') ON CONFLICT(table_id) DO NOTHING;
 END IF;
 SELECT * INTO pace FROM public.cash_hourly_table_starts WHERE table_id=p_table_id;
 IF FOUND THEN
  IF pace.next_horse_at>now_at THEN
   RAISE EXCEPTION 'cash_hourly_horse_arrival_paced' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL)+1>=t.max_players THEN
   DELETE FROM public.cash_hourly_table_starts WHERE table_id=p_table_id;
  ELSE
   UPDATE public.cash_hourly_table_starts SET next_horse_at=now_at+public.fn_cash_hourly_table_delay(p_table_id)
    WHERE table_id=p_table_id;
  END IF;
 END IF;
END;
$fn$;

-- Advisory single-read fleet projection. The original trigger rechecks every
-- purchase atomically; this projection avoids repeatedly buying refused seats.
CREATE FUNCTION public.fn_cash_hourly_table_admissions()
RETURNS TABLE(table_id uuid,allowed boolean,max_horses integer,starts_game boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
 WITH floor AS MATERIALIZED(SELECT * FROM public.fn_cash_hourly_table_census()),
 budget AS(SELECT table_cap cap,(SELECT count(*) FROM floor) occupied,
 greatest(0,table_cap-(SELECT count(*) FROM floor WHERE humans>0)) retained
 FROM public.fn_cash_hourly_table_range()),
 ranked AS(SELECT table_id,row_number() OVER(ORDER BY opened_at NULLS LAST,table_id) n FROM floor WHERE humans=0)
 SELECT t.id,
 (NOT public.fn_cash_hourly_table_enabled() OR ((coalesce(f.humans,0)>0 OR CASE WHEN f.table_id IS NULL THEN b.occupied<b.cap
  ELSE coalesce(r.n,0)<=b.retained END)
 AND (f.table_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing
  WHERE scope='floor' AND next_open_at>clock_timestamp()))
 AND (p.table_id IS NULL OR p.next_horse_at<=clock_timestamp()))),
 CASE WHEN p.table_id IS NOT NULL OR f.table_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.table_seats s JOIN public.profiles hp ON hp.id=s.user_id
  WHERE s.table_id=t.id AND s.left_at IS NULL AND hp.is_horse) THEN 1 ELSE t.max_players END,
 f.table_id IS NULL
 FROM public.tables t CROSS JOIN budget b LEFT JOIN floor f ON f.table_id=t.id
 LEFT JOIN ranked r ON r.table_id=t.id LEFT JOIN public.cash_hourly_table_starts p ON p.table_id=t.id
 WHERE t.tournament_id IS NULL AND NOT coalesce(t.is_spins,false)
 AND NOT coalesce(t.is_template,false) AND NOT coalesce(t.is_deleted,false)
 AND t.status IN('waiting','running') AND coalesce(t.lifecycle,'') NOT IN('closed','breaking');
$fn$;

DO $patch$
DECLARE src text; anchor text:='  -- Existing seats and settlement updates remain legal. Tournaments are unchanged.';
BEGIN
 SELECT pg_get_functiondef('public.fn_ca_horse_roster_seat_guard()'::regprocedure) INTO src;
 IF md5(src)<>'7953dd223dec21bd1845c28bf0742f64' OR
 (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'cash_hourly_roster_preimage_changed'; END IF;
 EXECUTE replace(src,anchor,
  '  PERFORM public.fn_cash_hourly_table_admit(NEW.table_id,NEW.user_id);'||chr(10)||anchor);
END $patch$;

CREATE FUNCTION public.fn_cash_hourly_table_close(
 p_table_id uuid,p_operation_id uuid,p_instance_id text,p_lease_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE t public.tables%ROWTYPE; s record; r jsonb; result jsonb; paid jsonb:='[]';
BEGIN
 IF NOT coalesce(public.fn_caller_is_engine(),false) THEN
  RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'cash_hourly_operation_required'; END IF;
 -- Join a possibly still-running original request BEFORE reading its result.
 -- This wait owns no financial/table lock and cannot let an unknown original
 -- be mistaken for a new within-cap skip after the clock or floor changed.
 PERFORM pg_advisory_xact_lock(hashtextextended('cash_hourly_operation:'||p_operation_id::text,0));
 SELECT receipt INTO result FROM public.cash_hourly_table_closures
 WHERE operation_id=p_operation_id AND table_id=p_table_id;
 IF FOUND THEN RETURN result; END IF;
 IF EXISTS(SELECT 1 FROM public.cash_hourly_table_closures WHERE operation_id=p_operation_id) THEN
  RAISE EXCEPTION 'cash_hourly_operation_scope_mismatch'; END IF;
 SELECT * INTO t FROM public.tables WHERE id=p_table_id;
 IF NOT FOUND OR t.tournament_id IS NOT NULL OR coalesce(t.is_spins,false) THEN
  RETURN jsonb_build_object('closed',false,'reason','not_cash'); END IF;
 IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('closed',false,'reason','frozen'); END IF;
 PERFORM 1 FROM public.engine_table_leases WHERE table_id=p_table_id
  AND instance_id=p_instance_id AND lease_generation=p_lease_generation FOR SHARE NOWAIT;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'cash_hourly_engine_lease_changed' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.engine_leader WHERE id=true AND instance_id=p_instance_id) THEN
  RETURN jsonb_build_object('closed',false,'reason','not_serving_leader'); END IF;
 IF NOT public.fn_cash_hourly_table_enabled() THEN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0)) THEN
   RAISE EXCEPTION 'cash_hourly_table_capacity_busy' USING ERRCODE='55P03'; END IF;
  UPDATE public.cash_hourly_table_pacing SET enabled_instance_id=p_instance_id,
   next_open_at=greatest(next_open_at,clock_timestamp()+interval '2 minutes') WHERE scope='floor';
  -- A first chair adopted during cold boot is still a gradually assembling
  -- game. It must not receive an instant ring on the first active fleet pass.
  INSERT INTO public.cash_hourly_table_starts(table_id,started_at,next_horse_at)
  SELECT table_id,clock_timestamp(),clock_timestamp()+public.fn_cash_hourly_table_delay(table_id)
  FROM public.fn_cash_hourly_table_census() WHERE occupied=1 AND humans=0
  ON CONFLICT(table_id) DO NOTHING;
 END IF;
 IF public.fn_cash_hourly_table_drain_candidate() IS DISTINCT FROM p_table_id THEN
  RETURN jsonb_build_object('closed',false,'reason','within_cap_or_human'); END IF;
 -- Preserve original user-lock -> table -> seat ordering; never queue behind
 -- another transaction while holding the global capacity key.
 FOR s IN SELECT user_id FROM public.table_seats WHERE table_id=p_table_id AND left_at IS NULL ORDER BY user_id LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('table_cap:'||s.user_id::text,0)) THEN
   RAISE EXCEPTION 'cash_hourly_departure_busy' USING ERRCODE='55P03'; END IF;
 END LOOP;
 PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE NOWAIT;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('cash_hourly_table_capacity',0)) THEN
  RAISE EXCEPTION 'cash_hourly_table_capacity_busy' USING ERRCODE='55P03'; END IF;
 IF public.fn_cash_hourly_table_drain_candidate() IS DISTINCT FROM p_table_id THEN
  RETURN jsonb_build_object('closed',false,'reason','within_cap_or_human'); END IF;
 IF EXISTS(SELECT 1 FROM public.cash_hourly_table_pacing WHERE scope='floor' AND next_close_at>clock_timestamp()) THEN
  RETURN jsonb_build_object('closed',false,'reason','closure_paced'); END IF;
 FOR s IN SELECT user_id,seat_number,occupancy_id FROM public.table_seats
 WHERE table_id=p_table_id AND left_at IS NULL ORDER BY user_id FOR UPDATE LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended('table_cap:'||s.user_id::text,0)) THEN
   RAISE EXCEPTION 'cash_hourly_departure_busy' USING ERRCODE='55P03'; END IF;
  -- Original occupancy-bound engine door owns settlement, wallet, ledger and
  -- replay. Any live Lightning hand/financial refusal rolls back ALL exits.
  r:=public.fn_cashout_seat_occupancy(s.user_id,p_table_id,s.seat_number,s.occupancy_id,'forced');
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'occupancy_id' IS DISTINCT FROM s.occupancy_id::text THEN
   RAISE EXCEPTION 'cash_hourly_departure_unconfirmed'; END IF;
  paid:=paid||jsonb_build_array(r);
 END LOOP;
 UPDATE public.tables SET status='closed',lifecycle='closed',current_players=0,updated_at=clock_timestamp()
 WHERE id=p_table_id;
 UPDATE public.cash_hourly_table_pacing SET next_close_at=clock_timestamp()+public.fn_cash_hourly_table_delay(p_table_id)
 WHERE scope='floor';
 result:=jsonb_build_object('closed',true,'table_id',p_table_id,'operation_id',p_operation_id,
 'departures',paid,'policy',(SELECT to_jsonb(policy_row) FROM public.fn_cash_hourly_table_range() policy_row));
 INSERT INTO public.cash_hourly_table_closures(operation_id,table_id,receipt) VALUES(p_operation_id,p_table_id,result);
 RETURN result;
END;
$fn$;

-- The original Lightning matcher holds only the selected excess anchor's
-- NEXT hand. IN_HAND remains earlier in the reason chain, so a live hand is
-- never cancelled. Human pools are protected by the shared-pool census.
DO $patch$
DECLARE src text; patched text; a text;
BEGIN
 SELECT pg_get_functiondef('public.fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)'::regprocedure) INTO src;
 IF md5(src)<>'9f7fa16f2ee2be89621a309bc9914732' THEN
  RAISE EXCEPTION 'cash_hourly_lightning_preimage_changed'; END IF;
 patched:=replace(src,'public.fn_platform_frozen() AS platform_frozen,',
  'public.fn_platform_frozen() AS platform_frozen, public.fn_cash_hourly_table_drain_candidate() AS hourly_drain_table_id,');
 patched:=replace(patched,'g.restrictions_enforced,','g.restrictions_enforced, g.hourly_drain_table_id,');
 patched:=replace(patched,'ts.id AS seat_id,','ts.id AS seat_id, tb.id AS anchor_table_id,');
 a:='        WHEN f.joins_closed_at IS NOT NULL';
 patched:=replace(patched,a,
  '        WHEN f.anchor_table_id = f.hourly_drain_table_id THEN ''CASH_HOURLY_CAP_DRAIN'''||chr(10)||a);
 IF patched=src OR position('CASH_HOURLY_CAP_DRAIN' IN patched)<position('THEN ''IN_HAND''' IN patched) THEN
  RAISE EXCEPTION 'cash_hourly_lightning_boundary_changed'; END IF;
 EXECUTE patched;
END $patch$;

REVOKE ALL ON FUNCTION public.fn_cash_hourly_table_range(timestamptz),public.fn_cash_hourly_table_census(),
 public.fn_cash_hourly_table_excess(uuid),public.fn_cash_hourly_table_delay(uuid),
 public.fn_cash_hourly_table_drain_candidate(),
 public.fn_cash_hourly_table_admissions(),
 public.fn_cash_hourly_table_enabled(),
 public.fn_cash_hourly_table_admit(uuid,uuid),public.fn_cash_hourly_table_close(uuid,uuid,text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_table_range(timestamptz),public.fn_cash_hourly_table_census(),
 public.fn_cash_hourly_table_excess(uuid),public.fn_cash_hourly_table_delay(uuid),
 public.fn_cash_hourly_table_drain_candidate(),
 public.fn_cash_hourly_table_admissions(),
 public.fn_cash_hourly_table_enabled(),
 public.fn_cash_hourly_table_admit(uuid,uuid),public.fn_cash_hourly_table_close(uuid,uuid,text,uuid) TO service_role;
COMMIT;
