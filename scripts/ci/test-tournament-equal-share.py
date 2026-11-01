#!/usr/bin/env python3
"""Actual atomic equal-share closure, on a disposable socket-only PostgreSQL."""
import argparse,json,sys,hashlib
from pathlib import Path
sys.dont_write_bytecode=True
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
from tournament_abort_native import install_f06_extension,sql_file,prepare_quiesced,SERVICE
from tournament_abort_registry_native import install_and_reproduce_registry_guard
ROOT=Path(__file__).resolve().parents[2]
ABORT=ROOT/'supabase/migrations/20261030161824_started_tournament_abort_uses_original_charges_and_a_drained.sql'
MIGRATION=ROOT/'supabase/migrations/20261101004247_started_tournament_abort_supports_equal_share_settlement.sql'
RETIREMENT=ROOT/'supabase/migrations/20261101174851_equal_share_retirement_preserves_preactivation_mystery_bount.sql'
def main():
 p=argparse.ArgumentParser();p.add_argument('--evidence',type=Path,required=True);p.add_argument('--work-root',type=Path,required=True);p.add_argument('--socket-root',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
 a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=False);a.work_root.mkdir(parents=True,exist_ok=True);a.socket_root.mkdir(parents=True,exist_ok=True)
 native=module(ROOT/'scripts/ci/test-mtt-unlimited.py','equal_native');e=native.Execution(ROOT,a.evidence,a.pg_bin,a.work_root,600,socket_parent=a.socket_root)
 try:
  e.start();db=e.database();install_financial_foundation(e,db,ROOT,a.evidence);install_f06_extension(e,db,ROOT)
  diamond=module(ROOT/'scripts/ci/fixtures/tournament-abort/diamond/diamond_abort_native.py','equal_diamond');diamond.install_diamond_extension(e,db,ROOT)
  dependencies=ROOT/'scripts/ci/fixtures/tournament-equal-share/current-fee-dependencies.json'
  catalog=json.loads(dependencies.read_text());ddl='SET check_function_bodies=off;'
  for r in catalog['relations']:
   columns=['"'+c['name']+'" '+c['type']+(' NOT NULL' if c['notnull'] else '')+(' DEFAULT '+c['default'] if c['default'] and 'nextval(' not in c['default'] else '') for c in r['columns']]
   constraints=[c['definition'] for c in r['constraints'] or [] if c['kind'] in ('p','u','c')]
   ddl+='CREATE TABLE IF NOT EXISTS public.'+r['relation'].removeprefix('public.')+'('+','.join(columns+constraints)+');'
  for f in catalog['functions']:
   assert hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5'];ddl+=f['definition']+';'
  sql_file(e,db,'current-fee-owner-empty-legacy-catalog',ddl)
  e.report['source_sha256'][str(dependencies.relative_to(ROOT))]=hashlib.sha256(dependencies.read_bytes()).hexdigest()
  captured=ROOT/'scripts/ci/fixtures/tournament-equal-share/current-financial-owners.json'
  for f in json.loads(captured.read_text()):
   assert hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5']
   sql_file(e,db,'current-'+f['signature'].split('(')[0],f['definition']+';')
  e.report['source_sha256'][str(captured.relative_to(ROOT))]=hashlib.sha256(captured.read_bytes()).hexdigest()
  install_and_reproduce_registry_guard(e,db,ROOT,ABORT);e.sql(db,file=ABORT,label='exact-abort-foundation')
  recovery=ROOT/'supabase/migrations/20261031161513_tournament_original_twenty_can_withdraw_unsettled_abort.sql'
  # Exact private recovered-disposition relation/guard; no production rows.
  sql_file(e,db,'actual-recovered-disposition-guard',recovery.read_text().split('CREATE FUNCTION smarter_private.tournament_recovery_original_custody')[0]+'COMMIT;')
  originals=['public.fn_ca_settle_tournament_abort(uuid,uuid,text)','smarter_private.tournament_abort_receipt(uuid,uuid)']
  original_query="SELECT jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) FROM unnest(ARRAY["+','.join("'"+x+"'" for x in originals)+"]) signature;"
  _,originals_before,_=e.sql(db,original_query,label='v3-owners-before')
  e.sql(db,file=MIGRATION,label='exact-equal-share-migration')
  from closure_boundary_fixture import install_closure_boundary
  install_closure_boundary(e,db,ROOT)
  _,postimages,_=e.sql(db,"SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','smarter_private') AND p.proname IN ('fn_ca_preview_tournament_abort_equal_share','fn_ca_settle_tournament_abort_equal_share','tournament_equal_share_receipt','equal_share_retirement_must_close','fn_refuse_zero_chip_field_elimination','fn_credit_and_log','fn_ca_tournament_cancellation_receipt');",label='equal-share-installed-postimages')
  e.report['postimages']=json.loads(postimages.strip())
  proof=next(line.removeprefix('-- @live-proof: ') for line in MIGRATION.read_text().splitlines() if line.startswith('-- @live-proof: '))
  _,proof_result,_=e.sql(db,'SELECT '+proof+';',label='equal-share-exact-live-proof')
  assert proof_result.strip()=='t'
  _,originals_after,_=e.sql(db,original_query,label='v3-owners-after')
  assert originals_before==originals_after

  seed=(ROOT/'scripts/ci/probes/satellite-cancel-current-native.sql').read_text().split('-- Fund the source through')[0].replace('ON COMMIT DROP;','ON COMMIT PRESERVE ROWS;')
  earning=(ROOT/'tests/fixtures/tournament-fee-lifecycle/full-lifecycle-earning.sql').read_text()
  agreements=earning[earning.index('INSERT INTO public.club_wallets(club_id)'):earning.index('SET LOCAL session_replication_role=origin;',earning.index('INSERT INTO public.club_wallets(club_id)'))]
  seed=seed.replace('SET LOCAL session_replication_role=origin;',agreements+'SET LOCAL session_replication_role=origin;',1)
  sql_file(e,db,'real-chip-registration',"BEGIN;INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES('chip_retirement','noncirculating',NULL,'retirement holding') ON CONFLICT(store) DO NOTHING;"+seed+'COMMIT;')
  event='d3000000-0000-4000-8000-000000000002';op='ac000000-0000-4000-8000-000000000001';table='ad000000-0000-4000-8000-000000000001'
  sql_file(e,db,'second-funded-entry-and-prior-award',"BEGIN;SELECT set_config('request.jwt.claims','{\"sub\":\"d1000000-0000-4000-8000-000000000002\",\"role\":\"authenticated\",\"session_id\":\"d4000000-0000-4000-8000-000000000003\"}',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);SET LOCAL ROLE authenticated;SELECT public.fn_register_for_tournament_request('"+event+"','ec000000-0000-4000-8000-000000000001');RESET ROLE;"+SERVICE+"SELECT public.fn_credit_and_log('d1000000-0000-4000-8000-000000000001',0.01,'tourney:"+event+":native-earlier-award','prize','Native earlier paid award preserved','"+event+"','PLAYER',NULL,NULL,NULL,'reconcile');COMMIT;")
  sql_file(e,db,'local-playing-scene',"BEGIN;SET LOCAL session_replication_role=replica;UPDATE tournament_players SET status='playing' WHERE tournament_id='"+event+"';COMMIT;")
  from equal_share_mystery_retirement import seed as seed_mystery, qualify as qualify_mystery, verify as verify_mystery
  seed_mystery(e,db,event)
  money_hash=prepare_quiesced(e,db,event,op,table)
  qualify_mystery(e,db,ROOT,event,op,money_hash,RETIREMENT)
  from equal_share_native_cases import exercise,diamond_cases,capacity_case
  receipt=exercise(e,db,ROOT,event,op,money_hash,'chip',[90,89.99],20)
  verify_mystery(e,db,event,receipt)
  diamond_cases(e,db,ROOT,diamond)
  capacity_case(e,db,ROOT)
  _,postimages,_=e.sql(db,"SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','smarter_private') AND p.proname IN ('fn_ca_preview_tournament_abort_equal_share','fn_ca_settle_tournament_abort_equal_share','tournament_equal_share_receipt','equal_share_retirement_must_close','fn_refuse_zero_chip_field_elimination','fn_credit_and_log','fn_ca_tournament_cancellation_receipt');",label='equal-share-qualified-postimages')
  e.report['postimages']=json.loads(postimages.strip())
  e.report['source_sha256'].update({str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [MIGRATION,Path(__file__),ROOT/'scripts/ci/equal_share_native_cases.py',ROOT/'tests/fixtures/tournament-fee-lifecycle/full-lifecycle-earning.sql']})
  e.report['source_sha256'].update({str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [RETIREMENT,ROOT/'scripts/ci/equal_share_mystery_retirement.py']})
  e.report['passed']=True;e.report['status']='passed'
 finally:
  e.close();(a.evidence/'equal-share-report.json').write_text(json.dumps(e.report,indent=2)+'\n')
if __name__=='__main__':main()
