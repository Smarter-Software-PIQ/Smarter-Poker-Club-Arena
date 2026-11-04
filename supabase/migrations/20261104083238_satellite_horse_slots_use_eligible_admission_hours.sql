-- Reserved by scripts/reserve-migration-version.sh; existing paid admission hours unchanged.
-- Correct only private horse-planning times. No table/trigger DDL or live-row rewrite.
-- @live-proof: md5(pg_get_functiondef('smarter_private.sng_horse_open_slots(date,jsonb,integer[],timestamptz)'::regprocedure))='e4d11b4ea9969008e041b04807d39214' AND md5(pg_get_functiondef('smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure))='02383a7c4ddf36cf3782fa44f3c105e0' AND NOT has_function_privilege('service_role','smarter_private.sng_horse_open_slots(date,jsonb,integer[],timestamptz)','EXECUTE')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure)) IS DISTINCT FROM '71c0f9f46a95461303148ac40f86ffd1' THEN RAISE EXCEPTION 'SNG_OPEN_SLOTS_PREIMAGE_CHANGED'; END IF;
END $preimage$;
DO $owner$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure
   AND proowner='postgres'::regrole AND proacl=ARRAY['postgres=X/postgres']::aclitem[]
   AND prosecdef AND provolatile='v' AND proparallel='u'
   AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private']) THEN
   RAISE EXCEPTION 'SNG_OPEN_SLOTS_OWNER_CHANGED'; END IF;
END $owner$;
CREATE FUNCTION smarter_private.sng_horse_open_slots(p_day date,p_slots jsonb,p_claimed integer[],p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,smarter_private AS $slots$
DECLARE pol smarter_private.daily_window_policy%ROWTYPE; first_at timestamptz; last_at timestamptz;
 close_at timestamptz; reopen_at timestamptz; open_ranges tstzmultirange; allowed tstzmultirange;
 closed_ranges tstzmultirange:='{}'; policy_day date; day_offset integer;
 occupied tstzmultirange; original tstzrange; segment tstzrange; candidates tstzmultirange;
 result jsonb:=p_slots; item jsonb; due timestamptz; expires timestamptz; duration interval;
 n integer:=jsonb_array_length(p_slots); i integer; other integer; total double precision; draw double precision; room double precision;
BEGIN
 SELECT * INTO STRICT pol FROM smarter_private.daily_window_policy WHERE singleton;
 -- Daily allocation/legacy claims retain their Chicago calendar. Admission
 -- hours belong to the policy zone; subtract every local closure intersecting
 -- this Chicago day, including the adjacent policy date across midnight.
 first_at:=p_day::timestamp AT TIME ZONE 'America/Chicago';
 last_at:=(p_day+1)::timestamp AT TIME ZONE 'America/Chicago';
 IF n NOT BETWEEN 3 AND 5 OR p_at IS NULL OR pol.spin_sng_stop>=pol.window_end THEN RAISE EXCEPTION 'SNG_OPEN_SLOT_INPUT'; END IF;
 FOR day_offset IN 0..((last_at AT TIME ZONE pol.time_zone)::date-(first_at AT TIME ZONE pol.time_zone)::date) LOOP
  policy_day:=(first_at AT TIME ZONE pol.time_zone)::date+day_offset;
  close_at:=(policy_day+pol.spin_sng_stop) AT TIME ZONE pol.time_zone;
  reopen_at:=(policy_day+pol.window_end) AT TIME ZONE pol.time_zone;
  closed_ranges:=closed_ranges+tstzmultirange(tstzrange(close_at,reopen_at,'[)'));
 END LOOP;
 open_ranges:=tstzmultirange(tstzrange(first_at,last_at,'[)'))-closed_ranges;
 FOR i IN 0..n-1 LOOP
  item:=result->i;
  IF (item->>'slot')::integer IS DISTINCT FROM i THEN RAISE EXCEPTION 'SNG_OPEN_SLOT_IDENTITY'; END IF;
  due:=(item->>'due')::timestamptz; expires:=(item->>'expires')::timestamptz;
  IF due IS NULL OR expires IS NULL OR NOT isfinite(due) OR NOT isfinite(expires) OR due>=expires
    OR due<first_at OR expires>last_at THEN RAISE EXCEPTION 'SNG_OPEN_SLOT_RANGE'; END IF;
  original:=tstzrange(due,expires,'[)');
  -- Paid claims and genuinely expired windows are never moved or reopened.
  IF i=ANY(coalesce(p_claimed,ARRAY[]::integer[])) OR expires<=p_at
    OR NOT (tstzmultirange(original) && closed_ranges) THEN CONTINUE; END IF;
  allowed:=tstzmultirange(original)*open_ranges;
  IF allowed<>'{}'::tstzmultirange THEN
   -- Preserve an existing eligible chance; only remove its closed portion.
   -- Do not manufacture a longer minimum window or revive elapsed eligibility.
   SELECT x INTO segment FROM unnest(allowed) x WHERE upper(x)>p_at
    ORDER BY upper(x)-greatest(lower(x),p_at) DESC,lower(x) LIMIT 1;
   IF NOT FOUND THEN CONTINUE; END IF;
   due:=lower(segment); expires:=upper(segment);
  ELSE
   -- Entirely closed and still unexpired: retain the slot identity and board
   -- choice. Resample only its timing, first within its original day stratum.
   duration:=least(expires-due,interval '20 minutes');
   occupied:='{}'::tstzmultirange;
   FOR other IN 0..n-1 LOOP
    IF other<>i THEN occupied:=occupied+tstzmultirange(tstzrange((result->other->>'due')::timestamptz,(result->other->>'expires')::timestamptz,'[)')); END IF;
   END LOOP;
   candidates:=(open_ranges*tstzmultirange(tstzrange(greatest(first_at,p_at),last_at,'[)')))-occupied;
   allowed:=candidates*tstzmultirange(tstzrange(first_at+(last_at-first_at)*(i::double precision/n),first_at+(last_at-first_at)*((i+1)::double precision/n),'[)'));
   SELECT sum(extract(epoch FROM upper(x)-lower(x)-duration)) INTO total FROM unnest(allowed)x WHERE upper(x)-lower(x)>duration;
   IF coalesce(total,0)<=0 THEN
    allowed:=candidates;
    SELECT sum(extract(epoch FROM upper(x)-lower(x)-duration)) INTO total FROM unnest(allowed)x WHERE upper(x)-lower(x)>duration;
   END IF;
   -- There may be no remaining eligible opportunity today. Never extend the
   -- day or resurrect another slot to force an allocation to be consumed.
   IF coalesce(total,0)<=0 THEN CONTINUE; END IF;
   draw:=random()*total;
   FOR segment IN SELECT x FROM unnest(allowed)x WHERE upper(x)-lower(x)>duration ORDER BY lower(x) LOOP
    room:=extract(epoch FROM upper(segment)-lower(segment)-duration);
    IF draw<room THEN due:=lower(segment)+make_interval(secs=>draw); expires:=due+duration; EXIT; END IF;
    draw:=draw-room;
   END LOOP;
  END IF;
  result:=jsonb_set(result,ARRAY[i::text],item||jsonb_build_object('due',due,'expires',expires));
 END LOOP;
 RETURN result;
END $slots$;
REVOKE ALL ON FUNCTION smarter_private.sng_horse_open_slots(date,jsonb,integer[],timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION smarter_private.sng_horse_plan(p_tournament_id uuid, p_claim boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE t public.tournaments%ROWTYPE; c smarter_private.sng_horse_claims%ROWTYPE;
 d date; now_at timestamptz:=clock_timestamp(); day_start timestamptz; day_end timestamptz;
 slots jsonb; normalized_slots jsonb; n integer; i integer; due timestamptz; expires timestamptz;
 first_at timestamptz; deadline timestamptz; claimed integer; chosen integer;
 players integer; target integer; chosen_board uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'SNG_HORSE_PLAN_REQUIRES_READ_COMMITTED' USING ERRCODE='0A000'; END IF;
 PERFORM pg_advisory_xact_lock_shared(530090,1);
 IF public.fn_entry_purchases_frozen() THEN
   RETURN jsonb_build_object('ok',false,'target_players',0,'reason','platform_frozen','wait_until',NULL); END IF;
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR NO KEY UPDATE;
 IF NOT FOUND OR public.fn_ca_is_fixed_sng_satellite(to_jsonb(t)) IS NOT TRUE
   OR t.format_contract<>'sng-v1' OR t.union_id IS NULL
   OR upper(coalesce(t.status,'')) NOT IN('ANNOUNCED','REGISTERING') THEN
   RETURN jsonb_build_object('ok',false,'target_players',0,'reason','not_registering_fixed_satellite','wait_until',NULL); END IF;
 SELECT * INTO c FROM smarter_private.sng_horse_claims WHERE tournament_id=t.id;
 IF NOT FOUND THEN
   -- An already bought promise is honoured, including boards admitted before
   -- installation or yesterday. It still counts against its actual first day.
   SELECT min(coalesce(tp.registered_at,now_at)) INTO first_at FROM public.tournament_players tp
     JOIN public.profiles h ON h.id=tp.user_id AND h.is_horse IS TRUE
     WHERE tp.tournament_id=t.id;
   IF first_at IS NOT NULL THEN
     INSERT INTO smarter_private.sng_horse_claims(tournament_id,union_id,local_day,first_paid_at,wait_seconds,legacy)
       VALUES(t.id,t.union_id,(first_at AT TIME ZONE 'America/Chicago')::date,first_at,0,true)
       ON CONFLICT(tournament_id) DO NOTHING;
     SELECT * INTO c FROM smarter_private.sng_horse_claims WHERE tournament_id=t.id;
   END IF;
 END IF;
 IF c.tournament_id IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.tournaments target_row
     WHERE target_row.id=coalesce(t.satellite_target_id,t.satellite_target)
       AND upper(coalesce(target_row.status,'')) IN('ANNOUNCED','REGISTERING')
       AND target_row.start_time IS NOT NULL AND isfinite(target_row.start_time)
       AND target_row.start_time>now_at
       AND public.fn_ca_satellite_target_accepts_new_feeder(target_row.id) IS TRUE) THEN
     RETURN jsonb_build_object('ok',false,'target_players',0,'reason','target_unavailable','wait_until',NULL); END IF;
   d:=(now_at AT TIME ZONE 'America/Chicago')::date;
   -- All paths own the tournament admission row before this nonblocking union
   -- day lock. Another board gets a bounded busy refusal, never a lock cycle.
   IF NOT pg_try_advisory_xact_lock(hashtextextended('ca:sng-horse-day:'||t.union_id::text||':'||d::text,0)) THEN
     RETURN jsonb_build_object('ok',false,'target_players',0,'reason','union_day_busy','wait_until',NULL); END IF;
   SELECT x.slots INTO slots FROM smarter_private.sng_horse_days x WHERE union_id=t.union_id AND local_day=d;
   IF NOT FOUND THEN
     -- A refused paid transaction cannot persist a random draw. The service
     -- planning RPC commits the day first; old callers fail closed until then.
     IF p_claim THEN RETURN jsonb_build_object('ok',false,'target_players',0,'reason','plan_not_initialized','wait_until',NULL); END IF;
     day_start:=d::timestamp AT TIME ZONE 'America/Chicago';
     day_end:=(d+1)::timestamp AT TIME ZONE 'America/Chicago';
     n:=3+floor(random()*3)::integer; slots:='[]'::jsonb;
     FOR i IN 0..n-1 LOOP
       -- Actual local midnight endpoints handle 23/25-hour DST days. Every
       -- stratum has one random opening and a finite <=20-minute opportunity.
       due:=day_start+(day_end-day_start)*((i+random()*0.8)/n);
       expires:=least(due+interval '20 minutes',day_start+(day_end-day_start)*((i+1)::numeric/n));
       slots:=slots||jsonb_build_array(jsonb_build_object('slot',i,'due',due,'expires',expires));
     END LOOP;
     slots:=smarter_private.sng_horse_open_slots(d,slots,ARRAY[]::integer[],day_start);
     INSERT INTO smarter_private.sng_horse_days VALUES(t.union_id,d,slots);
     -- Existing natural paid boards count once even if completed/withdrawn.
     INSERT INTO smarter_private.sng_horse_claims(tournament_id,union_id,local_day,first_paid_at,wait_seconds,legacy)
       WITH fixed AS MATERIALIZED (
         SELECT old.* FROM public.tournaments old
         WHERE old.union_id=t.union_id AND old.format_contract='sng-v1'
           AND upper(old.tournament_type)='SNG' AND lower(old.variant)='sng'
           AND old.max_players IN(6,9) AND old.min_players=old.max_players
           AND old.table_size=old.max_players AND old.satellite_seats=2
           AND coalesce(old.satellite_target_id,old.satellite_target) IS NOT NULL
       )
       SELECT old.id,t.union_id,d,paid.first_at,0,true
       FROM fixed old CROSS JOIN LATERAL (
         SELECT min(coalesce(tp.registered_at,now_at)) first_at
         FROM public.tournament_players tp
         JOIN public.profiles h ON h.id=tp.user_id AND h.is_horse IS TRUE
         WHERE tp.tournament_id=old.id
       ) paid
       WHERE public.fn_ca_is_fixed_sng_satellite(to_jsonb(old))
         AND (paid.first_at AT TIME ZONE 'America/Chicago')::date=d
       ON CONFLICT(tournament_id) DO NOTHING;
   END IF;
   -- This existing nonblocking union/day lane also serializes normalization.
   -- Never touch paid claims, slot indices, or a persisted board choice.
   normalized_slots:=smarter_private.sng_horse_open_slots(d,slots,
     ARRAY(SELECT x.slot FROM smarter_private.sng_horse_claims x WHERE x.union_id=t.union_id AND x.local_day=d AND x.slot IS NOT NULL),clock_timestamp());
   IF normalized_slots IS DISTINCT FROM slots THEN
     -- A paid entry cannot commit a newly randomized plan. The existing
     -- planning RPC persists it first, just as for original day creation.
     IF p_claim THEN RETURN jsonb_build_object('ok',false,'target_players',0,'reason','plan_not_initialized','wait_until',NULL); END IF;
     UPDATE smarter_private.sng_horse_days day_row SET slots=normalized_slots WHERE day_row.union_id=t.union_id AND day_row.local_day=d;
     slots:=normalized_slots;
   END IF;
   now_at:=clock_timestamp();
   SELECT count(*) INTO claimed FROM smarter_private.sng_horse_claims WHERE union_id=t.union_id AND local_day=d;
   IF claimed>=jsonb_array_length(slots) THEN
     RETURN jsonb_build_object('ok',false,'target_players',0,'reason','daily_budget','wait_until',NULL); END IF;
   SELECT (s->>'slot')::integer INTO chosen FROM jsonb_array_elements(slots)s
     WHERE (s->>'due')::timestamptz<=now_at AND (s->>'expires')::timestamptz>now_at
       AND NOT EXISTS(SELECT 1 FROM smarter_private.sng_horse_claims x
         WHERE x.union_id=t.union_id AND x.local_day=d AND x.slot=(s->>'slot')::integer)
     ORDER BY (s->>'slot')::integer LIMIT 1;
   IF chosen IS NULL THEN
     RETURN jsonb_build_object('ok',false,'target_players',0,'reason','no_current_slot','wait_until',NULL); END IF;
   chosen_board:=NULLIF(slots->chosen->>'tournament_id','')::uuid;
   IF chosen_board IS NULL THEN
     IF p_claim THEN RETURN jsonb_build_object('ok',false,'target_players',0,'reason','choice_not_initialized','wait_until',NULL); END IF;
     SELECT candidate.id INTO chosen_board FROM public.tournaments candidate
     JOIN public.tournaments target_row ON target_row.id=coalesce(candidate.satellite_target_id,candidate.satellite_target)
     WHERE candidate.union_id=t.union_id AND candidate.format_contract='sng-v1'
       AND public.fn_ca_is_fixed_sng_satellite(to_jsonb(candidate))
       AND upper(coalesce(candidate.status,'')) IN('ANNOUNCED','REGISTERING')
       AND coalesce(candidate.current_players,0)<candidate.max_players
       AND upper(coalesce(target_row.status,'')) IN('ANNOUNCED','REGISTERING')
       AND target_row.start_time IS NOT NULL AND isfinite(target_row.start_time) AND target_row.start_time>now_at
       AND public.fn_ca_satellite_target_accepts_new_feeder(target_row.id) IS TRUE
       AND NOT EXISTS(SELECT 1 FROM smarter_private.sng_horse_claims x WHERE x.tournament_id=candidate.id)
       AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp JOIN public.profiles h ON h.id=tp.user_id AND h.is_horse IS TRUE WHERE tp.tournament_id=candidate.id)
     ORDER BY random() LIMIT 1;
     IF chosen_board IS NOT NULL THEN
       slots:=jsonb_set(slots,ARRAY[chosen::text,'tournament_id'],to_jsonb(chosen_board));
       UPDATE smarter_private.sng_horse_days day_row SET slots=jsonb_set(day_row.slots,ARRAY[chosen::text,'tournament_id'],to_jsonb(chosen_board))
         WHERE day_row.union_id=t.union_id AND day_row.local_day=d;
     END IF;
   END IF;
   IF chosen_board IS DISTINCT FROM t.id THEN
     RETURN jsonb_build_object('ok',false,'target_players',0,'reason','different_random_board','wait_until',NULL); END IF;
   IF p_claim THEN
     INSERT INTO smarter_private.sng_horse_claims(tournament_id,union_id,local_day,slot,first_paid_at,wait_seconds)
       VALUES(t.id,t.union_id,d,chosen,now_at,120+floor(random()*31)::integer) RETURNING * INTO c;
   ELSE
     RETURN jsonb_build_object('ok',true,'target_players',t.max_players-1,'reason','preseed','wait_until',NULL);
   END IF;
 END IF;
 deadline:=CASE WHEN c.legacy THEN c.first_paid_at ELSE smarter_private.sng_horse_wait_until(c.first_paid_at,c.wait_seconds) END;
 target:=CASE WHEN deadline>now_at THEN t.max_players-1 ELSE t.max_players END;
 SELECT count(*) INTO players FROM public.tournament_players WHERE tournament_id=t.id AND status IN('registered','playing');
 IF p_claim AND players>=target THEN
   RAISE EXCEPTION 'SNG_HORSE_HUMAN_WAIT: paid roster must reserve its human chair' USING ERRCODE='P0001'; END IF;
 RETURN jsonb_build_object('ok',true,'target_players',target,
   'reason',CASE WHEN deadline>now_at THEN 'human_wait' ELSE 'fill' END,'wait_until',deadline);
END $function$
;
DO $owner$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure
   AND proowner='postgres'::regrole AND proacl=ARRAY['postgres=X/postgres']::aclitem[]
   AND prosecdef AND provolatile='v' AND proparallel='u'
   AND proconfig=ARRAY['search_path=pg_catalog, public, smarter_private']) THEN
   RAISE EXCEPTION 'SNG_OPEN_SLOTS_OWNER_CHANGED'; END IF;
END $owner$;
COMMIT;
