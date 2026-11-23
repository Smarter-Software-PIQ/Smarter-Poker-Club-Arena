#!/usr/bin/env python3
"""Qualify original promo returns on the maintained real financial PG17 closure.

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
p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
p.add_argument('--ticket-tree',type=Path,default=root)
p.add_argument('--custody-migration',type=Path,default=root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql')
p.add_argument('--return-migration',type=Path,default=root/'supabase/migrations/20261116154841_expired_and_departed_promo_principal_returns_to_its_original.sql')
p.add_argument('--refund-migration',type=Path,default=root/'supabase/migrations/20261123000232_a_refunded_entry_keeps_its_promo_with_the_player.sql')
ORIGINAL_SPENT_FEE_MD5='9de436b1f7c01c95f2b4574a37a9f3bb'
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
 # A refunded entry keeps its promo with the member (20261123000232). This
 # fixture has the original spent-fee owner, whose pin the migration admits
 # beside production's later body; no other byte of the migration changes.
 remember(args.refund_migration)
 original_spent_fee=e.sql(db,"SELECT md5(pg_get_functiondef('public.fn_ca_promo_return_spent_event_fee(uuid)'::regprocedure))",label='original-spent-fee-owner-pin')[1].strip()
 if original_spent_fee!=ORIGINAL_SPENT_FEE_MD5:raise SystemExit('original spent-fee owner pin changed: '+original_spent_fee)
 e.sql(db,file=args.refund_migration,label='promo-refunded-entry-keeps-promo')
 # A cloned original financial closure isolates the additional real reentry
 # case from every existing return/race opening. No provider or money adapter.
 bust_db=e.database(db)
 for path in [root/'supabase/migrations/20261010035502_stable_admin_engine_operator_commands.sql',root/'supabase/migrations/20261012181905_scoped_club_launch_reset_and_guarded_recovery.sql',root/'supabase/migrations/20261014231111_a_floor_park_is_a_lease_that_expires_and_pages_never_a_switc.sql',root/'supabase/migrations/20260917233447_tournament_original_funding_and_obligation_receipts.sql',root/'supabase/migrations/20260917060000_mtt_persisted_format_preparation.sql',root/'supabase/migrations/20261105223835_five_free_buy_tickets_a_day_for_every_player.sql']:remember(path)

 for path in [root/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql',root/'supabase/migrations/20260909165629_satellite_settlement_has_one_atomic_authority.sql',root/'supabase/migrations/20261030161824_started_tournament_abort_uses_original_charges_and_a_drained.sql',root/'supabase/migrations/20261031161513_tournament_original_twenty_can_withdraw_unsettled_abort.sql',root/'supabase/migrations/20261105035220_midway_free_buy_rotation_formats_and_promo_funded_entries.sql',root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/bust-reentry.sql',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/entry-entitlement-owners.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/purchase-owner.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/purchase-price-owner.json']:remember(path)
 fee_source=(root/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql').read_text()
 fee_cold=fee_source[fee_source.index('CREATE TABLE public.ca_promo_entry_fee_funding'):fee_source.index('REVOKE ALL ON FUNCTION public.fn_ca_promo_capture_entry_funding')]
 fee_cold+=fee_source[fee_source.index('REVOKE ALL ON FUNCTION public.fn_ca_promo_capture_entry_funding'):fee_source.index(';',fee_source.index('REVOKE ALL ON FUNCTION public.fn_ca_promo_capture_entry_funding'))+1]
 e.sql(bust_db,fee_cold,label='actual-original-entry-funding-contract')

 for row in json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/entry-entitlement-owners.json').read_text()):e.sql(bust_db,row['definition']+';',label='actual-entitlement-'+row['proname'][:25])
 original_charge=(root/'supabase/migrations/20260909165629_satellite_settlement_has_one_atomic_authority.sql').read_text()
 trigger=original_charge[original_charge.index('CREATE TRIGGER aa_ca_capture_tournament_charge_entitlement'):original_charge.index('-- The historical registration cores')]
 e.sql(bust_db,"SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='aa_ca_capture_tournament_charge_entitlement'",label='original-charge-entitlement-trigger')
 abort=(root/'supabase/migrations/20261030161824_started_tournament_abort_uses_original_charges_and_a_drained.sql').read_text()
 recovery=(root/'supabase/migrations/20261031161513_tournament_original_twenty_can_withdraw_unsettled_abort.sql').read_text()
 abort_tables=re.search(r'CREATE TABLE smarter_private[.]tournament_abort_targets.*?;',abort,re.S).group(0)+re.search(r'CREATE TABLE smarter_private[.]tournament_abort_recoveries.*?;',recovery,re.S).group(0)
 ingress=re.search(r'CREATE OR REPLACE FUNCTION smarter_private[.]tournament_abort_ingress.*?\$function\$.*?\$function\$',recovery,re.S).group(0)
 e.sql(bust_db,abort_tables+ingress+';',label='exact-empty-original-abort-ingress')
 original_operator=(root/'supabase/migrations/20261010035502_stable_admin_engine_operator_commands.sql').read_text()
 original_scope=(root/'supabase/migrations/20261012181905_scoped_club_launch_reset_and_guarded_recovery.sql').read_text()
 original_lease=(root/'supabase/migrations/20261014231111_a_floor_park_is_a_lease_that_expires_and_pages_never_a_switc.sql').read_text()
 empty_control=re.search(r'CREATE TABLE public[.]ca_operator_floor_hold[^;]*;',original_operator,re.S).group(0)
 empty_control+=re.search(r'CREATE TABLE public[.]ca_launch_operator_scopes[^;]*;',original_scope,re.S).group(0)
 empty_control+=re.search(r'ALTER TABLE public[.]ca_operator_floor_hold[^;]*;',original_lease,re.S).group(0)
 e.sql(bust_db,empty_control,label='exact-empty-original-operator-scope-relations')
 funding=(root/'supabase/migrations/20260917233447_tournament_original_funding_and_obligation_receipts.sql').read_text()
 funding=funding[funding.index('CREATE TABLE public.tournament_participant_funding_receipts'):funding.index('CREATE FUNCTION public.fn_ca_record_tournament_participant_funding')]
 e.sql(bust_db,funding,label='original-participant-funding-owner-and-receipts')
 admission=(root/'supabase/migrations/20260917060000_mtt_persisted_format_preparation.sql').read_text()
 admission=admission[admission.index('CREATE TABLE public.ca_mtt_admission_contract'):admission.index('-- Narrow recorded legacy shapes')]
 e.sql(bust_db,admission,label='original-supported-legacy-admission-contract')
 coupon=(root/'supabase/migrations/20261105223835_five_free_buy_tickets_a_day_for_every_player.sql').read_text()
 coupon=coupon[coupon.index('CREATE TABLE smarter_private.free_buy_ticket_redemptions'):coupon.index('CREATE FUNCTION smarter_private.free_buy_gaming_day')]
 e.sql(bust_db,coupon,label='exact-empty-original-coupon-redemptions')
 purchase=json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/purchase-owner.json').read_text())+json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/purchase-price-owner.json').read_text())
 priority={'fn_ca_unit_floor_cents':0,'fn_ca_tournament_fee_ratio':0,'fn_ca_recovery_fee_cents':1,'fn_ca_tournament_purchase_fee_ratio':1}
 for row in sorted(purchase,key=lambda row:priority.get(row['signature'].split('(')[0],2)):e.sql(bust_db,row['definition']+';',label='actual-price-'+row['signature'][:24])
 e.sql(bust_db,ticket[ticket.index('DO $purchase_owner$'):ticket.index('DO $refund_owner$')],label='actual-original-purchase-context-and-pin')
 free_format=(root/'supabase/migrations/20261105035220_midway_free_buy_rotation_formats_and_promo_funded_entries.sql').read_text()
 free_format=free_format[free_format.index('CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_format'):free_format.index('CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_pko')]
 e.sql(bust_db,free_format,label='actual-original-free-buy-predicate')
 seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql').read_text().split('SET LOCAL session_replication_role=origin;')[0]
 seed+='SET LOCAL session_replication_role=origin;\n'+(args.ticket_tree/'tests/fixtures/promo-ticket-play-through/bust-reentry.sql').read_text()
 e.sql(bust_db,seed,label='actual-promo-bust-reentry',seconds=60)
 e.report['native'].append({'case':'actual-promo-bust-reentry','assertions':16})

 e.sql(db,"""BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO public.profiles(id,username,display_name) VALUES('10000000-0000-0000-0000-000000000002','promo_return_two','Promo Return Two') ON CONFLICT(id) DO NOTHING;
UPDATE public.clubs SET promo_balance=1000 WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE public.club_members SET chip_balance=80 WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002';
SET LOCAL session_replication_role=origin;
UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',50,'club_promo','native-return',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
SELECT set_config('app.ledger_idempotency_key','native-parent-request',true),set_config('app.ledger_tournament','30000000-0000-0000-0000-000000000001',true),set_config('app.ledger_settlement','93000000-0000-0000-0000-000000000001',true),set_config('app.ledger_correlation','93000000-0000-0000-0000-000000000002',true),set_config('app.ledger_tournament_id','30000000-0000-0000-0000-000000000001',true),set_config('app.ledger_hand_id','93000000-0000-0000-0000-000000000003',true);
DO $$DECLARE result numeric;gid uuid;BEGIN
SELECT id INTO STRICT gid FROM public.ca_promo_play_through_grants WHERE source_ref='native-return';
result:=public.fn_ca_promo_return_principal(gid,'player_wallet','returned',20,'native-return-1');
IF result<>20 THEN RAISE EXCEPTION 'partial principal return differs: %',result;END IF;
IF current_setting('app.ledger_idempotency_key',true)<>'native-parent-request' OR current_setting('app.ledger_tournament',true)<>'30000000-0000-0000-0000-000000000001' OR current_setting('app.ledger_settlement',true)<>'93000000-0000-0000-0000-000000000001' OR current_setting('app.ledger_correlation',true)<>'93000000-0000-0000-0000-000000000002' OR current_setting('app.ledger_tournament_id',true)<>'30000000-0000-0000-0000-000000000001' OR current_setting('app.ledger_hand_id',true)<>'93000000-0000-0000-0000-000000000003' THEN RAISE EXCEPTION 'principal return leaked original journal context';END IF;
IF EXISTS(SELECT 1 FROM public.chip_ledger WHERE idempotency_key LIKE 'promo_principal_return:%' AND (tournament_id IS NOT NULL OR hand_id IS NOT NULL OR settlement_id IS NOT NULL)) THEN RAISE EXCEPTION 'principal return borrowed parent tournament/settlement identity';END IF;
IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002')<>60 THEN RAISE EXCEPTION 'partial return took unrelated money';END IF;
IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1020 THEN RAISE EXCEPTION 'original club fund did not receive return';END IF;
END$$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;""",label='actual-partial-return-financial-closure')
 e.report['native'].append({'case':'actual-partial-return-financial-closure','assertions':5})
 e.sql(db,"""BEGIN;
 DO $$DECLARE gid uuid;paid numeric;blocked boolean:=false;BEGIN
 SELECT id INTO STRICT gid FROM public.ca_promo_play_through_grants WHERE source_ref='native-return';
 paid:=public.fn_ca_promo_return_principal(gid,'player_wallet','returned',20,'native-return-1');
 IF paid<>20 OR (SELECT count(*) FROM public.ca_promo_principal_return_receipts)<>1 THEN RAISE EXCEPTION 'same original return did not replay';END IF;
 BEGIN PERFORM public.fn_ca_promo_return_principal(gid,'player_wallet','returned',10,'native-return-1');
 EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'changed original refund intent was accepted';END IF;
 IF (SELECT remaining FROM public.ca_promo_play_through_grants WHERE id=gid)<>30 OR (SELECT fee_target FROM public.ca_promo_play_through_grants WHERE id=gid)<>200 THEN RAISE EXCEPTION 'partial return changed original target or principal';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='stable-return-intent-replay')
 e.report['native'].append({'case':'stable-return-intent-replay','assertions':3})
 e.sql(db,"""BEGIN;
 ALTER TABLE public.chip_ledger ADD CONSTRAINT promo_native_journal_fault CHECK(idempotency_key NOT LIKE 'promo_principal_return:%') NOT VALID;
 DO $$DECLARE gid uuid;blocked boolean:=false;BEGIN
 SELECT id INTO STRICT gid FROM public.ca_promo_play_through_grants WHERE source_ref='native-return';
 BEGIN PERFORM public.fn_ca_promo_return_principal(gid,'player_wallet','returned',10,'native-fault');
 EXCEPTION WHEN check_violation THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'original return ignored canonical journal failure';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002')<>60 OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1020 THEN RAISE EXCEPTION 'journal refusal retained a balance mutation';END IF;
 IF (SELECT remaining FROM public.ca_promo_play_through_grants WHERE id=gid)<>30 OR EXISTS(SELECT 1 FROM public.ca_promo_principal_return_receipts WHERE operation_ref='native-fault') THEN RAISE EXCEPTION 'journal refusal retained custody or receipt';END IF;
 END$$;
 ALTER TABLE public.chip_ledger DROP CONSTRAINT promo_native_journal_fault;
 SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='original-journal-fault-is-atomic')
 e.report['native'].append({'case':'original-journal-fault-is-atomic','assertions':3})
 e.sql(db,"""BEGIN;
 UPDATE public.ca_promo_play_through_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE source_ref='native-return';
 INSERT INTO public.engine_maintenance_break(id,phase,announced_at,break_started_at,break_ends_at,reason,updated_at,enforce_freeze,ownership_token)
 VALUES(true,'counting_down',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 second',clock_timestamp()+interval '4 minutes','Native Product Freeze',now(),true,'95000000-0000-0000-0000-000000000001')
 ON CONFLICT(id) DO UPDATE SET phase=EXCLUDED.phase,announced_at=EXCLUDED.announced_at,break_started_at=EXCLUDED.break_started_at,break_ends_at=EXCLUDED.break_ends_at,reason=EXCLUDED.reason,updated_at=EXCLUDED.updated_at,enforce_freeze=true,ownership_token=EXCLUDED.ownership_token;
 DO $$DECLARE result jsonb;BEGIN
 result:=public.fn_ca_promo_expire_principal(100);
 IF (result->>'frozen')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'expiry ignored actual platform freeze: %',result;END IF;
 IF (SELECT remaining FROM public.ca_promo_play_through_grants WHERE source_ref='native-return')<>30 OR (SELECT count(*) FROM public.ca_promo_principal_return_receipts)<>1 THEN RAISE EXCEPTION 'frozen expiry changed principal or receipts';END IF;
 END$$;ROLLBACK;
 """,label='actual-platform-freeze-refuses-expiry')
 e.report['native'].append({'case':'actual-platform-freeze-refuses-expiry','assertions':2})
 e.sql(db,"""BEGIN;
 UPDATE public.ca_promo_play_through_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE source_ref='native-return';
 DO $$DECLARE result jsonb;blocked boolean:=false;BEGIN
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 BEGIN PERFORM public.fn_ca_promo_expire_principal(100);EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'browser reached product expiry owner';END IF;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 result:=public.fn_ca_promo_expire_principal(100);
 IF (result->>'returned')::numeric<>30 THEN RAISE EXCEPTION 'product expiry amount differs: %',result;END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002')<>30 THEN RAISE EXCEPTION 'expiry took unrestricted profit';END IF;
 IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1050 OR (SELECT close_reason FROM public.ca_promo_play_through_grants WHERE source_ref='native-return')<>'expired' THEN RAISE EXCEPTION 'expiry original fund/closure differs';END IF;
 result:=public.fn_ca_promo_expire_principal(100);
 IF (result->>'returned')::numeric<>0 THEN RAISE EXCEPTION 'product expiry replay paid again';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='actual-product-expiry-and-replay')
 e.report['native'].append({'case':'actual-product-expiry-and-replay','assertions':5})
 e.sql(db,"""BEGIN;
 SET LOCAL session_replication_role=replica;
 UPDATE public.club_members SET chip_balance=70 WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002';
 UPDATE public.clubs SET promo_balance=1010 WHERE id='20000000-0000-0000-0000-000000000001';
 SET LOCAL session_replication_role=origin;
 SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',40,'club_promo','native-leave',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
 SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
 SET LOCAL request.jwt.claim.role='authenticated';
 DO $$DECLARE result jsonb;BEGIN
 result:=public.fn_member_leave_to_treasury('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
 IF (result->>'success')::boolean IS DISTINCT FROM true OR (result->>'chips_returned')::numeric<>30 THEN RAISE EXCEPTION 'original departure did not preserve unrestricted remainder: %',result;END IF;
 IF EXISTS(SELECT 1 FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'original member deletion did not commit';END IF;
 IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1050 OR (SELECT chip_treasury FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1030 THEN RAISE EXCEPTION 'departure original-fund/treasury conservation differs';END IF;
 IF (SELECT close_reason FROM public.ca_promo_play_through_grants WHERE source_ref='native-leave')<>'left_club' THEN RAISE EXCEPTION 'original departure did not retire its grant';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='actual-original-member-departure')
 e.report['native'].append({'case':'actual-original-member-departure','assertions':4})
 e.sql(db,"""BEGIN;
 SET LOCAL session_replication_role=replica;
 INSERT INTO public.agents(club_id,user_id,role,status,agent_wallet_balance,promo_wallet_balance,is_prepaid,credit_limit,credit_used,commission_rate,player_rakeback_rate) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','agent','active',100,0,true,0,0,0,0);
 SET LOCAL session_replication_role=origin;
 SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';SET LOCAL request.jwt.claim.role='authenticated';
 DO $$DECLARE result jsonb;gid uuid;BEGIN
 result:=public.fn_promo_disburse('club','20000000-0000-0000-0000-000000000001','player','10000000-0000-0000-0000-000000000001',50,'Native Principal Grant','20000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000001');
 IF (result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'original promo producer refused: %',result;END IF;
 SELECT id INTO STRICT gid FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001' AND closed_at IS NULL;
 IF (SELECT amount FROM public.ca_promo_principal_custody WHERE grant_id=gid AND kind='player_wallet')<>50 THEN RAISE EXCEPTION 'actual disbursement did not capture original principal';END IF;
 result:=public.fn_club_wallet_claim_back('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',50,'player_wallet','agent_wallet','Native Own Wallet','94000000-0000-0000-0000-000000000002',NULL);
 IF (result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'original own claim refused: %',result;END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','agent_wallet','10000000-0000-0000-0000-000000000001')<>50 THEN RAISE EXCEPTION 'own claim lost original principal';END IF;
 result:=public.fn_agent_wallet_self_stake('20000000-0000-0000-0000-000000000001',110,'Native Own Stake','94000000-0000-0000-0000-000000000003');
 IF (result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'original self stake refused: %',result;END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>10 THEN RAISE EXCEPTION 'self stake did not spend unrestricted chips first';END IF;
 result:=public.fn_agent_wallet_self_stake('20000000-0000-0000-0000-000000000001',110,'Native Own Stake','94000000-0000-0000-0000-000000000003');
 IF (result->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'self stake did not replay';END IF;
 result:=public.fn_agent_wallet_send_core_20260830('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',10,'player_wallet','Native Own Send','94000000-0000-0000-0000-000000000004');
 IF (result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'original own send refused: %',result;END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>20 THEN RAISE EXCEPTION 'own send did not move exact original principal';END IF;
 result:=public.fn_club_wallet_claim_back('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',110,'player_wallet','agent_wallet','Native Own Claim','94000000-0000-0000-0000-000000000005',NULL);
 IF (result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'second original own claim refused: %',result;END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>10 OR public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','agent_wallet','10000000-0000-0000-0000-000000000001')<>40 THEN RAISE EXCEPTION 'own claim reset principal across wallets';END IF;
 IF (SELECT count(*) FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001')<>1 OR (SELECT fee_target FROM public.ca_promo_play_through_grants WHERE id=gid)<>200 THEN RAISE EXCEPTION 'own wallet movement created another target';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='actual-disbursement-and-owned-wallet-operators')
 e.report['native'].append({'case':'actual-disbursement-and-owned-wallet-operators','assertions':12})
 e.sql(db,"""BEGIN;
 SET LOCAL session_replication_role=replica;
 INSERT INTO public.unions(id,name,owner_id,slug) VALUES('96000000-0000-0000-0000-000000000001','Native Original Promo Fund','10000000-0000-0000-0000-000000000001','native-original-promo-fund');
 INSERT INTO public.union_clubs(union_id,club_id) VALUES('96000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
 INSERT INTO public.union_wallets(union_id,chip_balance,promo_wallet) VALUES('96000000-0000-0000-0000-000000000001',0,1000);
 UPDATE public.clubs SET union_id='96000000-0000-0000-0000-000000000001' WHERE id='20000000-0000-0000-0000-000000000001';
 SET LOCAL session_replication_role=origin;
 SET LOCAL request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';SET LOCAL request.jwt.claim.role='service_role';
 DO $$DECLARE result jsonb;BEGIN
 result:=public.fn_promo_disburse('union','96000000-0000-0000-0000-000000000001','player','10000000-0000-0000-0000-000000000001',20,'Native Union Principal','20000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000002');
 IF (result->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'original union promo producer refused: %',result;END IF;
 IF (SELECT promo_wallet FROM public.union_wallets WHERE union_id='96000000-0000-0000-0000-000000000001')<>980 THEN RAISE EXCEPTION 'union promo producer debited wrong source';END IF;
 END$$;
 UPDATE public.ca_promo_play_through_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id='10000000-0000-0000-0000-000000000001' AND closed_at IS NULL;
 DO $$DECLARE result jsonb;BEGIN
 result:=public.fn_ca_promo_expire_principal(100);
 IF (result->>'returned')::numeric<>70 THEN RAISE EXCEPTION 'multi-fund/wallet expiry differs: %',result;END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>0 OR (SELECT agent_wallet_balance FROM public.agents WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>100 THEN RAISE EXCEPTION 'expiry took original unrestricted agent chips';END IF;
 IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1050 OR (SELECT promo_wallet FROM public.union_wallets WHERE union_id='96000000-0000-0000-0000-000000000001')<>1000 THEN RAISE EXCEPTION 'expiry credited the wrong original promo fund';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_principal_return_receipts r JOIN public.chip_ledger l ON l.id=r.ledger_id WHERE r.funded_from_type='union_wallet' AND r.funded_from_id='96000000-0000-0000-0000-000000000001' AND r.amount=20 AND l.to_label='union_wallets.promo_wallet') THEN RAISE EXCEPTION 'union promo return journal does not name its original source column';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001' AND closed_at IS NULL) THEN RAISE EXCEPTION 'multi-wallet expiry left principal active';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='original-union-and-agent-wallet-principal-return')
 e.report['native'].append({'case':'original-union-and-agent-wallet-principal-return','assertions':7})
 e.sql(db,"""BEGIN;
 SET LOCAL session_replication_role=replica;
 INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object('id','97000000-0000-0000-0000-000000000001','name','Native Original Entry Refund','status','REGISTERING','buy_in_amount',18,'buy_in_fee',2,'prize_pool',18,'total_rake',2,'guaranteed_prize',0,'prize_pool_finalized',false))).* FROM public.tournaments t WHERE t.id='30000000-0000-0000-0000-000000000001';
 INSERT INTO public.tournament_escrow(tournament_id,gross_in,fee_entries_in,satellite_fee_in,bounty_in,overlay_in,satellite_in,prize_out,bounty_out,fee_out,refund_prize,refund_bounty,refund_fee,reserve_out,reserve_in,prize_balance,bounty_balance,fee_balance,opened_from,opened_at,updated_at,enforced)
 VALUES('97000000-0000-0000-0000-000000000001',20,2,0,0,0,0,0,0,0,0,0,0,0,0,18,0,2,'native-already-funded-entry',now(),now(),true);
 UPDATE public.clubs SET promo_balance=1040 WHERE id='20000000-0000-0000-0000-000000000001';
 SET LOCAL session_replication_role=origin;
 SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',10,'club_promo','native-exact-refund',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
 SET LOCAL session_replication_role=replica;
 INSERT INTO public.chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id,created_at,status)
 VALUES('97000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','prize_liability','97000000-0000-0000-0000-000000000001',20,'tournament_buyin','20000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001',clock_timestamp(),'posted');
 INSERT INTO public.tournament_refund_entitlements(id,tournament_id,user_id,entitlement_kind,charge_category,refund_wallet_club_id,gross,refund_prize,refund_bounty,refund_fee,source_ledger_id,escrow_bucket,evidence_kind)
 VALUES('97000000-0000-0000-0000-000000000003','97000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','wallet_charge','tournament_buyin','20000000-0000-0000-0000-000000000001',20,18,0,2,'97000000-0000-0000-0000-000000000002','wallet_gross','atomic_wallet_charge');
 SET LOCAL session_replication_role=origin;
 SELECT public.fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','event','97000000-0000-0000-0000-000000000001',10);
 INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining) SELECT id,'97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000002','native-original-entry',10,10 FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund';
 SELECT public.fn_ca_promo_consume_entry_fee('97000000-0000-0000-0000-000000000002');
 INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;
 DO $$DECLARE result jsonb;credit uuid;paid numeric;BEGIN
 result:=public.fn_settle_tournament_refund_exact('97000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',20,18,0,2,'atomic_cancel_tournament','Native Original Refund');
 IF (result->>'fully_settled')::boolean IS DISTINCT FROM true OR (result->>'paid')::numeric<>20 THEN RAISE EXCEPTION 'original exact refund refused: %',result;END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>20 OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1040 THEN RAISE EXCEPTION 'exact refund took promo away from the member or moved the fund';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund' AND closed_at IS NULL AND close_reason IS NULL AND remaining=10 AND amount=10 AND fee_target=40) THEN RAISE EXCEPTION 'exact refund did not keep the original open grant whole';END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>10 OR public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','event','97000000-0000-0000-0000-000000000001')<>0 THEN RAISE EXCEPTION 'refunded promo is not locked in the member wallet';END IF;
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_return_receipts WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund')) THEN RAISE EXCEPTION 'exact refund still paid promo to the fund';END IF;
 IF NOT(SELECT count(*)=1 AND sum(amount)=1 FROM public.ca_promo_refund_restore_receipts WHERE reason='fee_refund' AND grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund')) THEN RAISE EXCEPTION 'refunded promo fee was not restored exactly once';END IF;
 IF (SELECT count(*) FROM public.tournament_refund_tranches WHERE entitlement_id='97000000-0000-0000-0000-000000000003')<>1 THEN RAISE EXCEPTION 'original refund tranche was not consumed exactly once';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id='97000000-0000-0000-0000-000000000001' AND (prize_balance<>0 OR fee_balance<>0 OR bounty_balance<>0)) THEN RAISE EXCEPTION 'original refund escrow did not balance';END IF;
 credit:=(result->>'credit_ledger_id')::uuid;
 paid:=public.fn_ca_promo_return_refunded_principal(credit);
 IF paid<>0 OR EXISTS(SELECT 1 FROM public.ca_promo_principal_return_receipts WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund')) OR (SELECT count(*) FROM public.ca_promo_refund_restore_receipts WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund'))<>1 OR (SELECT remaining FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund')<>10 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>20 THEN RAISE EXCEPTION 'refund replay moved promo or restored it twice';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='actual-exact-entry-refund-keeps-promo-with-the-member')
 e.report['native'].append({'case':'actual-exact-entry-refund-keeps-promo-with-the-member','assertions':10})
 # The promo the refund left with the member is still ordinary locked
 # principal: the original return owner can send it home, which also leaves
 # the wallet and fund the later fee cases open from.
 e.sql(db,"""BEGIN;DO $$DECLARE paid numeric;BEGIN
 paid:=public.fn_ca_promo_return_principal((SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund'),'player_wallet','returned',NULL,'member-return-after-refund');
 IF paid<>10 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>10 OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1050 OR (SELECT close_reason FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund')<>'returned' THEN RAISE EXCEPTION 'kept refunded promo could not go home through its original owner';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='kept-refunded-promo-returns-through-original-owner')
 e.report['native'].append({'case':'kept-refunded-promo-returns-through-original-owner','assertions':4})
 # Typed opening facts describe an already-funded entry. The fee-source
 # trigger, original exact refund, all fund/wallet journals and deferred guards
 # are real. Actual fee production is separately qualified by the fee lane.
 for promo,closed,lost,cross in [(10,False,False,False),(20,False,False,False),(10,True,False,False),(10,True,True,False),(10,False,False,True)]:
  fee_db=e.database(db);event,charge,entitlement,record,source=[str(uuid.uuid4()) for _ in range(5)]
  label='fee-refund-'+str(promo)+('-lost' if lost else '-closed' if closed else '-active')+('-satellite-cross-club' if cross else '')
  wallet_club='20000000-0000-0000-0000-000000000099' if cross else '20000000-0000-0000-0000-000000000001'
  source_user='30000000-0000-0000-0000-000000000001' if cross else '10000000-0000-0000-0000-000000000001'
  source_type='prize_liability' if cross else 'player_wallet'
  source_meta=json.dumps({'user_id':'10000000-0000-0000-0000-000000000001','registration_id':entitlement}) if cross else '{}'
  if cross:
   e.sql(fee_db,f"""BEGIN;SET LOCAL session_replication_role=replica;
 INSERT INTO public.clubs SELECT (jsonb_populate_record(NULL::public.clubs,to_jsonb(c)||jsonb_build_object('id','{wallet_club}','club_id',99999999,'name','Promo Cross Host','promo_balance',1000))).* FROM public.clubs c WHERE c.id='20000000-0000-0000-0000-000000000001';
 INSERT INTO public.club_members SELECT (jsonb_populate_record(NULL::public.club_members,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'club_id','{wallet_club}','chip_balance',10))).* FROM public.club_members m WHERE m.club_id='20000000-0000-0000-0000-000000000001' AND m.user_id='10000000-0000-0000-0000-000000000001';
 COMMIT;""",label='satellite-cross-original-refund-wallet-opening')

  e.sql(fee_db,f"""BEGIN;
 SET LOCAL session_replication_role=replica;
 INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object('id','{event}','club_id','{wallet_club}','name','Native Source Fee Refund','status','REGISTERING','buy_in_amount',18,'buy_in_fee',2,'prize_pool',18,'total_rake',2,'guaranteed_prize',0,'prize_pool_finalized',false))).* FROM public.tournaments t WHERE t.id='30000000-0000-0000-0000-000000000001';
 INSERT INTO public.tournament_escrow(tournament_id,gross_in,fee_entries_in,satellite_fee_in,bounty_in,overlay_in,satellite_in,prize_out,bounty_out,fee_out,refund_prize,refund_bounty,refund_fee,reserve_out,reserve_in,prize_balance,bounty_balance,fee_balance,opened_from,opened_at,updated_at,enforced)
 VALUES('{event}',{18 if cross else 20},{0 if cross else 2},{2 if cross else 0},0,0,0,0,0,0,0,0,0,0,0,18,0,2,'native-already-funded-entry',now(),now(),true);
 UPDATE public.clubs SET promo_balance=1050-{promo} WHERE id='20000000-0000-0000-0000-000000000001';
 INSERT INTO public.chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,tournament_id,created_at,status,metadata)
 VALUES('{charge}','10000000-0000-0000-0000-000000000001','{source_type}','{source_user}','prize_liability','{event}',20,'tournament_buyin','{wallet_club}','{event}',clock_timestamp(),'posted','{source_meta}'::jsonb);
 INSERT INTO public.tournament_refund_entitlements(id,tournament_id,user_id,entitlement_kind,charge_category,refund_wallet_club_id,gross,refund_prize,refund_bounty,refund_fee,source_ledger_id,escrow_bucket,evidence_kind,registration_id,source_satellite_id,source_award_place)
 VALUES('{entitlement}','{event}','10000000-0000-0000-0000-000000000001','{('satellite_seat' if cross else 'wallet_charge')}','{('satellite_seat' if cross else 'tournament_buyin')}','{wallet_club}',20,18,0,2,'{charge}','{('satellite_gross' if cross else 'wallet_gross')}','{('atomic_satellite_seat' if cross else 'atomic_wallet_charge')}',{("'"+entitlement+"'" if cross else 'NULL')},{("'30000000-0000-0000-0000-000000000001'" if cross else 'NULL')},{('1' if cross else 'NULL')});
 {("INSERT INTO public.tournament_players(id,tournament_id,user_id,club_id,status) VALUES('"+entitlement+"','"+event+"','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','registered');" if cross else '')}
 INSERT INTO public.rake_records(id,tournament_id,club_id,is_tournament,rake_amount,metadata,created_at)
 VALUES('{record}','{event}','20000000-0000-0000-0000-000000000001',true,2,'{{}}',clock_timestamp());
 INSERT INTO public.accounting_tournament_fee_batches(rake_record_id,tournament_id,source_fingerprint,status,source_version,source_manifest,rake_amount)
 SELECT '{record}','{event}',public.fn_accounting_tournament_fee_fingerprint(r),'captured',2,'{{}}',2 FROM public.rake_records r WHERE id='{record}';
 SET LOCAL session_replication_role=origin;
 SELECT public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',{promo},'club_promo','{label}',NULL,'promo_wallet','20000000-0000-0000-0000-000000000001');
 SELECT public.fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','event','{event}',{promo});
 INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,charge_ledger_id,source_ref,original_amount,remaining) SELECT id,'{event}','{charge}','{label}',{promo},{promo} FROM public.ca_promo_play_through_grants WHERE source_ref='{label}';
 SELECT public.fn_ca_promo_consume_entry_fee('{charge}');
 DO $$DECLARE p numeric;BEGIN
 SELECT principal INTO p FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id='{charge}';
 IF p<>{promo}/10.0 OR (SELECT remaining FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id='{charge}')<>{promo}-{promo}/10.0 THEN RAISE EXCEPTION 'actual fee recognition retained spent principal';END IF;
 IF (SELECT fee_target FROM public.ca_promo_play_through_grants WHERE source_ref='{label}')<>{promo}*4 THEN RAISE EXCEPTION 'fee spend changed original target';END IF;
 END$$;
 SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label=label+'-source')
  if lost:
   candidate=str(uuid.uuid4())
   e.sql(fee_db,f"""BEGIN;
 INSERT INTO public.ca_promo_event_entry_loss_receipts(candidate_id,registration_id,tournament_id,club_id,user_id,table_id,hand_id,hand_number,operation_ref,principal,charge_ledger_ids) VALUES('{candidate}','{entitlement}','{event}','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',gen_random_uuid(),gen_random_uuid(),1,'typed-authoritative-prior-entry-loss',{promo}*0.9,ARRAY['{charge}'::uuid]);
 INSERT INTO public.ca_promo_event_entry_loss_slices SELECT '{candidate}',id,grant_id,charge_ledger_id,remaining FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id='{charge}';
 UPDATE public.ca_promo_event_principal_lots SET remaining=0 WHERE charge_ledger_id='{charge}';
 UPDATE public.ca_promo_principal_custody SET amount=0 WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='{label}');
 UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE source_ref='{label}';COMMIT;""",label=label+'-original-loss-receipt-opening')
  if closed and not lost:
   e.sql(fee_db,f"""BEGIN;UPDATE public.ca_promo_principal_custody SET amount=0 WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='{label}');UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='met' WHERE source_ref='{label}';COMMIT;""",label=label+'-matured-opening-state')
   e.sql(fee_db,"ALTER TABLE public.chip_ledger ADD CONSTRAINT native_fee_return_fault CHECK(NOT(category='reversal' AND amount=1)) NOT VALID;",label='actual-fee-return-ledger-fault')
   e.sql(fee_db,f"""DO $$BEGIN
 BEGIN
 PERFORM public.fn_settle_tournament_refund_exact('{event}','10000000-0000-0000-0000-000000000001','{wallet_club}',20,18,0,2,'atomic_cancel_tournament','Native Fee Refund');
 RAISE EXCEPTION 'actual fee return journal failure was swallowed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001')<>10 OR EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id='{entitlement}') THEN RAISE EXCEPTION 'failed fee refund retained credit or tranche';END IF;
 END$$;ALTER TABLE public.chip_ledger DROP CONSTRAINT native_fee_return_fault;""",label='actual-fee-refund-fault-rolls-back-credit-and-tranche')
  if cross:
   e.sql(fee_db,f"""DO $$BEGIN
 BEGIN
 PERFORM public.fn_settle_tournament_refund_exact('{event}','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',20,18,0,2,'atomic_cancel_tournament','Wrong Physical Refund Wallet');
 RAISE EXCEPTION 'wrong physical recipient unexpectedly accepted';EXCEPTION WHEN SQLSTATE 'P0404' THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id='{entitlement}') OR (SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001')<>10 THEN RAISE EXCEPTION 'wrong physical refund recipient leaked money';END IF;
 END$$;""",label='satellite-cross-wrong-physical-wallet-refuses')
  # An open grant in the refund wallet's own club keeps everything with the
  # member. A closed grant is terminal and a cross-club wallet cannot carry the
  # lock, so both keep the original fund return.
  kept=not closed and not cross
  to_fund=0 if kept else (promo/10 if closed and not lost else promo)
  expected_wallet=30-to_fund;expected_fund=1050-promo+to_fund
  e.sql(fee_db,f"""BEGIN;DO $$DECLARE result jsonb;credit uuid;paid numeric;BEGIN
 result:=public.fn_settle_tournament_refund_exact('{event}','10000000-0000-0000-0000-000000000001','{wallet_club}',20,18,0,2,'atomic_cancel_tournament','Native Fee Refund');
 IF (result->>'paid')::numeric<>20 THEN RAISE EXCEPTION 'actual original fee refund refused: %',result;END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001')<>{expected_wallet} OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>{expected_fund} THEN RAISE EXCEPTION 'fee refund returned wrong amount or took unrelated cash';END IF;
 IF (SELECT count(*) FROM public.ca_promo_principal_return_receipts WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='{label}') AND reason='fee_refund' AND amount={promo}/10.0)<>{0 if kept else 1} THEN RAISE EXCEPTION 'original spent-fee fund receipt count wrong';END IF;
 IF (SELECT count(*) FROM public.ca_promo_refund_restore_receipts WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='{label}') AND reason='fee_refund' AND amount={promo}/10.0)<>{1 if kept else 0} THEN RAISE EXCEPTION 'restored spent-fee receipt count wrong';END IF;
 {("IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE source_ref='"+label+"' AND closed_at IS NULL AND remaining="+str(promo)+") OR public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001')<>"+str(promo)+" THEN RAISE EXCEPTION 'open grant did not keep its whole refunded promo locked in the wallet';END IF;" if kept else '')}
 {("IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>10 OR (SELECT promo_balance FROM public.clubs WHERE id='"+wallet_club+"')<>1000 OR (SELECT club_id FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id='"+charge+"')<>'20000000-0000-0000-0000-000000000001'::uuid THEN RAISE EXCEPTION 'satellite earner/source fund confused with physical refund wallet';END IF;" if cross else '')}

 IF (SELECT fee_target FROM public.ca_promo_play_through_grants WHERE source_ref='{label}')<>{promo}*4 OR (SELECT COALESCE(close_reason,'open') FROM public.ca_promo_play_through_grants WHERE source_ref='{label}')<>'{('spent' if lost else 'met' if closed else 'open' if kept else 'returned')}' THEN RAISE EXCEPTION 'fee refund reopened or rewrote original grant';END IF;
 END$$; INSERT INTO public.accounting_tournament_fee_sources(id,rake_record_id,tournament_id,player_id,club_id,game_type,registration_id,source_charge_ledger_id,source_entitlement_id,charged_at,rake_credit,contract)
 VALUES('{source}','{record}','{event}','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','NLH','{entitlement}','{charge}','{entitlement}',clock_timestamp(),2,'{{"rake_credit":2}}');
 DO $$DECLARE credit uuid;paid numeric;BEGIN
 SELECT credit_ledger_id INTO credit FROM public.tournament_refund_tranches WHERE entitlement_id='{entitlement}';paid:=public.fn_ca_promo_return_spent_event_fee(credit);
 IF paid<>{0 if kept else promo if lost else promo/10} OR (SELECT count(*) FROM public.ca_promo_principal_return_receipts WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='{label}') AND reason='fee_refund')<>{0 if kept else 1} OR (SELECT count(*) FROM public.ca_promo_refund_restore_receipts WHERE grant_id=(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='{label}'))<>{1 if kept else 0} OR (SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001')<>{expected_wallet} THEN RAISE EXCEPTION 'spent-fee response-loss replay changed money';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id='{event}' AND (prize_balance<>0 OR fee_balance<>0)) THEN RAISE EXCEPTION 'actual fee refund escrow did not conserve';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label=label+'-actual-refund-return-and-replay')
  e.report['native'].append({'case':label,'assertions':10+(2 if closed else 0)+(3 if cross else 0),'opening_limit':'already-funded entry and recognized fee batch facts; all refund journals and deferred guards actual'})
 e.sql(db,"""DO $$BEGIN
 IF has_function_privilege('authenticated','public.fn_ca_promo_return_principal(uuid,text,text,numeric,text)','EXECUTE') OR has_function_privilege('authenticated','public.fn_ca_promo_leave_principal(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'browser can invoke private principal return';END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='promo-principal-product-expiry' AND schedule='*/15 * * * *' AND command='SELECT public.fn_ca_promo_expire_principal(100)') THEN RAISE EXCEPTION 'product expiry schedule registration differs';END IF;
 END$$;""",label='private-owner-and-product-schedule')
 e.report['native'].append({'case':'private-owner-and-product-schedule','assertions':2})
 # Deterministic stock PostgreSQL schedules exercise the exact financial
 # owners. The first caller intentionally preholds its real source fund/member,
 # as the existing weekly gift doors do, before entering the cashier lane.
 binary=native.stock_isolationtester(e.pg);e.report['isolationtester']={'path':str(binary),'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
 race=e.database(db)
 spec="""session "gift"
step "gift_begin" { BEGIN; }
step "gift_prelock" { SELECT 1 FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001' FOR UPDATE; SELECT 1 FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001' FOR UPDATE; }
step "gift_send" { DO $$BEGIN BEGIN PERFORM public.fn_promo_disburse('club','20000000-0000-0000-0000-000000000001','player','10000000-0000-0000-0000-000000000001',5,'Native Preheld Gift','20000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001'); EXCEPTION WHEN SQLSTATE '55P03' THEN RAISE EXCEPTION 'NATIVE55P03: %',SQLERRM USING ERRCODE='55P03'; END; END$$; }
step "gift_abort" { ROLLBACK; }
step "gift_unchanged" { DO $$BEGIN IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1050 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>10 OR EXISTS(SELECT 1 FROM public.chip_transactions WHERE metadata->>'op_id'='98000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'preheld gift refusal retained money';END IF;END$$; }
step "gift_retry" { SELECT public.fn_promo_disburse('club','20000000-0000-0000-0000-000000000001','player','10000000-0000-0000-0000-000000000001',5,'Native Preheld Gift','20000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001')->>'success'; }
step "gift_replay" { SELECT public.fn_promo_disburse('club','20000000-0000-0000-0000-000000000001','player','10000000-0000-0000-0000-000000000001',5,'Native Preheld Gift','20000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001')->>'replayed'; }
session "lane"
step "lane_begin" { BEGIN; }
step "lane_hold" { SELECT pg_advisory_xact_lock(hashtextextended('agent-agreement:20000000-0000-0000-0000-000000000001',0)),pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:20000000-0000-0000-0000-000000000001',0)); }
step "lane_fund" { SELECT 1 FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001' FOR UPDATE; }
step "lane_commit" { COMMIT; }
permutation "gift_begin" "gift_prelock" "lane_begin" "lane_hold" "lane_fund" "gift_send" "gift_abort" "gift_unchanged" "lane_commit" "gift_retry" "gift_replay"
"""
 rc,stdout,stderr=e.run('original-gift-preheld-source-race',[binary,f'host={e.socket} port={e.port} dbname={race} user=postgres'],text=spec,seconds=30,check=False)
 errors=[line for line in stdout.splitlines() if line.startswith('ERROR:')]
 if rc or stderr.strip() or errors!=['ERROR:  NATIVE55P03: promo_cashier_lane_busy'] or sum(line.strip()=='true' for line in stdout.splitlines())!=2:raise RuntimeError('original preheld gift did not refuse atomically and replay: '+stdout+stderr)
 e.sql(race,"""DO $$BEGIN
 IF (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1045 OR (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>15 OR (SELECT count(*) FROM public.chip_transactions WHERE metadata->>'op_id'='98000000-0000-0000-0000-000000000001')<>1 THEN RAISE EXCEPTION 'preheld gift retry did not conserve exactly one payment';END IF;
 END$$;""",label='original-gift-race-conservation')
 e.report['races'].append({'case':'original-gift-preheld-fund-member-vs-cashier-lane','assertions':4,'outcome':'55P03 then exact-key retry/replay, one payment'})
 # Two independent requests replay the same return intent after waiting on
 # its original fund; distinct requests can consume only surviving principal.
 returns=e.database(db)
 e.sql(returns,"""SELECT public.fn_promo_disburse('union','96000000-0000-0000-0000-000000000001','player','10000000-0000-0000-0000-000000000001',30,'Native Concurrent Return','20000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');""",label='actual-concurrent-return-grant')
 def return_schedule(first,second):
  return """session "a"
step "a_begin" { BEGIN; }
step "a_return" { SELECT public.fn_ca_promo_return_principal((SELECT id FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001' AND source_ref LIKE 'chip_ledger:%' AND amount=30),'player_wallet','returned',20,'"""+first+"""'); }
step "a_commit" { COMMIT; }
session "b"
step "b_begin" { BEGIN; }
step "b_return" { SELECT public.fn_ca_promo_return_principal((SELECT id FROM public.ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000001' AND source_ref LIKE 'chip_ledger:%' AND amount=30),'player_wallet','returned',20,'"""+second+"""'); }
step "b_commit" { COMMIT; }
permutation "a_begin" "b_begin" "a_return" "b_return" "a_commit" "b_commit"
"""
 rc,stdout,stderr=e.run('same-original-return-intent-race',[binary,f'host={e.socket} port={e.port} dbname={returns} user=postgres'],text=return_schedule('native-race-duplicate','native-race-duplicate'),seconds=30,check=False)
 if rc or stderr.strip() or 'ERROR:' in stdout:raise RuntimeError('same return race failed: '+stdout+stderr)
 e.sql(returns,"""DO $$BEGIN
 IF (SELECT count(*) FROM public.ca_promo_principal_return_receipts WHERE operation_ref='native-race-duplicate')<>1 OR (SELECT amount FROM public.ca_promo_principal_return_receipts WHERE operation_ref='native-race-duplicate')<>20 THEN RAISE EXCEPTION 'concurrent duplicate return created multiple receipts';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>20 OR (SELECT promo_wallet FROM public.union_wallets WHERE union_id='96000000-0000-0000-0000-000000000001')<>990 THEN RAISE EXCEPTION 'concurrent duplicate return paid twice';END IF;
 END$$;""",label='same-original-return-one-payment')
 e.report['races'].append({'case':'same-original-return-intent','assertions':3,'outcome':'two callers, one twenty-chip return'})
 rc,stdout,stderr=e.run('different-original-return-intents-race',[binary,f'host={e.socket} port={e.port} dbname={returns} user=postgres'],text=return_schedule('native-race-remainder-a','native-race-remainder-b'),seconds=30,check=False)
 if rc or stderr.strip() or 'ERROR:' in stdout:raise RuntimeError('bounded remaining return race failed: '+stdout+stderr)
 e.sql(returns,"""DO $$BEGIN
 IF (SELECT sum(amount) FROM public.ca_promo_principal_return_receipts WHERE operation_ref LIKE 'native-race-%')<>30 THEN RAISE EXCEPTION 'different requests exceeded surviving original principal';END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>10 OR (SELECT promo_wallet FROM public.union_wallets WHERE union_id='96000000-0000-0000-0000-000000000001')<>1000 THEN RAISE EXCEPTION 'concurrent remaining return took unrelated real chips';END IF;
 END$$;""",label='different-original-return-preserves-real-cash')
 e.report['races'].append({'case':'different-original-return-intents','assertions':3,'outcome':'remaining ten chips returned once; ten real chips untouched'})
 e.report['status']='passed'
finally:
 e.report['source_sha256']={**manifest['source_sha256'],**tested}
 e.report['fixture_limits']=current['limits']+['Provider cron registration adapter only; no scheduler runs in the fixture.']
 e.report['current_function_pins']=len(current['functions']);e.report['current_financial_triggers']=len(current['triggers'])
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\n')
