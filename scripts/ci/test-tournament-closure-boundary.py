#!/usr/bin/env python3
"""Qualify explicit absent-writer closure and immutable no-capsule cancellation."""
import argparse, hashlib, json, sys, time
from pathlib import Path
sys.dont_write_bytecode = True
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
from tournament_abort_registry_native import install_and_reproduce_registry_guard
from tournament_abort_native import install_f06_extension, sql_file, prepare_quiesced, SERVICE, GEN
ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'supabase/migrations/20261030161824_started_tournament_abort_uses_original_charges_and_a_drained.sql'
MIGRATION = ROOT/'supabase/migrations/20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql'
EVENT = 'd3000000-0000-4000-8000-000000000002'
OP = 'ac000000-0000-4000-8000-000000000001'
TABLE = '808a1104-9ae9-46a9-b53f-32dde38fef05'
PERMIT = '3e43f3ef-0bd4-4cd8-b902-cce87d4ad8d5'

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['evidence','work-root','socket-root','pg-bin']:p.add_argument('--'+name,type=Path,required=True)
 a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=False);a.work_root.mkdir(parents=True,exist_ok=True);a.socket_root.mkdir(parents=True,exist_ok=True)
 native=module(ROOT/'scripts/ci/test-mtt-unlimited.py','closure_boundary_native')
 e=native.Execution(ROOT,a.evidence,a.pg_bin,a.work_root,600,socket_parent=a.socket_root)
 try:
  e.start();db=e.database();install_financial_foundation(e,db,ROOT,a.evidence);install_f06_extension(e,db,ROOT)
  diamond=module(ROOT/'scripts/ci/fixtures/tournament-abort/diamond/diamond_abort_native.py','closure_boundary_diamond');diamond.install_diamond_extension(e,db,ROOT)
  install_and_reproduce_registry_guard(e,db,ROOT,BASE);e.sql(db,file=BASE,label='actual-existing-abort-authority',seconds=120)
  from closure_boundary_fixture import install_closure_boundary
  install_closure_boundary(e,db,ROOT)
  _,postimages,_=e.sql(db,"SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','smarter_private') AND p.proname IN('tournament_abort_hand_image','assert_tournament_abort_absence','fn_ca_cancel_tournament_abort_unsettled_hand','f06_immutable_identity','fn_ca_tournament_abort_stop_state','fn_ca_ack_tournament_abort_boundary','f06_retained_submission_guard','tournament_abort_archived_write_guard','tournament_abort_pending');",label='exact-boundary-function-postimages')
  e.report['function_hashes']=json.loads(postimages.strip())
  for line in MIGRATION.read_text().splitlines():
   if line.startswith('-- @live-proof: '):
    _,out,_=e.sql(db,'SELECT '+line.removeprefix('-- @live-proof: ')+';',label='migration-live-proof');assert out.strip()=='t'

  seed=(ROOT/'scripts/ci/probes/satellite-cancel-current-native.sql').read_text().split('-- Fund the source through')[0].replace('ON COMMIT DROP;','ON COMMIT PRESERVE ROWS;')
  sql_file(e,db,'real-funded-registration','BEGIN;'+seed+'COMMIT;')
  prepare_quiesced(e,db,EVENT,OP,TABLE)
  evidence={'closure_mode':'equal_share','kind':'tournament_abort_absent_boundary_v2','certificate_version':'2','physical_engine_absent':True,'physical_stopped':True,'parked_before_retirement':False,'engine_id':None,'allocation_epoch':None,'drained':True,'manager_tail_joined':True,'pending_writers':0,'bank_state_write_pending':False,'lifecycle':'1','hand_number':51496617,'source_table_ids':[TABLE]}
  proof="'"+json.dumps(evidence)+"'::jsonb"
  scene="BEGIN;"+SERVICE+"SET LOCAL session_replication_role=replica;"
  scene+="UPDATE smarter_private.tournament_abort_targets SET state='stop_requested' WHERE tournament_id='"+EVENT+"';"
  scene+="UPDATE public.tournament_players SET status='playing',eliminated_at=NULL,chips=1000,table_id='"+TABLE+"',seat_number=1 WHERE tournament_id='"+EVENT+"';"
  scene+="INSERT INTO public.table_seats(table_id,user_id,seat_number,stack,active_game_scope,active_parent_key) SELECT '"+TABLE+"',user_id,1,1000,'tournament:"+EVENT+"','tournament:"+EVENT+"' FROM public.tournament_players WHERE tournament_id='"+EVENT+"';"
  scene+="INSERT INTO smarter_private.f06_hand_permits(permit_id,tournament_id,table_id,lifecycle,hand_number,custody_id,generation) VALUES('"+PERMIT+"','"+EVENT+"','"+TABLE+"',1,51496617,'ed71949a-d255-4cc8-95f3-1f0151a8ad7f','6f7a7167-7195-4581-a78e-268282eafbd2');SET LOCAL session_replication_role=origin;"
  scene+="SELECT set_config('app.smarter_data_actor','tournament-manager',true),set_config('app.smarter_tournament_id','"+EVENT+"',true),set_config('app.smarter_tournament_lease_generation','"+GEN+"',true);"
  authority="SELECT set_config('app.smarter_data_actor','tournament-manager',true),set_config('app.smarter_tournament_id','"+EVENT+"',true),set_config('app.smarter_tournament_lease_generation','"+GEN+"',true);"
  call="public.fn_ca_cancel_tournament_abort_unsettled_hand('"+OP+"','"+EVENT+"','"+TABLE+"','"+GEN+"','"+PERMIT+"',encode(extensions.digest(convert_to(smarter_private.tournament_abort_hand_image('"+PERMIT+"')::text,'UTF8'),'sha256'),'hex'),"+proof+")"
  def refuse(name,change,expected='55000',invoke=call):
   sql_file(e,db,name,scene+change+"DO $$DECLARE refused boolean:=false;BEGIN BEGIN PERFORM "+invoke+";EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'"+expected+"' THEN RAISE;END IF;refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'missing closure refusal';END IF;IF EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions) THEN RAISE EXCEPTION 'failed closure left receipt';END IF;END$$;ROLLBACK;")
  refuse('explicit-mode-required','', '42501',call.replace('"closure_mode": "equal_share"','"closure_mode": "refund"'))
  refuse('changed-lifecycle-refused','', 'P0404',call.replace('"lifecycle": "1"','"lifecycle": "2"'))
  refuse('accepted-atomic-refused',"INSERT INTO public.hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result) VALUES('"+TABLE+"',51496617,gen_random_uuid(),repeat('a',64),'{}');")
  refuse('wrong-reviewed-hash-refused','',invoke=call.replace("encode(extensions.digest(convert_to(smarter_private.tournament_abort_hand_image('"+PERMIT+"')::text,'UTF8'),'sha256'),'hex')","repeat('0',64)"))
  refuse('browser-cannot-certify',"SELECT set_config('request.jwt.claim.role','authenticated',true);",'42501')
  refuse('changed-roster-refused',"UPDATE public.table_seats SET stack=999 WHERE table_id='"+TABLE+"';")
  refuse('false-absence-refused','', 'P0404',call.replace('"physical_engine_absent": true','"physical_engine_absent": false'))
  refuse('retained-disposition-refused',"INSERT INTO smarter_private.hand_continuation_dispositions VALUES('"+TABLE+"',51496617,'retained');")
  sql_file(e,db,'explicit-cancellation-rollback-replay',scene+"""
DO $$DECLARE first jsonb;again jsonb;image jsonb;hash text;before_money jsonb;BEGIN
 image:=smarter_private.tournament_abort_hand_image('"""+PERMIT+"""');hash:=encode(extensions.digest(convert_to(image::text,'UTF8'),'sha256'),'hex');
 before_money:=smarter_private.tournament_abort_money_snapshot('"""+EVENT+"""');
 first:="""+call+""";
 again:=public.fn_ca_cancel_tournament_abort_unsettled_hand('"""+OP+"""','"""+EVENT+"""','"""+TABLE+"""','"""+GEN+"""','"""+PERMIT+"""',hash,"""+proof+""");
 IF first->>'outcome'<>'aborted_unsettled' OR again->>'replayed'<>'true' OR first->>'receipt_id'<>again->>'receipt_id'
 OR (SELECT count(*) FROM smarter_private.tournament_abort_hand_dispositions)<>1
 OR NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions WHERE original=image)
 OR before_money IS DISTINCT FROM smarter_private.tournament_abort_money_snapshot('"""+EVENT+"""') THEN RAISE EXCEPTION 'explicit disposition changed original economics or replay';END IF;
 PERFORM public.fn_ca_ack_tournament_abort_boundary('"""+OP+"""','"""+EVENT+"""','"""+TABLE+"""','"""+GEN+"""',51496617,"""+proof+""");
 IF NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets WHERE tournament_id='"""+EVENT+"""' AND state='quiesced') THEN RAISE EXCEPTION 'absence did not reach canonical quiescence';END IF;
END$$;ROLLBACK;
DO $$BEGIN IF EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions) THEN RAISE EXCEPTION 'rollback left disposition';END IF;END$$;
""")
  # A retained capsule is archived unchanged, including prehand chips that
  # differ from the exact current chair/registration image.
  retained="INSERT INTO smarter_private.hand_continuations(table_id,hand_number,tournament_id,permit_id,original_generation,writer_generation,sequence,payload,payload_sha256) SELECT '"+TABLE+"',51496617,'"+EVENT+"','"+PERMIT+"',h.generation,'"+GEN+"',0,j::text,encode(extensions.digest(convert_to(j::text,'UTF8'),'sha256'),'hex') FROM smarter_private.f06_hand_permits h CROSS JOIN LATERAL (SELECT jsonb_build_object('version',1,'original',jsonb_build_object('tournament_id',h.tournament_id::text,'table_id',h.table_id::text,'permit_id',h.permit_id::text,'lease_generation',h.generation::text,'custody_id',h.custody_id::text,'lifecycle',h.lifecycle::text,'hand_number',h.hand_number::text),'seats',(SELECT jsonb_agg(jsonb_build_object('seat_id',a.id::text,'user_id',a.user_id::text,'stack_before',1500)) FROM public.table_seats a WHERE a.table_id=h.table_id AND a.left_at IS NULL),'batch',jsonb_build_object('version',1,'sequence',0,'controller','private-native-original','events','[]'::jsonb,'engine','{}'::jsonb))j)q WHERE h.permit_id='"+PERMIT+"';INSERT INTO smarter_private.hand_continuation_dispositions VALUES('"+TABLE+"',51496617,'retained');"
  sql_file(e,db,'retained-private-original-preserved',scene+retained+"DO $$DECLARE captured_image jsonb;BEGIN captured_image:=smarter_private.tournament_abort_hand_image('"+PERMIT+"');PERFORM "+call+";IF NOT EXISTS(SELECT 1 FROM smarter_private.hand_continuations WHERE permit_id='"+PERMIT+"') OR NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions d WHERE d.original=captured_image) THEN RAISE EXCEPTION 'retained original changed';END IF;BEGIN UPDATE smarter_private.hand_continuations SET sequence=sequence+1 WHERE permit_id='"+PERMIT+"';RAISE EXCEPTION 'late writer allowed';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;BEGIN UPDATE smarter_private.hand_continuations SET table_id=gen_random_uuid() WHERE permit_id='"+PERMIT+"';RAISE EXCEPTION 'archived identity moved';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;END$$;ROLLBACK;")
  park="SET LOCAL session_replication_role=replica;INSERT INTO smarter_private.f06_operations(break_id,tournament_id,source_table_id,lifecycle,boundary_id,origin_generation) VALUES('6c0cf564-ba29-471e-8dc1-cace3d44da83','"+EVENT+"','"+TABLE+"',1,gen_random_uuid(),'6f7a7167-7195-4581-a78e-268282eafbd2');SET LOCAL session_replication_role=origin;"
  refuse('begun-park-refused',park+"SET LOCAL session_replication_role=replica;UPDATE smarter_private.f06_operations SET state='begun',revision=1;SET LOCAL session_replication_role=origin;")
  refuse('claimed-park-refused',park+"SET LOCAL session_replication_role=replica;UPDATE smarter_private.f06_operations SET custody_id=gen_random_uuid();SET LOCAL session_replication_role=origin;")
  sql_file(e,db,'unbegun-park-archived-atomically',scene+retained+park+"DO $$DECLARE before_park jsonb;BEGIN SELECT to_jsonb(o) INTO STRICT before_park FROM smarter_private.f06_operations o WHERE break_id='6c0cf564-ba29-471e-8dc1-cace3d44da83';PERFORM "+call+";IF NOT EXISTS(SELECT 1 FROM smarter_private.f06_operations WHERE break_id='6c0cf564-ba29-471e-8dc1-cace3d44da83' AND state='withdrawn_before_manifest') OR NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions d WHERE d.original->'parks' @> jsonb_build_array(before_park)) THEN RAISE EXCEPTION 'park lost original disposition';END IF;END$$;ROLLBACK;")
  # The three production missing-capsule identities remain UNKNOWN originals.
  # Each is exercised in the same isolated funded event/table fixture.
  for label,permit,hand in [('second-missing','f5791e52-a01d-4662-9140-7ce4c3a4d0ab',51935598),('third-missing','28098ba3-6c0a-4eac-8ba3-e75a8ad6a5bb',53039952)]:
   case=(scene+"SELECT "+call+";DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM smarter_private.f06_hand_permits WHERE permit_id='"+PERMIT+"' AND state='aborted_unsettled') THEN RAISE EXCEPTION 'unknown original relabelled';END IF;END$$;ROLLBACK;").replace(PERMIT,permit).replace('51496617',str(hand))
   sql_file(e,db,label+'-explicit-cancellation',case)
  # Two actual database sessions: a current atomic writer owns the same table
  # lock first, so the cancellation cannot race past its unresolved result.
  sql_file(e,db,'committed-isolated-race-scene',scene+'COMMIT;')
  concurrent=module(ROOT/'scripts/ci/test-tournament-cancellation-lane.py','closure_concurrent')
  sql_file(e,db,'historical-atomic-retention-seed',"INSERT INTO public.hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result) VALUES('"+TABLE+"',51496616,gen_random_uuid(),repeat('b',64),'{}');")
  left=concurrent.Session(e,db);right=concurrent.Session(e,db)
  try:
   left.query("BEGIN;SELECT id FROM public.tables WHERE id='"+TABLE+"' FOR UPDATE;")
   right.query('BEGIN;'+SERVICE+authority+"DO $$DECLARE refused boolean:=false;BEGIN BEGIN PERFORM "+call+";EXCEPTION WHEN lock_not_available THEN refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'racing writer admitted cancellation';END IF;END$$;")
  finally:left.close();right.close()
  left=concurrent.Session(e,db);right=concurrent.Session(e,db)
  try:
   left.query('BEGIN;'+SERVICE+authority+'SELECT '+call+';')
   right.send("BEGIN;SET LOCAL application_name='closure_waiting_atomic';DO $$DECLARE refused boolean:=false;BEGIN BEGIN INSERT INTO public.hand_atomic_commits(table_id,hand_number,hand_id,payload_hash,stack_result) VALUES('"+TABLE+"',51496617,gen_random_uuid(),repeat('a',64),'{}');EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM<>'TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR' THEN RAISE;END IF;refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'late atomic accepted';END IF;END$$;")
   deadline=time.monotonic()+5
   while time.monotonic()<deadline:
    _,waiting,_=e.sql(db,"SELECT count(*) FROM pg_stat_activity WHERE application_name='closure_waiting_atomic' AND wait_event_type='Lock';",label='waiting-atomic-proof')
    if waiting.strip()=='1':break
    time.sleep(.02)
   else:raise AssertionError('late atomic writer did not wait on genuine table lock')
   left.query('COMMIT;');right.read();right.query('ROLLBACK;')
   _,out,_=e.sql(db,"SELECT count(*) FROM public.hand_atomic_commits WHERE table_id='"+TABLE+"' AND hand_number=51496617;",label='late-atomic-not-committed');assert out.strip()=='0'
  finally:left.close();right.close()
  sql_file(e,db,'historical-retention-remains-available',"BEGIN;DELETE FROM public.hand_atomic_commits WHERE table_id='"+TABLE+"' AND hand_number=51496616;DO $$BEGIN IF EXISTS(SELECT 1 FROM public.hand_atomic_commits WHERE table_id='"+TABLE+"' AND hand_number=51496616) OR NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_hand_dispositions WHERE permit_id='"+PERMIT+"') THEN RAISE EXCEPTION 'retention did not preserve archival authority';END IF;END$$;ROLLBACK;")
  e.report['cases']=['browser-refused','changed-roster-refused','false-absence-refused','retained-disposition-refused','explicit-cancellation-retains-original','same-operation-replay','canonical-absence-ack','whole-transaction-rollback']
  e.report['cases']=[c['label'] for c in e.report['commands'] if c.get('exit_code')==0]
  e.report['source_sha256'][str(MIGRATION.relative_to(ROOT))]=hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
  e.report['passed']=True;e.report['status']='passed'
 finally:
  e.close();(a.evidence/'closure-boundary-report.json').write_text(json.dumps(e.report,indent=2)+'\n')
if __name__=='__main__':main()
