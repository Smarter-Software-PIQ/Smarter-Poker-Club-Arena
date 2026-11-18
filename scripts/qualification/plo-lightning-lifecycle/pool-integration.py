"""Extend the existing real Lightning PostgreSQL chain, using its funded
anchor/conversion/formation/settlement/leave fixtures. No production access.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
M = ROOT/'supabase/migrations/20261109141301_plo_lightning_gradual_admission_and_feeder_lifecycle.sql'
# Install the exact new private transaction component into the existing full
# Lightning fixture. The complete migration/projection/trigger has its own
# native qualification; this route proves composition with real pool owners.
component = M.read_text().split('CREATE TABLE public.lightning_horse_admission',1)[1].split('DO $guard$',1)[0]
component = 'CREATE TABLE public.lightning_horse_admission'+component
sql = r'''
SET SESSION AUTHORIZATION postgres;
CREATE TABLE IF NOT EXISTS public.profiles(id uuid PRIMARY KEY,is_horse boolean);
ALTER TABLE public.table_waitlist ADD COLUMN IF NOT EXISTS notified_at timestamptz;
'''+component+r'''
DO $test$
DECLARE
 g uuid:='c79d8ec2-2281-411d-b4e1-42b5610849e2'; front uuid; feeder uuid;
 human uuid:=gen_random_uuid(); u uuid; n integer; t timestamptz:='2026-11-09T12:00:00Z';
 ids uuid[]:=ARRAY[]::uuid[]; f jsonb; h uuid; r jsonb; human_seat uuid;
 total numeric; after_total numeric; post_ids uuid[]; winner uuid; spec jsonb; hp record;
 pre_seats jsonb; pre_sessions jsonb;
BEGIN
 INSERT INTO cash_games(id,club_id,union_id,name,template_name,variant,sb,bb,handedness,
   ruleset_snapshot,created_by,must_move,lightning_enabled,enabled,cluster_mode,cluster_epoch)
 VALUES(g,'cb000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000f1',
   'PLO gradual lifecycle','madness','plo4',1,2,6,
   '{"seats":6,"template":"madness","lightning":{"worker_mode":"form","on_threshold":10,"off_threshold":4,"always_on":false}}',
   '00000000-0000-0000-0000-0000000000aa',true,true,true,'must_move',0);
 front:=fx9_table(g,'gradual front','main',1,6);
 UPDATE tables SET game_variant='plo4',is_private=false WHERE id=front;
 INSERT INTO profiles VALUES(human,false);
 human_seat:=fxr_join(g,front,1,400,false,true,human);
 FOR n IN 1..9 LOOP
   u:=gen_random_uuid(); INSERT INTO profiles VALUES(u,true);
   IF n=6 THEN
     r:=fn_cash_cluster_tick(g,0);
     SELECT id INTO feeder FROM tables WHERE cluster_id=g AND role='feeder' AND lifecycle='opening';
     IF feeder IS NULL OR (r->>'buyers')::integer<>0 THEN RAISE EXCEPTION 'Actual feeder producer did not prepare capacity: %',r; END IF;
     IF (SELECT auto_start_players FROM tables WHERE id=feeder)<>2 THEN RAISE EXCEPTION 'Real opener lost heads-up minimum'; END IF;
   END IF;
   PERFORM fn_plo_lightning_horse_admit(CASE WHEN n<=5 THEN front ELSE feeder END,u,t);
   IF n<=5 THEN
     PERFORM fxr_join(g,front,n+1,200+n,true,true,u);
   ELSE
     PERFORM fxr_join(g,feeder,n-5,200+n,true,true,u);
   END IF;
   IF n=7 THEN
     PERFORM fn_cash_cluster_tick(g,0);
     IF (SELECT lifecycle FROM tables WHERE id=feeder)<>'live' THEN RAISE EXCEPTION 'Actual feeder did not promote at two'; END IF;
   END IF;
   IF fn_cash_cluster_live_eligible(g)<>n+1 THEN RAISE EXCEPTION 'ready population drift'; END IF;
   IF n=1 AND (SELECT count(*) FROM table_seats WHERE table_id=front AND left_at IS NULL)<>2 THEN
     RAISE EXCEPTION 'heads-up did not precede growth'; END IF;
   IF n=8 THEN
     r:=fn_cash_cluster_begin_pending_on(g,gen_random_uuid());
     IF r->>'ok'='true' OR (SELECT cluster_mode FROM cash_games WHERE id=g)<>'must_move' THEN
       RAISE EXCEPTION 'Lightning started before ten: %',r; END IF;
   END IF;
   t:=t+interval '90 seconds';
 END LOOP;
 -- Bind original cash sessions to the real table-scoped estate used by the
 -- installed cash-clock settlement trigger (the old fixture starts cluster-scoped).
 UPDATE cash_player_session SET scope_type='table',scope_id=table_id,variant='plo4',
   stay_remaining_ms=600000,stay_running=false,stay_last_tick_at='2000-01-01Z'
 WHERE cluster_id=g;
 UPDATE table_seats s SET occupancy_id=coalesce(occupancy_id,gen_random_uuid())
 FROM tables tb WHERE tb.id=s.table_id AND tb.cluster_id=g;
 IF (SELECT admitted_count FROM lightning_horse_admission WHERE game_id=g)<>9 THEN RAISE EXCEPTION 'admissions duplicated'; END IF;
 IF (fn_cash_cluster_lightning_state(g)->'thresholds'->>'on')::integer<>10 THEN RAISE EXCEPTION 'owner threshold drift'; END IF;
 -- Feeder -> Lightning at the start count: every seat, stack and cash
 -- session before the real conversion is exactly there after it.
 SELECT jsonb_agg(jsonb_build_array(s.id,s.user_id,s.table_id,s.stack) ORDER BY s.id) INTO pre_seats
   FROM table_seats s JOIN tables tb ON tb.id=s.table_id WHERE tb.cluster_id=g AND s.left_at IS NULL;
 SELECT jsonb_agg(jsonb_build_array(c.player_id,c.baseline) ORDER BY c.player_id) INTO pre_sessions
   FROM cash_player_session c WHERE c.cluster_id=g AND c.closed_at IS NULL;
 IF jsonb_array_length(pre_seats)<>10 OR jsonb_array_length(pre_sessions)<>10 THEN
   RAISE EXCEPTION 'feeder did not hold ten seated players with sessions: % %',pre_seats,pre_sessions; END IF;
 PERFORM fx9_convert(g); PERFORM fx9_pool(g); PERFORM fxr_lease(fn_cash_cluster_front_table(g),true);
 IF (SELECT cluster_mode FROM cash_games WHERE id=g)<>'lightning' THEN RAISE EXCEPTION 'conversion did not reach lightning'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_array(s.id,s.user_id,s.table_id,s.stack) ORDER BY s.id)
       FROM table_seats s JOIN tables tb ON tb.id=s.table_id WHERE tb.cluster_id=g AND s.left_at IS NULL) IS DISTINCT FROM pre_seats
 THEN RAISE EXCEPTION 'conversion changed a seat or stack'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_array(c.player_id,c.baseline) ORDER BY c.player_id)
       FROM cash_player_session c WHERE c.cluster_id=g AND c.closed_at IS NULL) IS DISTINCT FROM pre_sessions
 THEN RAISE EXCEPTION 'conversion closed or changed a cash session'; END IF;
 IF (SELECT count(*) FROM lightning_pool_session WHERE cluster_id=g AND exited_at IS NULL)<>10 THEN RAISE EXCEPTION 'conversion lost participant'; END IF;
 SELECT sum(stack) INTO total FROM table_seats s JOIN tables tb ON tb.id=s.table_id WHERE tb.cluster_id=g;
 SELECT array_agg(player_id) INTO ids FROM (SELECT player_id FROM lightning_pool_session WHERE cluster_id=g AND exited_at IS NULL ORDER BY (player_id=human) DESC,player_id LIMIT 6)x;
 f:=public.fn_lightning_form_hand(g,ids,p_target_size=>6::smallint,p_max_size=>6::smallint,p_matcher_version=>'p6s-matcher',p_request_id=>gen_random_uuid(),p_player_platforms=>NULL::jsonb); IF f->>'formed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'real formation refused: %',f; END IF; h:=(f->>'hand_id')::uuid; PERFORM harness.deal((f->>'instance_id')::uuid);
 UPDATE table_seats SET leave_pending=true WHERE id=human_seat;
 r:=harness.settle(h,gen_random_uuid(),harness.results(h,'{}'),0,0);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'first real hand failed: %',r; END IF;
 UPDATE table_seats SET left_at=clock_timestamp() WHERE id=human_seat;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF EXISTS(SELECT 1 FROM lightning_pool_session WHERE cluster_id=g AND player_id=human AND exited_at IS NULL) THEN RAISE EXCEPTION 'human did not leave pool'; END IF;
 IF (SELECT count(*) FROM lightning_pool_session WHERE cluster_id=g AND exited_at IS NULL)<>9 THEN RAISE EXCEPTION 'human exit drained other participants'; END IF;
 SELECT array_agg(player_id) INTO post_ids FROM (SELECT player_id FROM lightning_pool_session WHERE cluster_id=g AND exited_at IS NULL ORDER BY player_id LIMIT 6)x;
 f:=public.fn_lightning_form_hand(g,post_ids,p_target_size=>6::smallint,p_max_size=>6::smallint,p_matcher_version=>'p6s-matcher',p_request_id=>gen_random_uuid(),p_player_platforms=>NULL::jsonb); IF f->>'formed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'real formation refused: %',f; END IF; h:=(f->>'hand_id')::uuid; PERFORM harness.deal((f->>'instance_id')::uuid);
 winner:=post_ids[1]; spec:='{}';
 FOR hp IN SELECT * FROM lightning_hand_player WHERE hand_id=h LOOP
   spec:=spec||jsonb_build_object(hp.player_id::text,jsonb_build_object('d',CASE WHEN hp.player_id=winner THEN 10 ELSE -2 END,'c',2));
 END LOOP;
 r:=harness.settle(h,gen_random_uuid(),harness.results(h,spec),0,0,jsonb_build_object('pot_size',12));
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'continued real hand failed: %',r; END IF;
 SELECT sum(stack) INTO after_total FROM table_seats s JOIN tables tb ON tb.id=s.table_id WHERE tb.cluster_id=g;
 IF after_total IS DISTINCT FROM total THEN RAISE EXCEPTION 'chips changed across real conversion/hands/departure: % -> %',total,after_total; END IF;
 IF fn_cash_cluster_live_eligible(g)<>9 OR (SELECT cluster_mode FROM cash_games WHERE id=g)<>'lightning' THEN RAISE EXCEPTION 'human departure collapsed valid pool'; END IF;
END $test$;
\echo 'PASS: real heads-up feeder growth, ten-player conversion keeping every seat, stack and cash session, settlement, human departure, continued six-Horse hand and conserved anchor chips'
'''
pg=Path(os.environ['PG_BIN'])
with tempfile.TemporaryDirectory(prefix='plo-pool-') as work:
    f=Path(work)/'case.sql';f.write_text(sql)
    p=subprocess.run([str(pg/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1',
        '-h',os.environ['LIGHTNING_ZERO_PAYER_SOCKET'],'-p',os.environ['LIGHTNING_ZERO_PAYER_PORT'],
        '-d','postgres','-f',str(f)],capture_output=True,text=True,timeout=60)
    print(p.stdout)
    if p.returncode: raise RuntimeError(p.stderr)
