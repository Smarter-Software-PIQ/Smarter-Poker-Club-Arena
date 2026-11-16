#!/usr/bin/env python3
"""Qualify original promo returns on the maintained real financial PG17 closure.

No production mutations. Actual autoledger, tally and deferred journal guards
come from the existing bound financial foundation, never replacement functions.
"""
import argparse,os,sys,json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'scripts/ci'))
from satellite_qualifier_fixture import module,table_sql
hs=module(root/'scripts/ci/test-hand-submission.py','promo_returns_hs')
native=module(root/'scripts/ci/test-mtt-unlimited.py','promo_returns_native')
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
p.add_argument('--ticket-tree',type=Path,default=root)
p.add_argument('--custody-migration',type=Path,default=root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql')
p.add_argument('--current-financial',type=Path,default=root/'tests/fixtures/promo-principal-returns/current-financial-owners.json')
p.add_argument('--disburse-owner',type=Path,default=root/'tests/fixtures/promo-principal-returns/disburse.sql')
args=p.parse_args();current=json.loads(args.current_financial.read_text())
if sys.platform=='darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):raise SystemExit('external TMPDIR required')
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
manifest=hs.prepare(root,out)
tested={};
def remember(path):
 path=path.resolve();key=str(path.relative_to(root)) if path.is_relative_to(root) else str(path);tested[key]=hashlib.sha256(path.read_bytes()).hexdigest()
for path in [Path(__file__),args.current_financial,args.disburse_owner,root/'tests/fixtures/promo-principal-returns/journal-owners.json']+[root/'tests/fixtures/promo-principal-returns/self-stake.sql',root/'tests/fixtures/promo-principal-returns/agent-send.sql',root/'tests/fixtures/promo-principal-returns/claim-back.sql',root/'tests/fixtures/promo-principal-returns/member-leave.sql']:remember(path)
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
 for file in sorted((root/'supabase/migrations').glob('*_promo_play_through_*.sql')):
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
 remember(args.ticket_tree/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_direct_entries_retain_principal.sql')
 ticket=(args.ticket_tree/'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_direct_entries_retain_principal.sql').read_text()
 cold=ticket[ticket.index('CREATE TABLE public.ca_promo_event_principal_lots'):ticket.index('-- Coupon allowance is not money.')]
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
 remember(root/'supabase/migrations/20261116154841_expired_and_departed_promo_principal_returns_to_its_original.sql')
 e.sql(db,file=root/'supabase/migrations/20261116154841_expired_and_departed_promo_principal_returns_to_its_original.sql',label='promo-original-returns')
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
 INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;
 DO $$DECLARE result jsonb;credit uuid;paid numeric;BEGIN
 result:=public.fn_settle_tournament_refund_exact('97000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',20,18,0,2,'atomic_cancel_tournament','Native Original Refund');
 IF (result->>'fully_settled')::boolean IS DISTINCT FROM true OR (result->>'paid')::numeric<>20 THEN RAISE EXCEPTION 'original exact refund refused: %',result;END IF;
 IF (SELECT chip_balance FROM public.club_members WHERE club_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001')<>10 OR (SELECT promo_balance FROM public.clubs WHERE id='20000000-0000-0000-0000-000000000001')<>1050 THEN RAISE EXCEPTION 'exact refund did not separate original promo from own cash';END IF;
 IF (SELECT close_reason FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund')<>'returned' THEN RAISE EXCEPTION 'exact refund did not close its original principal';END IF;
 IF (SELECT count(*) FROM public.tournament_refund_tranches WHERE entitlement_id='97000000-0000-0000-0000-000000000003')<>1 THEN RAISE EXCEPTION 'original refund tranche was not consumed exactly once';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_escrow WHERE tournament_id='97000000-0000-0000-0000-000000000001' AND (prize_balance<>0 OR fee_balance<>0 OR bounty_balance<>0)) THEN RAISE EXCEPTION 'original refund escrow did not balance';END IF;
 credit:=(result->>'credit_ledger_id')::uuid;
 paid:=public.fn_ca_promo_return_refunded_principal(credit);
 IF paid<>10 OR (SELECT count(*) FROM public.ca_promo_principal_return_receipts WHERE operation_ref='event_refund:'||credit||':'||(SELECT id FROM public.ca_promo_play_through_grants WHERE source_ref='native-exact-refund'))<>1 THEN RAISE EXCEPTION 'original refund return replay changed its intent';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;
 """,label='actual-exact-entry-refund-and-original-fund-return')
 e.report['native'].append({'case':'actual-exact-entry-refund-and-original-fund-return','assertions':6})
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
