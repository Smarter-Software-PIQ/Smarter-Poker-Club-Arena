#!/usr/bin/env python3
"""Qualify the original main BBJ bank allocator with the real W constructor.

No production mutations. Actual autoledger, tally and deferred journal guards
come from the existing bound financial foundation, never replacement functions.
"""
import argparse,os,sys,json,hashlib,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'scripts/ci'))
from satellite_qualifier_fixture import module,table_sql
baseline=module(root/'scripts/ci/test-promo-play-through.py','promo_baseline')
base_migrations=[root/'supabase/migrations'/name for name in baseline.BASE_MIGRATION_FILES]
hs=module(root/'scripts/ci/test-hand-submission.py','promo_returns_hs')
native=module(root/'scripts/ci/test-mtt-unlimited.py','promo_returns_native')
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--profit-source','--profit-snapshot',dest='profit_source',type=Path,default=root/'supabase/migrations/20261116190221_promo_winnings_retain_original_source_until_two_times_paid_f.sql')
p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
p.add_argument('--ticket-tree',type=Path,default=root)
p.add_argument('--custody-migration',type=Path,default=root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql')
p.add_argument('--return-migration',type=Path,default=root/'supabase/migrations/20261116154841_expired_and_departed_promo_principal_returns_to_its_original.sql')
p.add_argument('--current-financial',type=Path,default=root/'tests/fixtures/promo-principal-returns/current-financial-owners.json')
p.add_argument('--disburse-owner',type=Path,default=root/'tests/fixtures/promo-principal-returns/disburse.sql')
args=p.parse_args();current=json.loads(args.current_financial.read_text())
if sys.platform=='darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):raise SystemExit('external TMPDIR required')
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
manifest=hs.prepare(root,out)
tested={};
def remember(path):
 path=path.resolve();key=str(path.relative_to(root)) if path.is_relative_to(root) else str(path);tested[key]=hashlib.sha256(path.read_bytes()).hexdigest()
for path in [Path(__file__),root/'scripts/ci/test-promo-play-through.py',args.current_financial,args.disburse_owner,root/'tests/fixtures/promo-principal-returns/journal-owners.json']+[root/'tests/fixtures/promo-principal-returns/self-stake.sql',root/'tests/fixtures/promo-principal-returns/agent-send.sql',root/'tests/fixtures/promo-principal-returns/claim-back.sql',root/'tests/fixtures/promo-principal-returns/member-leave.sql']:remember(path)
e=native.Execution(root,out,args.pg_bin.resolve(),Path(os.environ.get('TMPDIR',str(out))),600,socket_parent=Path(os.environ.get('TMPDIR',str(out))))
try:
 e.start();db=e.database()
 for f,label in [(out/'foundation.sql','foundation'),(out/'current-authorities.sql','authorities')]:e.sql(db,file=f,label=label,seconds=180)
 _,catalog,_=e.sql(db,"""SELECT jsonb_build_object('tables',(SELECT jsonb_object_agg(table_name,cols) FROM(SELECT table_name,jsonb_agg(column_name ORDER BY ordinal_position) cols FROM information_schema.columns WHERE table_schema='public' AND table_name IN('clubs','club_members','agents','union_wallets','chip_ledger','chip_transactions','union_wallet_transactions','ca_money_rpc_registry') GROUP BY table_name) x),'journal_functions',(SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'md5',md5(pg_get_functiondef(oid)))) FROM pg_proc WHERE proname IN('fn_ca_autoledger','fn_ca_trial_balance','fn_promo_disburse','fn_ca_tally_enforce','fn_ca_post_leg','fn_ca_assert_ledger_tally')));""",label='original-financial-catalog')
 (out/'original-financial-catalog.json').write_text(catalog)
 for row in current['tables']:
  e.sql(db,table_sql({**row,'policies':[]}),label='current-table-'+row['name'])
 for row in current['tables']:
  for constraint in row.get('constraints') or []:
   if constraint['type']=='f':
    e.sql(db,'ALTER TABLE public.\"'+row['name']+'\" ADD CONSTRAINT \"'+constraint['name']+'\" '+constraint['definition']+';',label='current-fk-'+constraint['name'])
 # Current source overlays update the retained authentic journal/tally
 # owners; the foundation's real enabled financial triggers remain in place.
 financial=current['functions']
 # These two recorder-side functions run on a separate observer connection,
 # never the financial transaction; no Vault/remote-recorder fixture is used.
 financial=[row for row in financial if row['proname'] not in ('fn_ca_ledger_refusal_file','fn_ca_ledger_refusal_raise')]
 import re
 pending=list(financial);installed=set();names={row['proname'] for row in financial}
 while pending:
  ready=next((row for row in pending if 'LANGUAGE plpgsql' in row['definition'] or
   not ({m[1] for m in re.finditer(r'\b(fn_[a-z0-9_]+)\s*\(',row['definition'])}&(names-installed-{row['proname']}))),None)
  if ready is None:raise RuntimeError('current financial SQL dependency cycle')
  pending.remove(ready);row=ready
  e.sql(db,row['definition'],label='current-'+row['proname'][:35]);installed.add(row['proname'])
  _,actual,_=e.sql(db,"SELECT md5(pg_get_functiondef('public."+row['signature']+"'::regprocedure))",label='pin-'+row['proname'][:35])
  if actual.strip()!=row['definition_md5']:raise RuntimeError('current financial owner preimage differs: '+row['signature'])
 for row in current['tables']:
  rendered=table_sql(row)
  policy_start=rendered.find('CREATE POLICY ')
  if policy_start>=0:e.sql(db,rendered[policy_start:],label='current-policy-'+row['name'])
 for row in current['triggers']:
  if row['tgenabled']!='O':raise RuntimeError('non-origin financial trigger capture')
  e.sql(db,'DROP TRIGGER IF EXISTS '+row['tgname']+' ON public.'+row['relname']+';'+row['definition']+';',label='current-trigger-'+row['tgname'][:35])
 for row in json.loads((root/'tests/fixtures/promo-principal-returns/journal-owners.json').read_text())['functions']:
  e.sql(db,row['definition'],label='journal-'+row['proname'])
 if current['money_registry']:
  rows=current['money_registry']
  e.sql(db,"INSERT INTO public.ca_money_rpc_registry(proname,status,notes) SELECT proname,status,notes FROM jsonb_to_recordset('"+json.dumps(rows).replace("'","''")+"'::jsonb) AS x(proname text,status text,notes text) ON CONFLICT(proname) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes",label='actual-current-money-registrations')
 for name in ['self-stake.sql','agent-send.sql','claim-back.sql','member-leave.sql']:
  e.sql(db,file=root/'tests/fixtures/promo-principal-returns'/name,label='original-'+name)
 if current['config']:
  cfg=current['config']
  remember(root/'supabase/migrations/20261002030942_every_chip_store_balances_with_its_ledger_row.sql')
  original_store=(root/'supabase/migrations/20261002030942_every_chip_store_balances_with_its_ledger_row.sql').read_text()
  start=original_store.index('CREATE TABLE public.ca_ledger_invariant_store_mode');end=original_store.index('COMMENT ON TABLE',start)
  e.sql(db,original_store[start:end].replace('CREATE TABLE public.','CREATE TABLE IF NOT EXISTS public.'),label='original-store-mode-table')
  remember(root/'supabase/migrations/20261001160611_a_balance_never_moves_without_its_ledger_row.sql')
  global_store=(root/'supabase/migrations/20261001160611_a_balance_never_moves_without_its_ledger_row.sql').read_text()
  start=global_store.index('CREATE TABLE IF NOT EXISTS public.ca_ledger_invariant_mode');end=global_store.index('INSERT INTO public.ca_ledger_invariant_mode',start)
  e.sql(db,global_store[start:end],label='original-global-mode-table')
  for key,table,pk in [('coverage','ca_chip_store_coverage','store'),('store_modes','ca_ledger_invariant_store_mode','store'),('global_mode','ca_ledger_invariant_mode','singleton')]:
   rows=cfg[key];cols=list(rows[0]);updates=','.join(c+'=EXCLUDED.'+c for c in cols if c!=pk)
   e.sql(db,'INSERT INTO public.'+table+'('+','.join(cols)+') SELECT '+','.join(cols)+" FROM jsonb_populate_recordset(NULL::public."+table+",'"+json.dumps(rows).replace("'","''")+"'::jsonb) ON CONFLICT("+pk+') DO UPDATE SET '+updates,label='actual-mode-'+key)
 e.sql(db,file=args.disburse_owner,label='original-disburse')
 e.sql(db,file=root/'scripts/ci/probes/atomic-terminal-rehearsal-fixture.sql',label='structural-opening')
 e.sql(db,"""CREATE TABLE IF NOT EXISTS public.ca_declared_money_triggers(table_name text,trigger_name text,note text,PRIMARY KEY(table_name,trigger_name));
 ALTER TABLE public.accounting_tournament_fee_sources ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),ADD COLUMN IF NOT EXISTS rake_record_id uuid;
 ALTER TABLE public.rake_records ADD COLUMN IF NOT EXISTS source text;
 CREATE TABLE IF NOT EXISTS public.tournament_unregistration_receipts(registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,user_id uuid,fees_reversed numeric,fee_reversal_ids uuid[],fee_source_rake_record_ids uuid[]);
 CREATE TABLE IF NOT EXISTS public.tournament_cancellation_receipts(tournament_id uuid PRIMARY KEY,total_rake_before numeric,total_rake_after numeric,fees_reversed numeric,fee_reversal_ids uuid[]);
 """,label='prospective-fee-source-catalog')
 remember(root/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql')
 original=(root/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql').read_text()
 e.sql(db,original[original.index('CREATE FUNCTION public.fn_cash_record_original_funding('):original.index('-- This is a prospective game/roster snapshot')],label='original-cash-funding')
 for file in base_migrations:
  remember(file);e.sql(db,file=file,label=file.stem[:40])
 inventory_path=root/'tests/fixtures/promo-custody-inventory-pin.json';remember(inventory_path)
 inventory=json.loads(inventory_path.read_text())
 e.sql(db,'CREATE SCHEMA IF NOT EXISTS smarter_private;',label='original-inventory-schema')
 for owner in inventory['funding_owners']:
  e.sql(db,owner['definition']+';',label='actual-funding-owner')
  _,actual,_=e.sql(db,"SELECT md5(pg_get_functiondef('public."+owner['signature']+"'::regprocedure))",label='actual-funding-preimage')
  if actual.strip()!=owner['md5']:raise RuntimeError('actual funding owner capture differs: '+owner['signature'])
 e.sql(db,inventory['definition']+';'+'REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC,anon,authenticated,service_role;',label='actual-original-inventory-pin-guard')
 _,actual,_=e.sql(db,"SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))",label='original-inventory-guard-preimage')
 if actual.strip()!=inventory['md5']:raise RuntimeError('original inventory guard capture differs')
 remember(args.custody_migration)
 e.sql(db,file=args.custody_migration,label='promo-custody')
 # Exact maintained event eligibility helper, not a substitute money writer.
 remember(args.ticket_tree/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_keep_entry_source.sql')
 ticket=(args.ticket_tree/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_keep_entry_source.sql').read_text()
 cold=ticket[ticket.index('CREATE TABLE public.ca_promo_event_principal_lots'):ticket.index('-- Coupon allowance is not money.')]
 bust_path=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/bust-owner.json';remember(bust_path)
 e.sql(db,'SET check_function_bodies=off;',label='original-bust-source-closure-start')
 for row in json.loads(bust_path.read_text()):
  e.sql(db,row['definition']+';',label='actual-bust-'+row['signature'].split('(')[0])
 e.sql(db,'SET check_function_bodies=on;',label='original-bust-source-closure-end')
 current_bust_path=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/bust-money-owners.json';remember(current_bust_path)
 for owner in json.loads(current_bust_path.read_text()):
  e.sql(db,owner['definition']+';',label='current-bust-'+owner['proname'][:25])
  _,actual,_=e.sql(db,"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='"+owner['proname']+"' AND md5(pg_get_functiondef(p.oid))='"+owner['md5']+"'",label='current-bust-preimage')
  if actual.strip()!='1':raise RuntimeError('current original bust owner capture differs: '+owner['proname'])

 # Load captured original elimination/bounty/reentry owners BEFORE the
 # maintained P hook, never overwrite the patched purchase wrapper later.
 original_bust_path=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/bust-money-owners.json';remember(original_bust_path)
 for owner in json.loads(original_bust_path.read_text()):
  e.sql(db,owner['definition']+';',label='actual-bust-'+owner['proname'][:25])
 e.sql(db,cold,label='maintained-event-principal-and-exact-refund-owners')
 capture=args.ticket_tree/'tests/fixtures/promo-ticket-play-through/current-owners.json';remember(capture)
 original_refund=next(row for row in json.loads(capture.read_text()) if row['proname']=='fn_settle_tournament_refund_exact')
 e.sql(db,original_refund['definition'],label='actual-original-exact-refund-owner')
 e.sql(db,ticket[ticket.index('DO $refund_owner$'):ticket.index('CREATE FUNCTION public.fn_ca_promo_leave_events')],label='maintained-original-exact-refund-hook')
 leave=ticket[ticket.index('CREATE FUNCTION public.fn_ca_promo_leave_events'):ticket.index('-- New promo-funded cashier tickets')]
 e.sql(db,leave,label='original-event-departure-eligibility')
 e.sql(db,"""CREATE SCHEMA cron;
 CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text,schedule text,command text);
 CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid$$;
 """,label='provider-cron-registration-adapter')
 remember(args.return_migration)
 e.sql(db,file=args.return_migration,label='promo-original-returns')

 # Exact cold fee and H prerequisites from the already maintained accepted-hand route.
 fee=root/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql';remember(fee)
 e.sql(db,fee.read_text().split('DO $owners$')[0]+'COMMIT;',label='original-fee-eligibility')
 for start,end in [('CREATE FUNCTION public.fn_ca_promo_finish_event_principal()','-- The ordinary debit already owns'),('CREATE FUNCTION public.fn_ca_promo_roll_event_principal(','-- One original money owner, explicit source')]:
  e.sql(db,ticket[ticket.index(start):ticket.index(end)],label='retained-original-event-interface')
 e.sql(db,"ALTER TABLE accounting_tournament_fee_sources ADD COLUMN IF NOT EXISTS source_charge_ledger_id uuid,ADD COLUMN IF NOT EXISTS source_entitlement_id uuid;",label='exact-source-columns')
 integrity=root/'supabase/migrations/20261116161707_suspect_promo_chip_dumping_holds_only_attributable_incoming_.sql';remember(integrity)
 wrapper="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
 import subprocess
 def guarded(source,name):return subprocess.run(['node','--input-type=module','-e',wrapper,name],input=source,text=True,capture_output=True,check=True,cwd=root).stdout
 e.sql(db,guarded(integrity.read_text(),integrity.name),label='actual-H-applier')
 # Notification delivery has separate actual source proof. These sinks perform
 # no monetary write, and cannot qualify push/outbox delivery in this runner.
 e.sql(db,"CREATE FUNCTION public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz) RETURNS void LANGUAGE sql AS $$SELECT$$;CREATE FUNCTION public.fn_ca_promo_notice_support_override(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;",label='notification-only-adapter')
 cap_path=root/'tests/fixtures/promo-profit-bbj-financial/current-catalog.json';remember(cap_path);cap=json.loads(cap_path.read_text())
 winners_path=root/'tests/fixtures/promo-profit-bbj-financial/winners-catalog.json';remember(winners_path);winners=json.loads(winners_path.read_text());cap['tables']+=winners
 for relation in winners:
  for trigger in relation['triggers'] or []:e.sql(db,trigger['function_definition']+';',label='actual-bbj-winner-report-guard')
 helper_path=root/'tests/fixtures/promo-profit-bbj-financial/current-helpers.json';remember(helper_path)
 for row in json.loads(helper_path.read_text()):e.sql(db,row['definition']+';',label='actual-bbj-helper-'+row['name'])
 # Retain the existing authentic bank relation and financial triggers. Add only
 # current captured columns/new metadata tables, never replace a money owner.
 for row in cap['tables']:
  _,present,_=e.sql(db,"SELECT to_regclass('public."+row['name']+"') IS NOT NULL",label='relation-'+row['name'])
  if present.strip()=='f':
   e.sql(db,table_sql({**row,'constraints':[c for c in row['constraints'] or [] if c['type']!='t'],'grants':[],'policies':[],'indexes':row.get('indexes') or []}),label='current-bbj-table-'+row['name'])
  else:
   _,cols,_=e.sql(db,"SELECT coalesce(json_agg(attname),'[]') FROM pg_attribute WHERE attrelid='public."+row['name']+"'::regclass AND attnum>0 AND NOT attisdropped",label='columns-'+row['name'])
   existing=json.loads(cols)
   for col in row['columns']:
    if col['name'] not in existing:
     sql='ALTER TABLE public."'+row['name']+'" ADD COLUMN "'+col['name']+'" '+col['type']
     if col['default'] is not None:sql+=' DEFAULT '+col['default']
     if col['notnull']:sql+=' NOT NULL'
     e.sql(db,sql+';',label='current-bbj-column-'+col['name'])
 for row in cap['tables']:
  for fk in row['constraints'] or []:
   if fk['type']!='f':continue
   _,exists,_=e.sql(db,"SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public."+row['name']+"'::regclass AND conname='"+fk['name']+"')",label='fk-presence-'+fk['name'])
   if exists.strip()=='f':e.sql(db,'ALTER TABLE public."'+row['name']+'" ADD CONSTRAINT "'+fk['name']+'" '+fk['definition']+';',label='actual-bbj-fk-'+fk['name'])
 index_path=root/'tests/fixtures/promo-profit-bbj-financial/current-indexes.json';remember(index_path)
 for index in json.loads(index_path.read_text()):
  if index['constraint_backed']:continue
  _,found,_=e.sql(db,"SELECT to_regclass('public."+index['indexname']+"') IS NOT NULL",label='bbj-index-presence')
  if found.strip()=='f':e.sql(db,index['indexdef']+';',label='actual-bbj-index-'+index['indexname'])
  _,actual,_=e.sql(db,"SELECT pg_get_indexdef('public."+index['indexname']+"'::regclass)",label='actual-bbj-index-postimage')
  if actual.strip()!=index['indexdef']:raise RuntimeError('actual original BBJ index differs '+index['indexname'])
 publication=root/'tests/fixtures/promo-profit-bbj-financial/roster-publication.json';remember(publication)
 for row in json.loads(publication.read_text()):
  e.sql(db,row['definition']+';REVOKE ALL ON FUNCTION public.'+row['signature']+' FROM PUBLIC,anon,authenticated,service_role;',label='actual-roster-publication-owner')
  _,actual,_=e.sql(db,"SELECT md5(pg_get_functiondef('public."+row['signature']+"'::regprocedure))",label='actual-roster-publication-pin')
  if actual.strip()!=row['definition_md5']:raise RuntimeError('actual original roster publication differs')
 for row in cap['functions']:
  e.sql(db,row['definition']+';',label='actual-bbj-owner-'+row['name'])
  _,actual,_=e.sql(db,"SELECT md5(pg_get_functiondef('public."+row['signature']+"'::regprocedure))",label='actual-bbj-owner-pin')
  if actual.strip()!=row['definition_md5']:raise RuntimeError('actual original BBJ owner differs')
 # Apply exact frozen W bytes; no source writer is read during this run.
 full_w=args.profit_source.read_text();profit_snapshot=out/'profit-source.sql';profit_snapshot.write_text(full_w);remember(profit_snapshot);w=full_w.split('-- END ORIGINAL BBJ WINNINGS SOURCE',1)[0]+'\n-- END ORIGINAL BBJ WINNINGS SOURCE\nCOMMIT;\n'
 (out/'executed-W-core-and-BBJ.sql').write_text(w)
 e.sql(db,guarded(w,args.profit_source.name),label='actual-W-applier',seconds=60)
 mode_path=root/'tests/fixtures/promo-profit-bbj-financial/current-store-modes.json';remember(mode_path);modes=json.loads(mode_path.read_text())
 for key,table in [('coverage','ca_chip_store_coverage'),('store_modes','ca_ledger_invariant_store_mode')]:
  rows=modes[key];cols=list(rows[0]);updates=','.join(c+'=EXCLUDED.'+c for c in cols if c!='store')
  e.sql(db,'INSERT INTO public.'+table+'('+','.join(cols)+') SELECT '+','.join(cols)+" FROM jsonb_populate_recordset(NULL::public."+table+",'"+json.dumps(rows).replace("'","''")+"'::jsonb) ON CONFLICT(store) DO UPDATE SET "+updates,label='actual-bbj-mode-'+key)
 # Explicit already-accounted original opening, not a BBJ payment or cash
 # earning claim. All subsequent payments run with the real financial guards.
 e.sql(db,"""BEGIN; SET LOCAL session_replication_role=replica;
 UPDATE clubs SET asset='chips' WHERE id='20000000-0000-0000-0000-000000000001';
 UPDATE tables SET tournament_id=NULL,is_private=true WHERE id='88100000-0000-0000-0000-000000000001';
 INSERT INTO auth.users(id) VALUES('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002') ON CONFLICT(id) DO NOTHING;
 INSERT INTO profiles(id,username,display_name) VALUES('10000000-0000-0000-0000-000000000001','bbj_proof_one','BBJ Proof One'),('10000000-0000-0000-0000-000000000002','bbj_proof_two','BBJ Proof Two') ON CONFLICT(id) DO NOTHING;
 INSERT INTO club_members(club_id,user_id,role,chip_balance) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner',100),('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','player',100) ON CONFLICT(club_id,user_id) DO UPDATE SET chip_balance=100;
 INSERT INTO bbj_pools(id,club_id,main_balance,backup_balance,promo_balance,mini_reserve_floor) VALUES('77700000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1000,2000,0,0);
 INSERT INTO hand_history(id,table_id,hand_number,pot_size,game_variant,community_cards,actions,winners) VALUES('88400000-0000-0000-0000-000000000091','88100000-0000-0000-0000-000000000001',990091,200,'nlh','{}','[]','[]');
 SET LOCAL session_replication_role=origin;COMMIT;""",label='explicit-accounted-bank-opening')
 guard_path=root/'tests/fixtures/promo-profit-bbj-financial/current-guards.json';remember(guard_path)
 extra_guards=root/'tests/fixtures/promo-profit-bbj-financial/extra-guards.json';remember(extra_guards)
 for row in json.loads(guard_path.read_text())+json.loads(extra_guards.read_text()):e.sql(db,row['definition']+';',label='actual-bbj-guard-'+row['name'])
 for table in cap['tables']:
  for t in table['triggers'] or []:
   e.sql(db,'DROP TRIGGER IF EXISTS "'+t['name']+'" ON public."'+table['name']+'";'+t['definition']+';ALTER TABLE public."'+table['name']+'" '+('ENABLE ALWAYS' if t['enabled']=='A' else 'ENABLE')+' TRIGGER "'+t['name']+'";',label='actual-bbj-trigger-'+t['name'])
 e.sql(db,"""BEGIN;
 UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
 SELECT fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',50,'club_promo','bbj-financial-original');
 INSERT INTO ca_promo_cash_hand_clocks(hand_id,table_id,hand_number,accepted_at,profit_capture_version) VALUES('88400000-0000-0000-0000-000000000091','88100000-0000-0000-0000-000000000001',990091,clock_timestamp(),NULL);
 INSERT INTO ca_promo_profit_cash_investment(hand_id,grant_id,club_id,user_id,table_id,phase_id,principal_contribution,profit_contribution,eligible_contribution,total_contribution)
 SELECT '88400000-0000-0000-0000-000000000091',g.id,g.club_id,g.user_id,'88100000-0000-0000-0000-000000000001',f.id,50,0,50,100 FROM ca_promo_play_through_grants g JOIN ca_promo_profit_fee_phases f ON f.grant_id=g.id WHERE g.source_ref='bbj-financial-original';
 UPDATE ca_promo_cash_hand_clocks SET profit_capture_version=1 WHERE hand_id='88400000-0000-0000-0000-000000000091';
 INSERT INTO rake_attributions(hand_id,player_id,club_id,rake_amount) VALUES('88400000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',0),('88400000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',0);
 SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 SELECT * FROM bbj_atomic_payout_v2('77700000-0000-0000-0000-000000000001','88100000-0000-0000-0000-000000000001',990091,10,'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',ARRAY['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002']::uuid[],ARRAY[]::uuid[],'{}');
 SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='actual-main-bank-and-W-constructor',seconds=60)
 checks_path=root/'tests/fixtures/promo-profit-bbj-financial/main-bank-checks.sql';remember(checks_path)
 e.sql(db,file=checks_path,label='actual-main-numeric-replay-and-late-constructor-rollback',seconds=60)
 e.report['native'].append({'case':'actual-main100-bank-W-constructor-replay-and-late-fault','assertions':sum(1 for line in checks_path.read_text().splitlines() if line.lstrip().startswith('IF '))})
 e.report['qualification_limits']=['Original gift/accepted investment vectors are explicit already-accounted openings; actual main bank allocator, recipient money owner, real W constructor and financial guards execute. This does not qualify accepted-hand source production, mini/park full-bank payments, notification delivery, or production replica/admin-write policy. Notification-only callback adapters perform no financial writes.']
 e.report['status']='passed';e.report['source_sha256']={**manifest['source_sha256'],**tested}
 print('ACTUAL BBJ BANK/W FINANCIAL CLOSURE PASSED')
finally:
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\n')
