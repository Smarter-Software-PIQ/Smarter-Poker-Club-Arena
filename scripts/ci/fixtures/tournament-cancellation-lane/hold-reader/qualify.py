#!/usr/bin/env python3
"""Actual hold reader and enabled production grant guard, in private PostgreSQL17."""
import argparse, hashlib, json, sys
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT/'scripts/ci'))
from satellite_qualifier_fixture import module

def main():
 p=argparse.ArgumentParser()
 for name in ['evidence','work-root','socket-root','pg-bin']: p.add_argument('--'+name,type=Path,required=True)
 a=p.parse_args()
 a.evidence.mkdir(parents=True,exist_ok=False);a.work_root.mkdir(parents=True,exist_ok=True);a.socket_root.mkdir(parents=True,exist_ok=True)
 native=module(ROOT/'scripts/ci/test-mtt-unlimited.py','hold_reader_execution')
 e=native.Execution(ROOT,a.evidence,a.pg_bin,a.work_root,120,socket_parent=a.socket_root)
 capture=Path(__file__).with_name('installed-preimage.json'); data=json.loads(capture.read_text())
 migration=next((ROOT/'supabase/migrations').glob('*_tournament_hold_reader_matches_authenticated_consumers.sql'))
 try:
  e.start();db=e.database()
  e.sql(db,"CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('request.jwt.claim.role',true)$$;GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;CREATE TABLE public.ca_tournament_start_hold(singleton boolean PRIMARY KEY,blocked boolean,reason text,requested_at timestamptz);INSERT INTO public.ca_tournament_start_hold VALUES(true,true,'synthetic qualification hold','2026-11-02T20:31:18Z');CREATE TABLE public.privileged_function_lock(function_signature text PRIMARY KEY,security_definer boolean NOT NULL,reason text NOT NULL,locked_at timestamptz NOT NULL DEFAULT now());",label='isolated-context')
  for row in data['functions']:
   assert hashlib.md5(row['definition'].encode()).hexdigest()==row['md5']
   e.sql(db,row['definition']+';',label='captured-'+row['signature'].split('(')[0])
  lock=data['locks'][0]; assert lock['function_signature']=='public.fn_get_tournament_start_hold_status()' and lock['security_definer'] is True
  reason=lock['reason'].replace("'","''"); locked_at=lock['locked_at'].replace("'","''")
  e.sql(db,"INSERT INTO public.privileged_function_lock VALUES('public.fn_get_tournament_start_hold_status()',true,'"+reason+"','"+locked_at+"');CREATE EVENT TRIGGER trg_autorevoke_privileged_anon ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION','ALTER FUNCTION','GRANT') EXECUTE FUNCTION public.fn_autorevoke_privileged_anon();GRANT EXECUTE ON FUNCTION public.fn_get_tournament_start_hold_status() TO anon,authenticated,service_role;",label='enabled-original-grant-guard')
  _,baseline,_=e.sql(db,"SELECT has_function_privilege('anon','public.fn_get_tournament_start_hold_status()','EXECUTE');",label='old-three-role-proof-fails')
  assert baseline.strip()=='f'
  snapshot="SELECT jsonb_build_object('hold',(SELECT jsonb_agg(to_jsonb(h)) FROM public.ca_tournament_start_hold h),'lock',(SELECT jsonb_agg(to_jsonb(l)) FROM public.privileged_function_lock l),'guard',md5(pg_get_functiondef('public.fn_autorevoke_privileged_anon()'::regprocedure)),'enabled',(SELECT evtenabled FROM pg_event_trigger WHERE evtname='trg_autorevoke_privileged_anon'));"
  _,before,_=e.sql(db,snapshot,label='before')
  e.sql(db,file=migration,label='exact-forward-migration')
  _,after,_=e.sql(db,snapshot,label='after');assert before==after
  proof=next(x.removeprefix('-- @live-proof: ') for x in migration.read_text().splitlines() if x.startswith('-- @live-proof: '))
  _,proof_result,_=e.sql(db,'SELECT '+proof+';',label='declared-live-proof');assert proof_result.strip()=='t'
  for role in ['authenticated','service_role']:
   _,value,_=e.sql(db,"SET ROLE "+role+";SET request.jwt.claim.role='"+role+"';SELECT public.fn_get_tournament_start_hold_status();",label='actual-'+role+'-reader')
   row=json.loads(value.strip());assert row['blocked'] is True and row['reason']=='synthetic qualification hold' and 'Will Reopen After Verification Is Complete.' in row['popup_message']
  code,_,error=e.sql(db,"SET ROLE anon;SET request.jwt.claim.role='authenticated';SELECT public.fn_get_tournament_start_hold_status();",label='anon-refused-even-with-spoofed-claim',check=False)
  assert code!=0 and 'permission denied for function fn_get_tournament_start_hold_status' in error
  e.sql(db,"UPDATE public.ca_tournament_start_hold SET blocked=false;",label='synthetic-release')
  _,released,_=e.sql(db,"SET ROLE authenticated;SET request.jwt.claim.role='authenticated';SELECT public.fn_get_tournament_start_hold_status();",label='released-reader');assert json.loads(released.strip())['popup_message'] is None
  e.sql(db,'DELETE FROM public.ca_tournament_start_hold;',label='synthetic-absent')
  _,absent,_=e.sql(db,"SET ROLE authenticated;SET request.jwt.claim.role='authenticated';SELECT public.fn_get_tournament_start_hold_status();",label='absent-reader');assert json.loads(absent.strip())['blocked'] is False
  e.report.update(passed=True,status='passed',cases=['baseline-three-role-proof-false','exact-forward-install','unchanged-hold-lock-guard','declared-live-proof','authenticated-read','service-read','anon-spoof-refused','released-read','absent-read'])
  for path in [Path(__file__),capture,migration]: e.report['source_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
 finally:
  e.close();(a.evidence/'hold-reader-report.json').write_text(json.dumps(e.report,indent=2)+'\n')
if __name__=='__main__':main()
