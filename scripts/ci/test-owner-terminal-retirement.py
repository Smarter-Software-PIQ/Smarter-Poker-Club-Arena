#!/usr/bin/env python3
"""Exact owner-directed terminal custody disposition on isolated PostgreSQL."""
import argparse,json,sys,hashlib
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
from tournament_abort_native import install_f06_extension,sql_file,prepare_quiesced,SERVICE
from tournament_abort_registry_native import install_and_reproduce_registry_guard
ROOT=Path(__file__).resolve().parents[2]
ABORT=ROOT/'supabase/migrations/20261030161824_started_tournament_abort_uses_original_charges_and_a_drained.sql'
MIGRATION=ROOT/'supabase/migrations/20261101004247_started_tournament_abort_supports_equal_share_settlement.sql'
RETIREMENT=ROOT/'supabase/migrations/20261101174851_equal_share_retirement_preserves_preactivation_mystery_bount.sql'

def management_postimages(e,db):
 _,out,_=e.sql(db,"SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition_md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text)) FROM pg_proc p WHERE p.oid IN ('public.fn_ca_settle_tournament_abort(uuid,uuid,text)'::regprocedure,'public.fn_guard_managed_game_lifecycle()'::regprocedure,'smarter_private.equal_share_retirement_must_close()'::regprocedure);",label='management-postimages')
 e.report['management_postimages']=json.loads(out.strip())

def main():
 p=argparse.ArgumentParser();p.add_argument('--management-retirement',action='store_true');p.add_argument('--management-refund',action='store_true');p.add_argument('--human-refund',action='store_true');p.add_argument('--manual-refund',action='store_true');p.add_argument('--evidence',type=Path,required=True);p.add_argument('--work-root',type=Path,required=True);p.add_argument('--socket-root',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
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
  if a.management_refund:
   # Install the exact current payer definition and its unchanged manifest guard.
   manifest=(ROOT/'supabase/migrations/20261102152756_owner_tournament_deletion_replaces_equal_share_intent.sql').read_text().split('DO $$BEGIN')[0]+'COMMIT;'
   sql_file(e,db,'current-original-manifest',manifest)
   source=ROOT/'supabase/migrations/20261102155242_owner_retirement_refuses_superseded_original_refund.sql'
   definition=source.read_text().split('CREATE OR REPLACE FUNCTION public.fn_ca_settle_tournament_abort',1)[1].split('DO $$BEGIN IF clock_timestamp()',1)[0]
   sql_file(e,db,'current-original-abort-payer','CREATE OR REPLACE FUNCTION public.fn_ca_settle_tournament_abort'+definition)
   e.report['source_sha256'][str(source.relative_to(ROOT))]=hashlib.sha256(source.read_bytes()).hexdigest()
   guards=ROOT/'scripts/ci/fixtures/tournament-abort/management-current-guards.json'
   for f in json.loads(guards.read_text()):
    assert hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5']
    sql_file(e,db,'current-management-'+f['signature'].split('(')[0],f['definition'])
   e.report['source_sha256'][str(guards.relative_to(ROOT))]=hashlib.sha256(guards.read_bytes()).hexdigest()
   from additional_five_refund_native import qualify
   qualify(e,db,ROOT,management=True)
   management_postimages(e,db)
   e.report['status']='passed'
   return 0
  _,postimages,_=e.sql(db,"SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','smarter_private') AND p.proname IN ('fn_ca_preview_tournament_abort_equal_share','fn_ca_settle_tournament_abort_equal_share','tournament_equal_share_receipt','equal_share_retirement_must_close','fn_refuse_zero_chip_field_elimination','fn_credit_and_log','fn_ca_tournament_cancellation_receipt');",label='equal-share-installed-postimages')
  e.report['postimages']=json.loads(postimages.strip())
  if a.human_refund:
   from additional_five_refund_native import qualify
   qualify(e,db,ROOT)
  proof=next(line.removeprefix('-- @live-proof: ') for line in MIGRATION.read_text().splitlines() if line.startswith('-- @live-proof: '))
  _,proof_result,_=e.sql(db,'SELECT '+proof+';',label='equal-share-exact-live-proof')
  assert proof_result.strip()=='t'
  _,originals_after,_=e.sql(db,original_query,label='v3-owners-after')
  assert originals_before==originals_after

  e.sql(db,file=RETIREMENT,label='actual-current-retirement-guard')
  prefix=(ROOT/'supabase/migrations/20261102152756_owner_tournament_deletion_replaces_equal_share_intent.sql').read_text().split('DO $$BEGIN')[0]+'COMMIT;'
  sql_file(e,db,'fixed-owner-manifest',prefix)
  e.sql(db,file=ROOT/'supabase/migrations/20261102161821_owner_retirement_main_bank_funds_exact_player_refunds.sql',label='bank-refund-dependency')
  # Preserve the concurrently installed promo-funded bounty reader dependency.
  promo=(ROOT/'supabase/migrations/20261102154336_midway_promo_funded_bounty_only_free_buys.sql').read_text()
  promo=promo[promo.index('CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_pko('):promo.index('CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_promo_head(')]
  sql_file(e,db,'actual-promo-bounty-reader-dependency',promo)
  for f in json.loads((ROOT/'scripts/ci/fixtures/tournament-abort/owner-terminal-current-catalog.json').read_text()):
   assert hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5']
   sql_file(e,db,'exact-preimage-'+f['signature'].split('(')[0],f['definition']+';')
  e.sql(db,file=(ROOT/'supabase/migrations/20261102180105_owner_retirement_transfers_custody_and_closes_exact_events.sql'),label='owner-terminal-draft')
  if a.management_retirement:
   guards=ROOT/'scripts/ci/fixtures/tournament-abort/management-current-guards.json'
   for f in json.loads(guards.read_text()):
    assert hashlib.md5(f['definition'].encode()).hexdigest()==f['definition_md5']
    sql_file(e,db,'current-management-'+f['signature'].split('(')[0],f['definition'])
   e.report['source_sha256'][str(guards.relative_to(ROOT))]=hashlib.sha256(guards.read_bytes()).hexdigest()
   source=ROOT/'supabase/migrations/20261102155242_owner_retirement_refuses_superseded_original_refund.sql'
   definition=source.read_text().split('CREATE OR REPLACE FUNCTION public.fn_ca_settle_tournament_abort',1)[1].split('DO $$BEGIN IF clock_timestamp()',1)[0]
   sql_file(e,db,'current-original-abort-payer','CREATE OR REPLACE FUNCTION public.fn_ca_settle_tournament_abort'+definition)
   migration=ROOT/'supabase/migrations/20261103133529_original_abort_allows_genuine_management_rollback_proof.sql'
   e.sql(db,file=migration,label='exact-management-migration')
   e.report['source_sha256'][str(migration.relative_to(ROOT))]=hashlib.sha256(migration.read_bytes()).hexdigest()
   e.report['genuine_management_retirement']=True
  diamond.seed(e,db)
  manifest=json.loads((ROOT/'scripts/ci/fixtures/tournament-abort/owner-retirement-nov2-manifest.json').read_text())
  target=next(x for x in manifest['targets'] if x['asset']=='diamonds')
  event=target['tournament_id'];op='ac000000-0000-4000-8000-000000000001';table='ad000000-0000-4000-8000-000000000001'
  sql_file(e,db,'local-kingfish-identity',"BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO auth.users(id) VALUES('47965354-0e56-43ef-931c-ddaab82af765');INSERT INTO public.profiles(id,username,display_name,diamonds,diamond_balance) VALUES('47965354-0e56-43ef-931c-ddaab82af765','kingfish','Local recipient fixture',0,0);COMMIT;")
  sql_file(e,db,'real-diamond-funding',diamond.event_sql(event,'Native owner retirement')+diamond.charge(diamond.U1,event,'entry',20,18,2,'native-owner-entry-one')+diamond.charge(diamond.U2,event,'entry',20,18,2,'native-owner-entry-two')+'COMMIT;')
  sql_file(e,db,'original-manifest-start',"BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.profiles SET is_horse=true WHERE id IN ('da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002');UPDATE public.tournaments SET started_at=(SELECT original_started_at FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id='"+event+"') WHERE id='"+event+"';COMMIT;")
  money_hash=prepare_quiesced(e,db,event,op,table)
  cases=module((ROOT/'scripts/ci/owner_terminal_native_cases.py'),'owner_cases')
  cases.exercise(e,db,event,op,money_hash,40,4,'diamonds')
  cases.chips(e,db,ROOT,manifest,a.human_refund or a.manual_refund,a.manual_refund)
  target=[x for x in manifest['targets'] if x['asset']=='diamonds'][1]
  event=target['tournament_id'];op='ac000000-0000-4000-8000-000000000003';table='ad000000-0000-4000-8000-000000000003'
  sql_file(e,db,'funded-prior-diamond-awards',diamond.event_sql(event,'Native prior awards retained').replace(',18,2,1000,',',28,2,1000,')+diamond.charge(diamond.U1,event,'entry',30,18,2,'native-owner-bounty-one').replace(',30,18,0,2,',',30,18,10,2,')+diamond.charge(diamond.U2,event,'entry',30,18,2,'native-owner-bounty-two').replace(',30,18,0,2,',',30,18,10,2,')+'COMMIT;BEGIN;'+SERVICE+"SELECT public.fn_poker_diamond_tournament_pay('"+diamond.U1+"',5,'owner-native-prior-prize','prize','"+event+"','Prior award');SELECT public.fn_poker_diamond_tournament_pay('"+diamond.U2+"',3,'owner-native-prior-bounty','bounty','"+event+"','Prior bounty');COMMIT;")
  sql_file(e,db,'prior-award-original-start',"BEGIN;SET LOCAL session_replication_role=replica;UPDATE public.tournaments SET started_at=(SELECT original_started_at FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id='"+event+"') WHERE id='"+event+"';COMMIT;")
  money_hash=prepare_quiesced(e,db,event,op,table)
  cases.exercise(e,db,event,op,money_hash,52,4,'diamonds-prior-awards')

  proof=next(line.removeprefix('-- @live-proof: ') for line in (ROOT/'supabase/migrations/20261102180105_owner_retirement_transfers_custody_and_closes_exact_events.sql').read_text().splitlines() if line.startswith('-- @live-proof: '))
  _,live,_=e.sql(db,'SELECT '+proof+';',label='owner-exact-install-proof')
  assert live.strip()=='t'
  _,post,_=e.sql(db,"SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition_md5',md5(pg_get_functiondef(p.oid)),'prosrc_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname IN ('public','smarter_private') AND p.proname IN ('fn_ca_record_owner_manual_refund','owner_manual_refund_receipt','fn_ca_owner_retirement_bank_refund','fn_ca_owner_retire_tournament','owner_retirement_transfer_pools','owner_retirement_receipt','owner_retirement_transfer_must_close','owner_retirement_pool_transfer_immutable','fn_ca_tournament_escrow_chips','fn_poker_diamond_tournament_escrow','fn_settle_tournament_rake','fn_ca_tournament_cancellation_receipt','fn_refuse_zero_chip_field_elimination','equal_share_retirement_must_close'));",label='owner-exact-postimages')
  e.report['owner_postimages']=json.loads(post.strip())
  sql_file(e,db,'captured-reader-privileges-retained',"DO $$DECLARE sig text;BEGIN FOREACH sig IN ARRAY ARRAY['public.fn_ca_tournament_escrow_chips(uuid)','public.fn_poker_diamond_tournament_escrow(uuid)','public.fn_ca_tournament_cancellation_receipt(uuid,uuid)'] LOOP IF has_function_privilege('anon',sig,'EXECUTE') OR has_function_privilege('authenticated',sig,'EXECUTE') OR has_function_privilege('service_role',sig,'EXECUTE') IS DISTINCT FROM (sig<>'public.fn_ca_tournament_cancellation_receipt(uuid,uuid)') THEN RAISE EXCEPTION 'reader privileges changed:%',sig;END IF;END LOOP;END$$;")
  if a.management_retirement:management_postimages(e,db)
  e.report['status']='passed'
 except BaseException as err:e.report['failure']=repr(err);print(repr(err),flush=True)
 finally:
  e.close();(a.evidence/'result.json').write_text(json.dumps(e.report,indent=2));print(json.dumps({k:e.report.get(k) for k in ('status','failure','cleanup')}))
 return 0 if e.report.get('status')=='passed' else 1
if __name__=='__main__':sys.exit(main())
