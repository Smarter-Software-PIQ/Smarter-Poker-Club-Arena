-- Realistic nine-seat1255-candidate old/new differential, no timing threshold.
BEGIN;
SET LOCAL track_functions='all';
DO $$
DECLARE x jsonb;t uuid;a uuid;b uuid;c uuid;d uuid;tb uuid;r jsonb;k record;
 proof_before bigint; proof_after_old bigint; proof_after_new bigint; old_proofs bigint; new_proofs bigint; old_result jsonb; old_ms numeric; count_now integer:=0;goal integer;started timestamptz;
BEGIN
 x:=fixture_chain();t:=(x->>'t')::uuid;a:=(x->>'a')::uuid;b:=(x->>'b')::uuid;c:=(x->>'c')::uuid;d:=(x->>'d')::uuid;
 SELECT * INTO k FROM tournament_knockout_candidates WHERE tournament_id=t AND eliminated_user_id=b;
 tb:=k.table_id;r:=fixture_claim(t,a,b,4);r:=fn_collect_bounty_obligation((r->>'obligation_id')::uuid);
 CREATE TEMP TABLE added_candidates(i int,u uuid,h uuid) ON COMMIT DROP;
 FOREACH goal IN ARRAY ARRAY[1254] LOOP
  TRUNCATE added_candidates;
  INSERT INTO added_candidates SELECT i,gen_random_uuid(),gen_random_uuid() FROM generate_series(count_now+1,goal) i;
  INSERT INTO hand_history(id,table_id,tournament_id,hand_number,created_at,players,pots,winners)
   SELECT h,tb,t,7000000+i,now()-interval '61 seconds',
     jsonb_build_array(jsonb_build_object('userId',u,'stack',0),jsonb_build_object('userId',d,'stack',2000)),
     jsonb_build_array(jsonb_build_object('index',0,'amount',2000,'eligible',jsonb_build_array(u,d))),
     jsonb_build_array(jsonb_build_object('userId',d,'amount',2000,'potIndex',0)) FROM added_candidates;
  INSERT INTO hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result,committed_at)
   SELECT tb,7000000+i,h,md5(h::text),jsonb_build_object('hand_id',h,'table_id',tb,'hand_number',7000000+i,'written',jsonb_build_object(u::text,0,d::text,2000)),now()-interval '60 seconds' FROM added_candidates;
  INSERT INTO settlement_idempotency_keys(table_id,hand_id,status,completed_at,result)
   SELECT tb,h,'succeeded',now()-interval '62 seconds',jsonb_build_object('hand_id',h,'table_id',tb,'hand_number',7000000+i,'written',jsonb_build_object(u::text,0,d::text,2000)) FROM added_candidates;
  INSERT INTO tournament_knockout_candidates(tournament_id,eliminated_user_id,table_id,seat_id,seat_joined_at,hand_id,hand_number,stack_before,stack_after,state,created_at)
   SELECT t,u,tb,gen_random_uuid(),'2026-09-10 00:00:00+00',h,7000000+i,1000,0,'pending',now()-interval '63 seconds' FROM added_candidates;
  -- Match the incident scale with nine seats and a wide unused history field.
  ALTER TABLE hand_history ADD COLUMN fixture_unused_payload jsonb;
  UPDATE hand_history h SET players=players||(SELECT jsonb_agg(jsonb_build_object('userId',md5(h.id::text||g::text)::uuid,'stack',1000)) FROM generate_series(1,7) g),
    fixture_unused_payload=(SELECT jsonb_agg(md5(g::text)) FROM generate_series(1,2000) g)
    WHERE h.id IN(SELECT added_candidates.h FROM added_candidates);
  UPDATE hand_atomic_commits a SET stack_result=jsonb_set(stack_result,'{written}',(SELECT jsonb_object_agg(p->>'userId',p->'stack') FROM hand_history h CROSS JOIN LATERAL jsonb_array_elements(h.players) p WHERE h.id=a.hand_id))
    WHERE a.hand_id IN(SELECT h FROM added_candidates);
  UPDATE settlement_idempotency_keys s SET result=jsonb_set(result,'{written}',a.stack_result->'written') FROM hand_atomic_commits a
    WHERE s.table_id=a.table_id AND s.hand_id=a.hand_id AND a.hand_id IN(SELECT h FROM added_candidates);
  started:=clock_timestamp();
  SELECT coalesce(sum(calls),0)::bigint INTO proof_before FROM pg_stat_xact_user_functions WHERE funcid='public.fn_pko_candidate_accepted_scope_v1(uuid,uuid)'::regprocedure;
  old_result:=pg_temp.fixture_original_predecessor(t,b,k.table_id,k.hand_id,k.hand_number,k.seat_joined_at);
  SELECT coalesce(sum(calls),0)::bigint INTO proof_after_old FROM pg_stat_xact_user_functions WHERE funcid='public.fn_pko_candidate_accepted_scope_v1(uuid,uuid)'::regprocedure;
  old_ms:=extract(epoch FROM clock_timestamp()-started)*1000;
  count_now:=goal;ANALYZE tournament_knockout_candidates;ANALYZE hand_atomic_commits;ANALYZE settlement_idempotency_keys;ANALYZE hand_history;
  started:=clock_timestamp();
  r:=fn_pko_claim_predecessor_status_v1(t,b,k.table_id,k.hand_id,k.hand_number,k.seat_joined_at);
  SELECT coalesce(sum(calls),0)::bigint INTO proof_after_new FROM pg_stat_xact_user_functions WHERE funcid='public.fn_pko_candidate_accepted_scope_v1(uuid,uuid)'::regprocedure;
  old_proofs:=proof_after_old-proof_before;new_proofs:=proof_after_new-proof_after_old;
  RAISE NOTICE 'BATCH_PROOF_WORK candidates=% old_calls=% new_calls=%',goal+1,old_proofs,new_proofs;
  PERFORM fixture_assert(old_proofs>goal,'old serial reader reproduces per-candidate accepted proof work');
  PERFORM fixture_assert(new_proofs=1,'joined reader performs only the target accepted proof');
  PERFORM fixture_assert(old_result IS NOT DISTINCT FROM r,'1255 scope and all proof details equal the original');
  RAISE NOTICE 'BATCH_COST original_ms=% joined_ms=%',old_ms,extract(epoch FROM clock_timestamp()-started)*1000;
  RAISE NOTICE 'SCOPE_COST synthetic_nonparticipants=% elapsed_ms=% status=% inspected=%',goal,extract(epoch from clock_timestamp()-started)*1000,r->>'status',r->>'inspected';
  IF goal<10000 THEN
   PERFORM fixture_assert(r->>'ok'='true' AND (r->>'inspected')::integer=goal+1,'complete indexed scope proves independent heads at size'||goal);
  ELSE
   PERFORM fixture_assert(r->>'ok'='false' AND r->>'reason'='predecessor_scope_incomplete','overflow cannot become truncated successful proof');
  END IF;
 END LOOP;
END $$;
ROLLBACK;

-- Exercise the successor reader at the complete maximum and the first overflow.
BEGIN;
SET LOCAL track_functions='all';
DO $$
DECLARE x jsonb;t uuid;a uuid;b uuid;c uuid;d uuid;tb uuid;r jsonb;k record;
 proof_before bigint; proof_after_old bigint; proof_after_new bigint; old_proofs bigint; new_proofs bigint; old_result jsonb; count_now integer:=0;goal integer;started timestamptz;
BEGIN
 x:=fixture_chain();t:=(x->>'t')::uuid;a:=(x->>'a')::uuid;b:=(x->>'b')::uuid;c:=(x->>'c')::uuid;d:=(x->>'d')::uuid;
 SELECT * INTO k FROM tournament_knockout_candidates WHERE tournament_id=t AND eliminated_user_id=b;
 tb:=k.table_id;r:=fixture_claim(t,a,b,4);r:=fn_collect_bounty_obligation((r->>'obligation_id')::uuid);
 CREATE TEMP TABLE added_candidates(i int,u uuid,h uuid) ON COMMIT DROP;
 FOREACH goal IN ARRAY ARRAY[9999,10000] LOOP
  TRUNCATE added_candidates;
  INSERT INTO added_candidates SELECT i,gen_random_uuid(),gen_random_uuid() FROM generate_series(count_now+1,goal) i;
  INSERT INTO hand_history(id,table_id,tournament_id,hand_number,created_at,players,pots,winners)
   SELECT h,tb,t,7000000+i,now()-interval '61 seconds',
     jsonb_build_array(jsonb_build_object('userId',u,'stack',0),jsonb_build_object('userId',d,'stack',2000)),
     jsonb_build_array(jsonb_build_object('index',0,'amount',2000,'eligible',jsonb_build_array(u,d))),
     jsonb_build_array(jsonb_build_object('userId',d,'amount',2000,'potIndex',0)) FROM added_candidates;
  INSERT INTO hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result,committed_at)
   SELECT tb,7000000+i,h,md5(h::text),jsonb_build_object('hand_id',h,'table_id',tb,'hand_number',7000000+i,'written',jsonb_build_object(u::text,0,d::text,2000)),now()-interval '60 seconds' FROM added_candidates;
  INSERT INTO settlement_idempotency_keys(table_id,hand_id,status,completed_at,result)
   SELECT tb,h,'succeeded',now()-interval '62 seconds',jsonb_build_object('hand_id',h,'table_id',tb,'hand_number',7000000+i,'written',jsonb_build_object(u::text,0,d::text,2000)) FROM added_candidates;
  INSERT INTO tournament_knockout_candidates(tournament_id,eliminated_user_id,table_id,seat_id,seat_joined_at,hand_id,hand_number,stack_before,stack_after,state,created_at)
   SELECT t,u,tb,gen_random_uuid(),'2026-09-10 00:00:00+00',h,7000000+i,1000,0,'pending',now()-interval '63 seconds' FROM added_candidates;
  count_now:=goal;ANALYZE tournament_knockout_candidates;ANALYZE hand_atomic_commits;ANALYZE settlement_idempotency_keys;ANALYZE hand_history;
  SELECT coalesce(sum(calls),0)::bigint INTO proof_before FROM pg_stat_xact_user_functions WHERE funcid='public.fn_pko_candidate_accepted_scope_v1(uuid,uuid)'::regprocedure;
  old_result:=pg_temp.fixture_original_predecessor(t,b,k.table_id,k.hand_id,k.hand_number,k.seat_joined_at);
  SELECT coalesce(sum(calls),0)::bigint INTO proof_after_old FROM pg_stat_xact_user_functions WHERE funcid='public.fn_pko_candidate_accepted_scope_v1(uuid,uuid)'::regprocedure;
  started:=clock_timestamp();
  r:=fn_pko_claim_predecessor_status_v1(t,b,k.table_id,k.hand_id,k.hand_number,k.seat_joined_at);
  SELECT coalesce(sum(calls),0)::bigint INTO proof_after_new FROM pg_stat_xact_user_functions WHERE funcid='public.fn_pko_candidate_accepted_scope_v1(uuid,uuid)'::regprocedure;
  old_proofs:=proof_after_old-proof_before;new_proofs:=proof_after_new-proof_after_old;
  RAISE NOTICE 'BATCH_PROOF_WORK candidates=% old_calls=% new_calls=%',goal+1,old_proofs,new_proofs;
  PERFORM fixture_assert(old_proofs>goal,'old serial reader reproduces per-candidate accepted proof work');
  PERFORM fixture_assert(new_proofs=1,'joined reader performs only the target accepted proof');
  PERFORM fixture_assert(old_result IS NOT DISTINCT FROM r,'maximum and overflow complete verdict equal original at '||goal);
  RAISE NOTICE 'BATCH_BOUNDARY old_and_new_equal synthetic=% inspected=% status=% reason=%',goal,r->>'inspected',r->>'status',r->>'reason';
  RAISE NOTICE 'SCOPE_COST synthetic_nonparticipants=% elapsed_ms=% status=% inspected=%',goal,extract(epoch from clock_timestamp()-started)*1000,r->>'status',r->>'inspected';
  IF goal<10000 THEN
   PERFORM fixture_assert(r->>'ok'='true' AND (r->>'inspected')::integer=goal+1,'complete indexed scope proves independent heads at size'||goal);
  ELSE
   PERFORM fixture_assert(r->>'ok'='false' AND r->>'reason'='predecessor_scope_incomplete','overflow cannot become truncated successful proof');
  END IF;
 END LOOP;
END $$;
ROLLBACK;
