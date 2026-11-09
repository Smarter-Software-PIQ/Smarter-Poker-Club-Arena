#!/usr/bin/env python3
"""Qualify reusable satellite awards in the existing isolated financial catalog.

No remote connection option or production write. Core settlement, receipt,
entry, escrow, custody, journal and immutable guards are actual owning SQL.
"""
from pathlib import Path
from types import SimpleNamespace
import argparse,json,os,re,sys,hashlib
sys.dont_write_bytecode=True
from satellite_qualifier_fixture import compose,module,function_sql
from satellite_value_ticket_concurrency import qualify as qualify_concurrent_consumption

def qualify_capped_recovery(e,root,output,db,opening):
 # Commit/reconnect proof owns a disposable clone; later scenes retain their pristine catalog.
 db=e.database(template=db)
 # The original durable reader and financial catalog are unchanged dependencies.
 durable=(root/'supabase/migrations/20261103115836_terminal_original_request_is_durable_before_settlement.sql').read_text()
 table=re.search(r'CREATE TABLE smarter_private\.tournament_terminal_requests \(.*?\n\);',durable,re.S).group()
 e.sql(db,table,label='capped-recovery-original-request-relation')
 for name in ['smarter_private.lock_terminal_request_lane','smarter_private.resolve_terminal_request','public.fn_resolve_tournament_terminal_request']:
  definition=re.search(r'CREATE FUNCTION '+re.escape(name)+r'\(.*?END \$f\$;',durable,re.S).group()
  e.sql(db,definition,label='capped-recovery-original-'+name)
 scene=output/'capped-recovery-opening.sql'
 scene.write_text(opening+(root/'tests/fixtures/satellite-value-awards/capped-recovery-cases.sql').read_text())
 e.sql(db,file=scene,label='capped-recovery-funded-original',seconds=120)
 snapshot="SELECT jsonb_build_object('receipt',(SELECT to_jsonb(s) FROM public.tournament_satellite_settlements s WHERE s.tournament_id=x.tournament_id),'payouts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tournament_payouts p WHERE p.tournament_id=x.tournament_id),'entitlements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.position) FROM public.tournament_satellite_entitlements t WHERE t.tournament_id=x.tournament_id)) FROM capped_recovery_subject x;"
 _,money_before,_=e.sql(db,snapshot,label='capped-recovery-immutable-before')
 properties="SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile) ORDER BY oid) FROM pg_proc WHERE oid IN ('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure,'public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure);"
 _,before,_=e.sql(db,properties,label='capped-recovery-metadata-before')
 _,original_reader,_=e.sql(db,"SELECT pg_get_functiondef('public.fn_ca_satellite_cohort_receipt(uuid,uuid[])'::regprocedure);",label='capped-recovery-canonical-reader-source')
 candidate=root/'supabase/migrations/20261109202657_satellite_recovery_returns_the_full_canonical_receipt.sql'
 # Execute the declared deployment predicate, not just its comment string.
 collusion=(root/'supabase/migrations/20260831235700_ca_phase4_cert_segregation_diamond_audit_collusion_v1.sql').read_text()
 definition=re.search(r'CREATE OR REPLACE FUNCTION public\.fn_ca_collusion_scan\(.*?END \$function\$;',collusion,re.S).group()
 e.sql(db,definition,label='capped-recovery-existing-collusion-owner')
 predecessor=root/'supabase/migrations/20261109163346_settle_capped_satellites_and_nov08_digest_v2.sql'
 predicate=re.search(r'^-- @live-proof: (.+)$',predecessor.read_text(),re.M).group(1)
 _,before_budget,_=e.sql(db,'SELECT coalesce('+predicate+',false);',label='capped-recovery-collusion-proof-before')
 if before_budget.strip()!='f':raise ValueError('collusion timeout fixture already has corrected budget')
 e.sql(db,file=predecessor,label='capped-recovery-corrected-predecessor')
 _,after_budget,_=e.sql(db,'SELECT '+predicate+';',label='capped-recovery-collusion-proof-after')
 if after_budget.strip()!='t':raise ValueError('declared collusion timeout live proof did not become true')
 # First deployment order: corrected predecessor leaves the canonical pair intact.
 e.sql(db,"INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261109163346','settle_capped_satellites_and_nov08_digest_v2');",label='capped-recovery-corrected-predecessor-history')
 e.sql(db,file=candidate,label='capped-recovery-canonical-pair-no-op')
 e.sql(db,"DELETE FROM supabase_migrations.schema_migrations WHERE version='20261109163346';",label='capped-recovery-reset-synthetic-history')
 legacy=(root/'tests/fixtures/satellite-value-awards/legacy-capped-projection.sql').read_text()
 # Only the exact proposed reader patch is counterfactual. No legacy payer or
 # historical incident update is executed, even in this disposable catalog.
 e.sql(db,legacy,label='capped-recovery-exact-legacy-reader-patch')
 reader="SET request.jwt.claim.role='service_role'; SELECT public.fn_resolve_tournament_terminal_request((SELECT request_id FROM capped_recovery_subject))->'outcome'->'receipt';"
 _,projected,_=e.sql(db,reader,label='capped-recovery-projected-original-reader')
 projected=json.loads(projected.strip())
 if float(projected['pool'])!=480 or projected['remainder'] is not None:
  raise ValueError('actual legacy no-GUC reader did not project the capped receipt')
 truthful="SET request.jwt.claim.role='service_role'; DO $proof$ DECLARE r jsonb; BEGIN r:=public.fn_resolve_tournament_terminal_request((SELECT request_id FROM capped_recovery_subject))->'outcome'->'receipt'; IF (r->>'pool')::numeric<>1003 OR (r->'remainder'->>'amount')::numeric IS DISTINCT FROM 523 THEN RAISE EXCEPTION 'capped_recovery_lost_the_original_remainder'; END IF; END $proof$;"
 code,_,error=e.sql(db,truthful,label='capped-recovery-original-red',check=False)
 if code==0 or 'capped_recovery_lost_the_original_remainder' not in error:
  raise ValueError('actual original recovery did not fail truthful pool proof')
 code,_,error=e.sql(db,file=candidate,label='capped-recovery-unknown-history-refused',check=False)
 if code==0 or 'satellite_recovery_projection_preimage_changed' not in error:
  raise ValueError('receipt restoration admitted absent legacy history')
 e.sql(db,"INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261109163346','settle_capped_satellites_and_nov08_digest_v2');",label='capped-recovery-known-legacy-history')
 code,_,error=e.sql(db,'BEGIN;\n'+original_reader+';\n'+candidate.read_text(),label='capped-recovery-mixed-pair-refused',check=False)
 if code==0 or 'satellite_recovery_projection_preimage_changed' not in error:
  raise ValueError('receipt restoration admitted mixed canonical/legacy pair')
 e.sql(db,file=candidate,label='capped-recovery-exact-restoration')
 e.sql(db,truthful,label='capped-recovery-new-green')
 # Strict admission after restoration: a request ID is not the v1 capability.
 strict=output/'capped-recovery-strict-owner.sql'
 strict_opening=opening.replace("(SELECT count(*) FROM public.tournaments)<>1", "(SELECT count(*) FROM public.tournaments)<>3")
 strict.write_text(strict_opening+"""DO $negative$ DECLARE x jsonb; q uuid[]; refused boolean:=false; BEGIN
 x:=pg_temp.capped_value_case('strict_recovery',29,false);
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO q FROM jsonb_array_elements_text(x->'qualifier_ids');
 PERFORM set_config('app.satellite_capped_awards','',true);
 PERFORM set_config('app.tournament_terminal_request_id',md5('synthetic request')::uuid::text,true);
 BEGIN PERFORM public.fn_settle_satellite_qualifiers((x->>'tournament_id')::uuid,q);
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM NOT LIKE 'capped satellite awards require a compatible terminal owner%' THEN RAISE; END IF;
  refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'request ID bypassed strict v1 admission'; END IF;
END $negative$; ROLLBACK;
""")
 e.sql(db,file=strict,label='capped-recovery-strict-v1-admission')
 _,restored,_=e.sql(db,reader,label='capped-recovery-full-original-reader')
 restored=json.loads(restored.strip())
 _,after,_=e.sql(db,properties,label='capped-recovery-metadata-after')
 if json.loads(before)!=json.loads(after):raise ValueError('receipt reader metadata changed')
 _,money_after,_=e.sql(db,snapshot,label='capped-recovery-immutable-after')
 if json.loads(money_before)!=json.loads(money_after):raise ValueError('recovery changed original receipt, payouts or entitlements')
 decoder=output/'capped-recovery-receipts.json'
 decoder.write_text(json.dumps({'projected':projected,'restored':restored}))
 script="import fs from 'node:fs'; import {verifySatelliteQualifierReceipt as verify} from './server/src/tournament/satelliteQualifierReceipt'; const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); for(const k of ['projected','restored']){const r=d[k];if(!verify(r,r.tournament_id,r.qualifier_ids))throw Error(k+' receipt was rejected by the actual decoder');} if(d.restored.pool!=1003||d.restored.remainder.amount!=523)throw Error('canonical recovery lost value');"
 e.run('capped-recovery-actual-decoder',[root/'server/node_modules/.bin/tsx','-e',script,decoder],seconds=30)
 e.discard(db)
 e.report['capped_recovery']={'passed':True,'projected_pool':480,'restored_pool':1003,'restored_remainder':523,'reader_metadata_preserved':True}

def main():
 ap=argparse.ArgumentParser(description=__doc__)
 ap.add_argument('--evidence',type=Path,required=True)
 ap.add_argument('--pg-bin',type=Path,default=Path('/opt/homebrew/opt/postgresql@17/bin'))
 args=ap.parse_args();root=Path(__file__).resolve().parents[2]
 output=args.evidence.resolve();output.mkdir(parents=True,exist_ok=False)
 native=module(root/'scripts/ci/test-mtt-unlimited.py','value_ticket_existing_execution')
 authoring=module(root/'scripts/ci/mtt_break_authoring_native.py','value_ticket_authoring')
 manifest=compose(root)
 (output/'foundation.sql').write_text(manifest['sql'])
 (output/'entry-deps.sql').write_text(manifest['entry_sql'])
 catalog=native.preparation_inputs(SimpleNamespace(root=root,report=manifest))
 authoring.authoring_inputs(root)
 supplements=[]
 for f in catalog['fixtures']:
  if f['kind']=='function-successor': supplements.append({**f,'kind':'functions','presence':'exact'})
  elif f['kind']!='registry': supplements.append(f)
 (output/'supplement.sql').write_text(native.preparation_supplement_sql(root,supplements))
 local_tmp=Path(os.environ['TMPDIR']).resolve()
 e=native.Execution(root,output,args.pg_bin.resolve(),local_tmp,900,socket_parent=local_tmp)
 e.report.update(fixture_identity='satellite-same-value-entry-v1',production_mutations=False)
 try:
  e.start();db=e.database()
  for file in ['foundation.sql','entry-deps.sql','supplement.sql']:
   e.sql(db,file=output/file,label=file,seconds=180)
  for stage in catalog['stages']:
   e.sql(db,file=root/stage['migration']['path'],label='prepare-'+Path(stage['migration']['path']).stem,seconds=120)
  authoring._assert_scope(e,db,root)
  supplement=(root/authoring.FIXTURE/'catalog-supplement.sql').read_text()
  marker="DO $$ BEGIN IF to_regprocedure('public.fn_club_scope_ids(uuid)') IS NOT NULL"
  if supplement.count(marker)!=1:raise ValueError('authoring fixture scope seam changed')
  e.sql(db,supplement.partition(marker)[0]+'COMMIT;\n',label='authoring-captured-dependencies',seconds=120)
  authoring._assert_capture(e,db,root)
  e.sql(db,file=root/authoring.MIGRATION,label='existing-authoring',seconds=120)
  e.sql(db,file=root/'supabase/migrations/20260917201651_satellite_multi_qualifier_receipt_v3.sql',label='existing-cohort-v3',seconds=120)
  fixture=root/'tests/fixtures/satellite-value-awards'
  # Current reporting readers refer to these empty, source-captured columns.
  # No Spin, jackpot or historical snapshot producer is simulated here.
  columns=sum((json.loads((fixture/name).read_text()) for name in ['reporting-columns.json','jackpot-columns.json','archived-journal-columns.json']),[])
  tables={}
  for col in columns:tables.setdefault(col['table_name'],[]).append('"'+col['column_name']+'" '+col['type'])
  schema='\n'.join('CREATE TABLE IF NOT EXISTS public."'+name+'" ('+','.join(cols)+');' for name,cols in tables.items())
  e.sql(db,schema,label='empty-current-reporting-projections')
  e.sql(db,"CREATE OR REPLACE FUNCTION public.fn_poker_diamond_jackpot_diamonds() RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,pg_temp AS $function$\n  SELECT COALESCE(sum(l.amount), 0)::numeric FROM public.poker_diamond_jackpot_ledger l;\n$function$;",label='actual-unchanged-jackpot-total')
  dependencies=json.loads((fixture/'unchanged-dependencies.json').read_text())+json.loads((fixture/'ticket-routing-dependency.json').read_text())+json.loads((fixture/'entitlement-owner.json').read_text())
  (output/'current-dependencies.sql').write_text('\n'.join(r['definition'].rstrip().rstrip(';')+';' for r in dependencies))
  e.sql(db,file=output/'current-dependencies.sql',label='actual-unchanged-dependencies',seconds=120)
  owners=json.loads((fixture/'current-owners.json').read_text())+json.loads((fixture/'global-owners.json').read_text())
  for capture in dependencies+owners:
   definition=capture['definition']
   body=re.search(r'AS \$function\$(.*?)\$function\$',definition,re.S)
   if body is None: raise ValueError('captured function body delimiter changed')
   digest=capture.get('md5') or capture.get('hash') or capture.get('source_md5')
   if digest and hashlib.md5(body.group(1).encode()).hexdigest()!=digest:
    raise ValueError('captured source fingerprint differs: '+str(capture.get('name')))

  (output/'current-owners.sql').write_text('\n'.join(r['definition'].rstrip().rstrip(';')+';' for r in owners))
  e.sql(db,file=output/'current-owners.sql',label='actual-current-owners',seconds=120)
  candidate=next((root/'supabase/migrations').glob('*_satellite_fallback_awards_are_reusable_value_tickets.sql'))
  prerequisite=next((root/'supabase/migrations').glob('*_diamond_value_ticket_custody_transfers_retain_no_wallet_jour.sql'))
  # The shared historical foundation predates the house-leg CHECK expansion.
  # Reconstruct these two captured current production constraints exactly.
  constraints=json.loads((fixture/'custody-constraints.json').read_text())
  current_checks='\n'.join('ALTER TABLE public.'+r['relation']+' DROP CONSTRAINT '+r['conname']+'; ALTER TABLE public.'+r['relation']+' ADD CONSTRAINT '+r['conname']+' '+r['definition']+';' for r in constraints)
  e.sql(db,current_checks,label='actual-current-custody-checks',seconds=30)
  # Installation is guarded by actual closed play, not a generic financial
  # component label. This isolated setting is changed only by later funded cases.
  e.sql(db,"INSERT INTO public.ca_arena_settings(id,club_id,settlement_window_days,note,cash_games_enabled,tournaments_enabled) SELECT 1,id,0,'isolated closed-play installation',false,false FROM public.clubs WHERE is_platform AND asset='diamonds' ON CONFLICT(id) DO UPDATE SET cash_games_enabled=false,tournaments_enabled=false;",label='closed-play-installation-configuration')
  # CHECK grammar boundaries in a separate disposable catalog, never by
  # dropping or bypassing a constraint in the actual funded-owner scene.
  check_db=e.database()
  minimal="CREATE TABLE public.ca_arena_settings(id integer,cash_games_enabled boolean,tournaments_enabled boolean); INSERT INTO public.ca_arena_settings VALUES(1,false,false); CREATE TABLE public.poker_diamond_movements(request_id uuid,custody_id uuid,user_id uuid,action text,amount bigint,source_account text,destination_account text,wallet_journal_id uuid,request jsonb,receipt jsonb); CREATE TABLE public.poker_diamond_tournament_ledger(kind text,user_id uuid,custody_id uuid,wallet_journal_id uuid,registration_id uuid,idempotency_key text,amount bigint,prize_part bigint,bounty_part bigint,fee_part bigint,request jsonb);"
  minimal+=''.join('ALTER TABLE public.'+r['relation']+' ADD CONSTRAINT '+r['conname']+' '+r['definition']+';' for r in constraints)
  e.sql(check_db,minimal,label='custody-check-only-catalog')
  e.sql(check_db,file=prerequisite,label='custody-check-only-exact-DDL')
  e.sql(check_db,file=fixture/'custody-check-cases.sql',label='custody-check-45-boundaries')
  code,_,error=e.sql(check_db,file=prerequisite,label='custody-check-refuses-DDL-replay',check=False)
  if code==0 or 'VALUE_TICKET_CONSTRAINT_PREIMAGE_CHANGED' not in error:raise ValueError('exact custody CHECK DDL replay was not refused')
  for column in ['cash_games_enabled','tournaments_enabled']:
   e.sql(check_db,'UPDATE public.ca_arena_settings SET '+column+'=true;',label='open-play-installation-'+column)
   code,_,error=e.sql(check_db,file=prerequisite,label='open-play-DDL-refused-'+column,check=False)
   if code==0 or 'VALUE_TICKET_DDL_REQUIRES_CLOSED_DIAMOND_PLAY' not in error:raise ValueError('open Diamond play was not refused before DDL')
   e.sql(check_db,'UPDATE public.ca_arena_settings SET '+column+'=false;',label='restore-isolated-closed-'+column)
  e.sql(check_db,'DELETE FROM public.ca_arena_settings;',label='missing-play-configuration')
  code,_,error=e.sql(check_db,file=prerequisite,label='missing-play-DDL-refused',check=False)
  if code==0 or 'VALUE_TICKET_DDL_REQUIRES_CLOSED_DIAMOND_PLAY' not in error:raise ValueError('missing play configuration was not refused')
  e.discard(check_db)
  e.sql(db,file=prerequisite,label='exact-custody-check-prerequisite',seconds=30)
  # The native route records exact prerequisite installation, like the real
  # applier; the candidate refuses absent or changed CHECK postimages.
  e.sql(db,"CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text); INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20261031075352','diamond_value_ticket_custody_transfers_retain_no_wallet_jour');",label='prerequisite-installation-history')
  guard=json.loads((fixture/'guard-declaration.json').read_text())
  tables={}
  for col in guard['columns']:
   tables.setdefault(col['relname'],[]).append('"'+col['attname']+'" '+col['type']+(' NOT NULL' if col['attnotnull'] else '')+(' DEFAULT '+col['default_expression'] if col['default_expression'] else ''))
  guard_sql="CREATE SEQUENCE IF NOT EXISTS public.ca_guard_def_history_id_seq;\n"+'\n'.join('CREATE TABLE IF NOT EXISTS public.'+name+' ('+','.join(cols)+');' for name,cols in tables.items())
  guard_sql+='\n'.join('ALTER TABLE public.'+r['relation']+' ADD CONSTRAINT '+r['conname']+' '+r['definition']+';' for r in guard['constraints'])
  guard_sql+='\n'.join(r['definition'].rstrip().rstrip(';')+';' for r in json.loads((fixture/'guard-declaration-indexes.json').read_text()))
  guard_sql+='\n'.join(r['definition'].rstrip().rstrip(';')+';' for r in guard['functions'])
  e.sql(db,guard_sql,label='actual-guard-declaration-catalog')
  e.sql(db,file=candidate,label='exact-value-ticket-candidate',seconds=120)
  expected=json.loads((fixture/'postimages.json').read_text())
  for name,digest in expected.items():
   _,out,_=e.sql(db,"SELECT md5(prosrc) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='"+name+"';",label='postimage-'+name)
   if out.strip()!=digest: raise ValueError('postimage differs: '+name)
  e.report['candidate_sha256']=hashlib.sha256(candidate.read_bytes()).hexdigest()
  e.report['postimages_verified']=len(expected)
  e.sql(db,file=root/'scripts/ci/probes/atomic-terminal-rehearsal-fixture.sql',label='owned-structural-opening',seconds=60)
  # The source-bound scenes below exercise actual funded settlement and use.
  scene=fixture/'native-cases.sql'
  if not scene.exists(): raise ValueError('native funded cases are required')
  seed=(root/'scripts/ci/probes/satellite-qualifiers-native.sql').read_text()
  seed=seed[:seed.index("SELECT 'SATELLITE_QUALIFIER_NATIVE_EVIDENCE='")]
  seed=seed.replace("clock_timestamp()+interval '1 hour','REGISTERING'","clock_timestamp()+interval '5 minutes','REGISTERING'")
  # Reuse the actual four paid-entry/final-hand opening; the new scene makes
  # its own assertions instead of the original direct-seat-only assertions.
  composed=output/'funded-cases.sql'
  diamond_seed=seed[seed.index('CREATE FUNCTION pg_temp.qualifier_case'):]
  diamond_seed=diamond_seed.replace('pg_temp.qualifier_case(', 'pg_temp.qualifier_diamond_case(').replace('26.25','27').replace('105','108').replace('993001','993003').replace('993002','993004').replace('1000000+survivors','2000000+survivors').replace('5 bubble','8 bubble')
  diamond_seed=diamond_seed.replace("INSERT INTO public.clubs(id,club_id,name) VALUES(club,CASE WHEN survivors=2 THEN 993003 ELSE 993004 END,'Native Qualifier '||case_name);", "INSERT INTO public.clubs(id,club_id,name,asset,is_platform,chip_treasury,chip_pool,promo_balance,insurance_balance) VALUES(club,CASE WHEN survivors=2 THEN 993003 ELSE 993004 END,'Native Qualifier '||case_name,'diamonds',true,0,0,0,0); INSERT INTO public.ca_arena_settings(id,club_id,settlement_window_days,note,updated_at,cash_games_enabled,tournaments_enabled) VALUES(1,club,0,'isolated value-ticket qualification',now(),false,true) ON CONFLICT(id) DO UPDATE SET club_id=EXCLUDED.club_id,settlement_window_days=0,tournaments_enabled=true;")
  diamond_seed=diamond_seed.replace("INSERT INTO public.profiles(id,username,display_name) VALUES(u,'native_qualifier_'||case_name||'_'||i,'Native Qualifier');", "INSERT INTO public.profiles(id,username,display_name,diamonds) VALUES(u,'native_qualifier_'||case_name||'_'||i,'Native Qualifier',300);")
  diamond_seed=diamond_seed.replace("case_name||': actual authenticated entry '||i)","case_name||': actual authenticated entry '||i||' returned '||r::text)")
  diamond_seed=diamond_seed.replace("club uuid:=md5('l04:'||case_name||':club')::uuid;", "club uuid:=(SELECT id FROM public.clubs WHERE is_platform AND asset='diamonds');")
  diamond_seed=diamond_seed.replace("INSERT INTO public.clubs(id,club_id,name,asset,is_platform,chip_treasury,chip_pool,promo_balance,insurance_balance) VALUES(club,CASE WHEN survivors=2 THEN 993003 ELSE 993004 END,'Native Qualifier '||case_name,'diamonds',true,0,0,0,0);", 'PERFORM 1; /* Reuse the actual one-platform Diamond arena. */')
  diamond_seed=diamond_seed.replace("INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance,joined_at)\n   VALUES(club,u,'player','active',300,clock_timestamp()-interval '1 day');", 'PERFORM 1; -- Diamond platform membership is profile-based, never a Chip wallet.')
  diamond_seed=diamond_seed.replace("PERFORM pg_temp.qualifier_assert((SELECT prize_balance=108 AND gross_in=108", "PERFORM public.fn_poker_diamond_tournament_open_shadow(source_id);\n PERFORM pg_temp.qualifier_assert((SELECT prize_balance=108 AND gross_in=108")
  diamond_seed=diamond_seed.replace('PERFORM 1; /* Reuse the actual one-platform Diamond arena. */', "INSERT INTO auth.users(id) SELECT owner_id FROM public.clubs WHERE id=club AND owner_id IS NOT NULL ON CONFLICT(id) DO NOTHING; INSERT INTO public.users(id,username) SELECT owner_id,'native_diamond_platform_owner' FROM public.clubs WHERE id=club AND owner_id IS NOT NULL ON CONFLICT(id) DO NOTHING; INSERT INTO public.profiles(id,username,display_name) SELECT owner_id,'native_diamond_platform_owner','Native Diamond Platform Owner' FROM public.clubs WHERE id=club AND owner_id IS NOT NULL ON CONFLICT(id) DO NOTHING;")
  composed.write_text(seed+'\n'+scene.read_text()+'\n'+diamond_seed+'\n'+(fixture/'native-diamond-cases.sql').read_text()+"\nSET CONSTRAINTS ALL IMMEDIATE;\nROLLBACK;\n")
  # The current one-survivor legacy producer is a separate public call path.
  # Capture its actual owners, then demonstrate the future-award assertion RED
  # before installing the narrowly guarded successor in this isolated catalog.
  single=root/'tests/fixtures/satellite-single-value-awards'
  for capture in ['legacy-inner-before.sql','receipt-before.sql','wrapper-unchanged.sql']:
   e.sql(db,file=single/capture,label='actual-single-owner-'+capture,seconds=30)
  e.sql(db,"REVOKE ALL ON FUNCTION public.fn_ca_satellite_settlement_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role; REVOKE ALL ON FUNCTION public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid) TO service_role;",label='actual-single-owner-acl')
  properties="SELECT jsonb_agg(jsonb_build_object('identity',oid::regprocedure::text,'definition_md5',md5(pg_get_functiondef(oid)),'source_md5',md5(prosrc),'owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'config',proconfig,'acl',proacl)) FROM pg_proc WHERE oid IN('public.fn_settle_satellite_tournament_pre_money_path_gate(uuid,uuid)'::regprocedure,'public.fn_ca_satellite_settlement_receipt(uuid,uuid)'::regprocedure,'public.fn_settle_satellite_tournament(uuid,uuid)'::regprocedure);"
  e.sql(db,properties,label='single-properties-before')
  one_seed=seed[:seed.index('CREATE FUNCTION pg_temp.qualifier_case')]
  creator=seed[seed.index('CREATE FUNCTION pg_temp.qualifier_case'):]
  creator=creator[:creator.index(" EXECUTE 'SET LOCAL ROLE service_role';\n r:=public.fn_get_satellite_qualifier_state")]
  creator=creator.replace('pg_temp.qualifier_case(', 'pg_temp.single_value_case(')
  creator=creator.replace('CASE WHEN survivors=2 THEN 993001 ELSE 993002 END','993100+abs(hashtext(case_name)%10000)')
  # A finite legacy target is an explicit opening, never a modified settled contract.
  creator=creator.replace("0,NULL,3,0,club,0,0,0,false,false,false,0,0,0,'MTT','freezeout','mtt-v2'","0,CASE WHEN (case_name LIKE '%full%' OR case_name LIKE '%held%') THEN 3 ELSE NULL END,3,0,club,0,0,0,false,false,false,0,0,0,CASE WHEN (case_name LIKE '%full%' OR case_name LIKE '%held%') THEN 'SNG' ELSE 'MTT' END,'freezeout',CASE WHEN (case_name LIKE '%full%' OR case_name LIKE '%held%') THEN 'sng-v1' ELSE 'mtt-v2' END")
  creator+="\n RETURN jsonb_build_object('tournament_id',source_id,'qualifier_ids',to_jsonb(q),'target_id',target_id,'table_id',v_table_id);\nEND $case$;\n"
  diamond_creator=diamond_seed[diamond_seed.index('CREATE FUNCTION pg_temp.qualifier_diamond_case'):]
  diamond_creator=diamond_creator[:diamond_creator.index(" EXECUTE 'SET LOCAL ROLE service_role';\n r:=public.fn_get_satellite_qualifier_state")]
  diamond_creator=diamond_creator.replace('pg_temp.qualifier_diamond_case(', 'pg_temp.single_diamond_case(')
  diamond_creator=diamond_creator.replace("0,NULL,3,0,club,0,0,0,false,false,false,0,0,0,'MTT','freezeout','mtt-v2'","0,CASE WHEN (case_name LIKE '%full%' OR case_name LIKE '%held%') THEN 3 ELSE NULL END,3,0,club,0,0,0,false,false,false,0,0,0,CASE WHEN (case_name LIKE '%full%' OR case_name LIKE '%held%') THEN 'SNG' ELSE 'MTT' END,'freezeout',CASE WHEN (case_name LIKE '%full%' OR case_name LIKE '%held%') THEN 'sng-v1' ELSE 'mtt-v2' END")
  diamond_creator+="\n RETURN jsonb_build_object('tournament_id',source_id,'qualifier_ids',to_jsonb(q),'target_id',target_id,'table_id',v_table_id);\nEND $case$;\n"
  single_scene=output/'single-funded-cases.sql'
  single_scene.write_text(one_seed+creator+diamond_creator+(single/'native-cases.sql').read_text()+"\nSET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;\n")
  code,_,error=e.sql(db,file=single_scene,label='single-old-red',seconds=180,check=False)
  if code==0 or 'SINGLE_VALUE_EXPECT_REUSABLE_TICKET' not in error:
   raise ValueError('old actual single-winner path did not produce the expected RED: '+error[-2500:])
  successor=root/'supabase/migrations/20261031211736_single_winner_satellite_fallback_is_a_reusable_value_ticket.sql'
  historical=output/'single-historical-transition.sql'
  # One isolated transaction creates a genuine legacy payment, replaces the
  # functions, verifies replay, and rolls everything back before other cases.
  transition=successor.read_text().replace('BEGIN;', '', 1).removesuffix('COMMIT;\n')
  historical.write_text(one_seed+creator+(single/'historical-before.sql').read_text().removesuffix('COMMIT;\n')+transition+(single/'historical-after.sql').read_text().replace('BEGIN;', '', 1))
  e.sql(db,file=historical,label='single-historical-transition',seconds=60)
  e.sql(db,file=successor,label='single-value-successor',seconds=30)
  e.sql(db,properties,label='single-properties-after')
  e.sql(db,file=single_scene,label='single-new-green',seconds=180)
  e.sql(db,file=composed,label='funded-value-ticket-cases',seconds=180)
  # Reproduce the installed roster/terminal counter contract mismatch with
  # real paid target admissions and the actual bust-trigger decrement.
  live_owners=json.loads((fixture/'live-field-owners.json').read_text())
  for owner in live_owners:
   if hashlib.md5(owner['definition'].encode()).hexdigest()!=owner['definition_md5']:
    raise ValueError('live field owner capture changed')
   e.sql(db,owner['definition'],label='live-field-owner-'+owner['proname'])
  live_scene=output/'live-field-cases.sql'
  live_scene.write_text(seed+'\n'+(fixture/'live-field-cases.sql').read_text()+"\nSET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;\n")
  code,_,error=e.sql(db,file=live_scene,label='live-field-old-red',seconds=180,check=False)
  if code==0 or 'malformed aggregate or escrow state' not in error:
   raise ValueError('expected running target counter refusal absent: '+error[-3500:])
  single_live_scene=output/'single-live-field-cases.sql'
  single_live=(fixture/'live-field-cases.sql').read_text().replace("pg_temp.qualifier_case('live_field',2,false)","pg_temp.single_value_case('live_field',1,false)").replace('public.fn_settle_satellite_qualifiers(s,q)','public.fn_settle_satellite_tournament(s,q[1])')
  single_live_scene.write_text(one_seed+creator+'\n'+single_live+"\nSET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;\n")
  code,_,error=e.sql(db,file=single_live_scene,label='single-live-field-old-red',seconds=180,check=False)
  if code==0 or 'malformed aggregate or escrow state' not in error:
   raise ValueError('expected single running target refusal absent: '+error[-3500:])
  live_candidate=next((root/'supabase/migrations').glob('*_satellite_settlement_uses_the_running_live_field_count.sql'))
  e.sql(db,file=live_candidate,label='live-field-exact-migration',seconds=30)
  code,_,error=e.sql(db,file=live_candidate,label='live-field-replay-refused',seconds=30,check=False)
  if code==0 or 'SATELLITE_LIVE_FIELD_PREIMAGE_CHANGED' not in error: raise ValueError('migration replay must refuse changed source')
  e.sql(db,file=live_scene,label='live-field-new-green',seconds=180)
  code,_,error=e.sql(db,file=single_live_scene,label='single-registration-without-chair-red',seconds=180,check=False)
  if code==0 or 'FAIL awarded registration resolves to its funded live chair' not in error:
   raise ValueError('expected a funded single-winner registration without a physical chair: '+error[-2500:])
  refusal_scene=output/'target-refusals.sql'
  refusal_scene.write_text(seed+diamond_seed+creator+diamond_creator+(fixture/'target-refusal-cases.sql').read_text()+"\nROLLBACK;\n")
  code,_,error=e.sql(db,file=refusal_scene,label='target-refusal-old-red',seconds=180,check=False)
  if code==0 or 'target refusal lacks expected invariant players_mismatch:' not in error:
   raise ValueError('expected undifferentiated original refusal: '+error[-2500:])
  diagnostic=next((root/'supabase/migrations').glob('*_satellite_refusals_identify_the_failed_target_invariant.sql'))
  e.sql(db,file=diagnostic,label='target-refusal-migration')
  e.sql(db,file=refusal_scene,label='target-refusal-new-green',seconds=180)
  chair=next((root/'supabase/migrations').glob('*_single_winner_satellite_seats_its_running_target_entry.sql'))
  e.sql(db,file=chair,label='single-running-chair-migration')
  e.sql(db,file=single_live_scene,label='single-live-field-new-green',seconds=180)
  # New sessions read each winner's immutable award after the funded chair and
  # ticket commit. They must never invoke settlement or consume the ticket.
  award_db=e.database(db)
  committed=single_live.replace('END $live_field$;', """INSERT INTO reconnect_award_source VALUES(s);
END $live_field$;""")
  e.sql(award_db,"CREATE TABLE reconnect_award_source(id uuid PRIMARY KEY);",label='reconnect-observer-id')
  e.sql(award_db,one_seed+creator+'\n'+committed+'\nSET CONSTRAINTS ALL IMMEDIATE; COMMIT;',label='commit-ranked-seat-and-ticket',seconds=180)
  read_fixture=(fixture/'read-my-committed-award.sql').read_text()
  code,_,error=e.sql(award_db,read_fixture,label='ranked-result-reconnect-red',check=False)
  if code==0 or 'ranked award identity' not in error:
   raise ValueError('expected original ranked award gap: '+error[-2500:])
  e.sql(award_db,file=next((root/'supabase/migrations').glob('*_read_my_ranked_satellite_award_after_reconnect.sql')),label='ranked-result-reader-migration')
  e.sql(award_db,read_fixture,label='ranked-result-fresh-connection-before-redemption')
  e.sql(award_db,file=fixture/'redeem-ranked-reconnect-ticket.sql',label='redeem-ranked-ticket-and-replay')
  e.sql(award_db,read_fixture,label='ranked-result-fresh-connection-after-redemption')
  e.discard(award_db)

  # The paid opening retains actual registration, overlay and escrow owners.
  # The hand/start snapshot is synthetic, as in the existing qualifier probe.
  capped_creator=creator.replace('pg_temp.single_value_case(', 'pg_temp.capped_value_case(')
  replacements={
   "IF survivors NOT IN (1,2)": "IF survivors NOT IN (29,48)",
   "1..4 LOOP": "1..48 LOOP", "26.25": "20",
   "current_players=4": "current_players=48", "4000/survivors": "48000/survivors",
   "ELSE 5-i END": "ELSE 49-i END", "45,5,1000": "9,1,1000",
   "source_id,target_id,2,50,100,105": "source_id,target_id,2,10,20,1003",
   "prize_balance=105 AND gross_in=105": "prize_balance=960 AND gross_in=960",
   "(r->>'prize_pool')::numeric=105": "(r->>'prize_pool')::numeric=1003",
  }
  for old,new in replacements.items():
   if old not in capped_creator: raise ValueError('capped opening seam changed: '+old)
   capped_creator=capped_creator.replace(old,new)
  capped_creator=capped_creator.replace('four real entries fund exactly 105','48 real entries fund exactly 960')
  overlay="""CREATE TEMP TABLE capped_overlay_subject (LIKE public.tournaments);
CREATE TRIGGER capped_overlay BEFORE UPDATE OF status ON capped_overlay_subject
FOR EACH ROW EXECUTE FUNCTION public.fn_ca_fund_overlay_on_lock();
"""
  overlay_call="""PERFORM set_config('session_replication_role','replica',true);
 UPDATE public.clubs SET chip_treasury=43 WHERE id=club;
 UPDATE public.tournaments SET guaranteed_prize=1003 WHERE id=source_id;
 PERFORM set_config('session_replication_role','origin',true);
 INSERT INTO capped_overlay_subject SELECT * FROM public.tournaments WHERE id=source_id;
 UPDATE capped_overlay_subject SET status='RUNNING' WHERE id=source_id;
 PERFORM pg_temp.qualifier_assert((SELECT chip_treasury=0 FROM public.clubs WHERE id=club),
   'capped guarantee debits exactly43 from its actual bank');
 PERFORM pg_temp.qualifier_assert((SELECT sum(amount)=43 FROM public.chip_ledger
   WHERE tournament_id=source_id AND category='overlay'),'capped overlay has actual journal');
 PERFORM set_config('session_replication_role','replica',true);
 UPDATE public.tournaments SET prize_pool=1003 WHERE id=source_id;
"""
  seam="PERFORM set_config('session_replication_role','replica',true);\n UPDATE public.tournaments SET status='RUNNING'"
  if capped_creator.count(seam)!=1:raise ValueError('capped start opening seam changed')
  capped_creator=capped_creator.replace(seam,overlay_call+" UPDATE public.tournaments SET status='RUNNING'")
  table_start=capped_creator.index(' INSERT INTO public.tables(id,name,tournament_id')
  table_end=capped_creator.index(' FOR i IN 1..48 LOOP',table_start)
  table_insert=capped_creator[table_start:table_end]
  capped_creator=capped_creator[:table_start]+capped_creator[table_end:]
  table_insert=table_insert.replace("'live',survivors,", "'live',greatest(0,least(8,survivors-i+1)),")
  roster=" FOR i IN 1..48 LOOP\n  u:=md5('l04:'||case_name||':user:'||i)::uuid;\n  UPDATE public.tournament_players"
  roster_new=" FOR i IN 1..48 LOOP\n  IF (i-1)%8=0 THEN\n   v_table_id:=md5('l04:'||case_name||':table:'||((i-1)/8))::uuid;\n"+table_insert+"  END IF;\n  u:=md5('l04:'||case_name||':user:'||i)::uuid;\n  UPDATE public.tournament_players"
  if capped_creator.count(roster)!=1:raise ValueError('capped roster seam changed')
  capped_creator=capped_creator.replace(roster,roster_new).replace('seat_number=i,','seat_number=(i-1)%8+1,').replace("::uuid,v_table_id,i,u,", "::uuid,v_table_id,(i-1)%8+1,u,")
  capped_scene=output/'capped-cohort-cases.sql'
  capped_scene.write_text(one_seed+overlay+capped_creator+(fixture/'capped-cohort-cases.sql').read_text()+"\nSET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;\n")
  current_capped=json.loads((fixture/'capped-owners.json').read_text())
  for owner in current_capped:
   if hashlib.md5(owner['definition'].encode()).hexdigest()!=owner['hash']:
    raise ValueError('capped current owner changed: '+owner['signature'])
   e.sql(db,owner['definition'],label='capped-current-'+owner['signature'])
  code,_,error=e.sql(db,file=capped_scene,label='capped-old-red',seconds=180,check=False)
  if code==0 or 'frozen full-ticket depth' not in error:
   raise ValueError('expected actual capped full-ticket refusal: '+error[-3500:])
  capped_migration=root/'supabase/migrations/20261108154158_capped_frozen_satellite_cohort_awards.sql'
  e.sql(db,file=capped_migration,label='capped-exact-migration',seconds=30)
  e.report['capped_migration_sha256']=hashlib.sha256(capped_migration.read_bytes()).hexdigest()
  e.sql(db,"SELECT proname,md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fn_ca_settle_satellite_cohort','fn_ca_satellite_cohort_receipt','fn_execute_capped_satellite_terminal_request') ORDER BY proname;",label='capped-postimage-hashes')
  e.sql(db,file=capped_scene,label='capped-new-green',seconds=180)
  qualify_capped_recovery(e,root,output,db,one_seed+overlay+capped_creator)
  e.sql(db,file=composed,label='capped-preserves-ordinary-cohorts',seconds=180)
  e.sql(db,file=single_scene,label='capped-preserves-legacy-single-winner',seconds=180)
  qualify_concurrent_consumption(e,root,native,db,output,seed,scene.read_text(),diamond_seed,(fixture/'native-diamond-cases.sql').read_text())
  e.report.update(passed=True,status='passed')
 finally:
  e.close()
  (output/'report.json').write_text(json.dumps(e.report,indent=2,default=str)+'\n')
 print('PASS: actual funded satellite value awards, native assets, exact single-use entry and immutable historical receipts')

if __name__=='__main__':main()
