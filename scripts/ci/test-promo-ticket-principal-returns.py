#!/usr/bin/env python3
"""Original noncash refund source/fund conservation under authentic financial guards."""
from pathlib import Path
FIRST=Path(__file__).resolve().parents[2]
BOOT_SOURCE=(FIRST/'scripts/ci/test-promo-principal-returns.py').read_text()
s=(FIRST/'scripts/ci/test-promo-principal-returns.py').read_text();s=s[:s.index(" seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql').read_text().split('SET LOCAL session_replication_role=origin;')[0]")].replace('root=Path(__file__).resolve().parents[2]','root=Path('+repr(str(FIRST))+')')
s=s.replace('args=p.parse_args();',"p.add_argument('--profit-source',type=Path,default=root/'supabase/migrations/20261116190221_promo_winnings_retain_original_source_until_two_times_paid_f.sql');args=p.parse_args();")
body=r'''
 db=bust_db
 originals=json.loads((args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json').read_text())
 for row in originals:
  if row['proname']=='fn_ca_return_satellite_entitlement_as_ticket':e.sql(db,row['definition']+';',label='original-private-return-owner')
 for row in json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-target-dependency.json').read_text())+json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-admission-scope-dependencies.json').read_text())+json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-admission-dependencies.json').read_text())+json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-admission-owners.json').read_text()):
  e.sql(db,'SET check_function_bodies=off;'+row['definition']+';SET check_function_bodies=on;',label='actual-original-ticket-admission')
 import ast
 financial_path=root/'scripts/ci/test-promo-tournament-earning-financial.py';remember(financial_path)
 tree=ast.parse(financial_path.read_text());financial_body=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='body' for t in n.targets))
 financial_body=financial_body[:financial_body.index(" seed=(root/'scripts/ci/probes/bounty-rebuy-generation-atomicity.sql')")]
 financial_body=financial_body.replace(' profit_root=proof_profit_root',' profit_root=root').replace('proof_runner','Path(__file__)').replace('generation=proof_migration','generation=next((args.ticket_tree/"supabase/migrations").glob("20261116200638_*.sql"))').replace("migration=next((profit_root/'supabase/migrations').glob(version+'_*.sql'))","migration=args.profit_source if version=='20261116190221' else next((profit_root/'supabase/migrations').glob(version+'_*.sql'))")
 exec(compile('if True:\n'+financial_body,'actual-full-H-W-generation','exec'))
 cap=json.loads((root/'tests/fixtures/promo-ticket-principal-returns/current-ticket-guards.json').read_text())[0]['catalog']
 # Exact original ticket guard plus counted store and deferred refusal.
 for row in cap['triggers']:
  if row['name'] in ('tournament_satellite_entry_ticket_is_guarded','zy_ca_tally_store_move','zz_ca_store_has_its_ledger_row'):
   if row['name']=='tournament_satellite_entry_ticket_is_guarded':e.sql(db,'SET check_function_bodies=off;'+row['function']+';SET check_function_bodies=on;',label='actual-ticket-guard')
   e.sql(db,'DROP TRIGGER IF EXISTS '+row['name']+' ON public.tournament_tickets;'+row['definition']+';',label='actual-ticket-trigger')
 companion=root/'supabase/migrations/20261116214149_returned_promo_ticket_principal_goes_to_its_original_fund_wi.sql';remember(companion)
 import subprocess
 wrapper="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
 guarded=subprocess.run(['node','--input-type=module','-e',wrapper,companion.name],input=companion.read_text(),text=True,capture_output=True,check=True,cwd=root).stdout
 _,inventory_before,_=e.sql(db,"SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))",label='inventory-source-before')
 _,guard_before,_=e.sql(db,"SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)",label='actual-admission-pin-before')
 _,acl_before,_=e.sql(db,"SELECT proowner::text||':'||proacl::text FROM pg_proc WHERE oid='public.fn_ca_guard_mtt_admission_contract()'::regprocedure",label='actual-admission-pin-acl-before')
 e.sql(db,guarded,label='maintained-original-ticket-split')
 _,inventory_after,_=e.sql(db,"SELECT md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))",label='inventory-source-after')
 _,guard_after,_=e.sql(db,"SELECT pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure)",label='actual-admission-pin-after')
 _,admission_hash,_=e.sql(db,"SELECT md5(pg_get_functiondef('public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)'::regprocedure))",label='actual-new-admission-hash')
 _,acl_after,_=e.sql(db,"SELECT proowner::text||':'||proacl::text FROM pg_proc WHERE oid='public.fn_ca_guard_mtt_admission_contract()'::regprocedure",label='actual-admission-pin-acl-after')
 needle='"signature":"public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)","definition_md5":"8a9b893eeb07cbcf518782391e757c2c"'
 expected=guard_before.replace(needle,needle.replace('8a9b893eeb07cbcf518782391e757c2c',admission_hash.strip()))
 if guard_before.count(needle)!=1 or expected!=guard_after or acl_before!=acl_after or inventory_before!=inventory_after:raise RuntimeError('original source guard or ACL changed beyond exact admitted owner pin')
 e.report['native'].append({'case':'exact-admission-pin-only-and-inventory-unchanged','assertions':4})
 base=db
 seed_start=BOOT_SOURCE.index('  e.sql(fee_db,f"""BEGIN;\n SET LOCAL',BOOT_SOURCE.index(' for promo,closed,lost,cross'))+len('  e.sql(fee_db,f"""')
 seed_end=BOOT_SOURCE.index("\"\"\",label=label+'-source')",seed_start)
 seed_template=BOOT_SOURCE[seed_start:seed_end]
 for mode in ['met','active','lost','terminal']:
  db=e.database(base);event,charge,entitlement,record,source=[str(uuid.uuid4()) for _ in range(5)]
  promo=10 if mode=='active' else 20;cross=True;wallet_club='20000000-0000-0000-0000-000000000001';source_user='30000000-0000-0000-0000-000000000001';source_type='prize_liability';source_meta=json.dumps({'user_id':'10000000-0000-0000-0000-000000000001','registration_id':entitlement});label='ticket-'+mode
  e.sql(db,"UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';",label='prospective-native-programme-on')
  opening=eval('f'+chr(34)*3+seed_template+chr(34)*3)
  if mode=='active':
   injection=f""" SELECT public.fn_ca_promo_profit_credit_owned('cash_win','{source}',id,'{wallet_club}','10000000-0000-0000-0000-000000000001','event','{event}',10) FROM public.ca_promo_play_through_grants WHERE source_ref='{label}';
 INSERT INTO public.ca_promo_profit_event_charge_receipts VALUES('{charge}','{wallet_club}','10000000-0000-0000-0000-000000000001',10,0);
 INSERT INTO public.ca_promo_profit_event_lots SELECT id,'{charge}','{event}','{wallet_club}','10000000-0000-0000-0000-000000000001',10,10 FROM public.ca_promo_play_through_grants WHERE source_ref='{label}';
"""
   opening=opening.replace(" SELECT public.fn_ca_promo_consume_entry_fee",injection+" SELECT public.fn_ca_promo_consume_entry_fee")
   opening=opening.replace(" SET CONSTRAINTS ALL IMMEDIATE;COMMIT;",f" SELECT public.fn_ca_promo_profit_finish_entry_fee('{charge}'); SET CONSTRAINTS ALL IMMEDIATE;COMMIT;")
  e.sql(db,opening,label='original-paid-entry-'+mode)
  if mode=='met':
   e.sql(db,"BEGIN;UPDATE public.ca_promo_principal_custody SET amount=0;UPDATE public.ca_promo_event_principal_lots SET remaining=0;UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='met';COMMIT;",label='typed-final-earned-release')
  if mode=='lost':
   candidate=str(uuid.uuid4());e.sql(db,f"""BEGIN;INSERT INTO public.ca_promo_event_entry_loss_receipts(candidate_id,registration_id,tournament_id,club_id,user_id,table_id,hand_id,hand_number,operation_ref,principal,charge_ledger_ids) VALUES('{candidate}','{entitlement}','{event}','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',gen_random_uuid(),gen_random_uuid(),1,'typed-original-bust',18,ARRAY['{charge}'::uuid]);INSERT INTO public.ca_promo_event_entry_loss_slices SELECT '{candidate}',id,grant_id,charge_ledger_id,remaining FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id='{charge}';UPDATE public.ca_promo_event_principal_lots SET remaining=0;UPDATE public.ca_promo_principal_custody SET amount=0;UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent';COMMIT;""",label='typed-original-bust-opening')
  if mode=='terminal':
   e.sql(db,f"""BEGIN;INSERT INTO public.ca_promo_event_terminal_loss_slices(tournament_id,lot_id,grant_id,charge_ledger_id,club_id,user_id,amount,terminal_status) SELECT tournament_id,id,grant_id,charge_ledger_id,'{wallet_club}','10000000-0000-0000-0000-000000000001',remaining,'CANCELLED' FROM public.ca_promo_event_principal_lots;UPDATE public.ca_promo_event_principal_lots SET remaining=0;UPDATE public.ca_promo_principal_custody SET amount=0;UPDATE public.ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent';COMMIT;""",label='typed-original-terminal-loss-opening')
  e.sql(db,"INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT(source) DO NOTHING;",label='actual-authority-source')
  e.sql(db,f"""BEGIN;
ALTER TABLE public.chip_ledger ADD CONSTRAINT ticket_return_native_fault CHECK(idempotency_key NOT LIKE 'promo_ticket_fee_return:%') NOT VALID;
DO $$BEGIN BEGIN PERFORM public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');RAISE EXCEPTION 'fault not reached';EXCEPTION WHEN check_violation THEN NULL;END;
IF EXISTS(SELECT 1 FROM public.tournament_tickets WHERE source_refund_entitlement_id='{entitlement}') OR EXISTS(SELECT 1 FROM public.ca_promo_ticket_principal_fee_returns) OR (SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}')<>{1050-promo} THEN RAISE EXCEPTION 'late journal fault retained asset/fund/receipt';END IF;END$$;
ALTER TABLE public.chip_ledger DROP CONSTRAINT ticket_return_native_fault;
SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-ticket-fault-'+mode)
  expected=2 if mode=='met' else 10 if mode=='active' else 20;face=18 if mode=='met' else 10 if mode=='active' else 0
  e.sql(db,f"""BEGIN;
SELECT public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
DO $$DECLARE ack jsonb;before_count int;BEGIN
IF (SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}')<>{1050-promo}+{expected} OR (SELECT sum(amount) FROM public.ca_promo_ticket_principal_fee_returns)<>{expected} THEN RAISE EXCEPTION 'wrong original fund return';END IF;
IF (SELECT CASE WHEN status='cancelled' THEN 0 ELSE value END FROM public.tournament_tickets WHERE source_refund_entitlement_id='{entitlement}')<>{face} THEN RAISE EXCEPTION 'wrong usable net asset';END IF;
IF EXISTS(SELECT 1 FROM public.tournament_refund_tranches) OR (SELECT chip_balance FROM public.club_members WHERE club_id='{wallet_club}' AND user_id='10000000-0000-0000-0000-000000000001')<>0 THEN RAISE EXCEPTION 'refund created personal cash';END IF;
IF (SELECT fee_target FROM public.ca_promo_play_through_grants WHERE source_ref='{label}')<>{promo}*4 OR (SELECT closed_at FROM public.ca_promo_play_through_grants WHERE source_ref='{label}') IS NULL THEN RAISE EXCEPTION 'refund revived/repriced gift';END IF;
SELECT count(*) INTO before_count FROM public.chip_ledger;
ack:=public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
IF (ack->>'value')::numeric<>{face} OR ack->>'replayed'<>'true' OR (SELECT count(*) FROM public.chip_ledger)<>before_count OR (SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}')<>{1050-promo}+{expected} THEN RAISE EXCEPTION 'original same intent replay changed effect';END IF;
END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-ticket-return-'+mode)
  if mode=='active':
   target=str(uuid.uuid4())
   e.sql(db,f"""BEGIN;SET LOCAL session_replication_role=replica;
INSERT INTO public.tournaments SELECT(jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object('id','{target}','name','Original Net Ticket Admission','status','REGISTERING','buy_in_amount',9,'buy_in_fee',1,'prize_pool',0,'total_rake',0,'bounty_pool',0,'bounty_amount',0,'is_bounty',false,'is_pko',false,'is_mystery_bounty',false,'is_vip_only',false,'authorized_to_register',false,'current_players',0,'max_players',1000,'prize_pool_finalized',false,'start_time',now()+interval '1 hour'))).* FROM public.tournaments t WHERE t.id='{event}';
SET LOCAL session_replication_role=origin;SELECT public.fn_ca_escrow_apply('{target}','native original net ticket admission');COMMIT;""",label='typed-empty-net-ticket-target')
   e.sql(db,f"""BEGIN;
DO $$DECLARE result jsonb;ticket uuid;before_fund numeric;before_ledgers int;BEGIN
SELECT id INTO STRICT ticket FROM public.tournament_tickets WHERE source_refund_entitlement_id='{entitlement}';
IF EXISTS(SELECT 1 FROM public.tournament_refund_entitlements old_e JOIN public.tournament_tickets old_t ON old_t.source_refund_entitlement_id=old_e.id WHERE old_t.id=ticket AND old_e.gross=old_t.value) THEN RAISE EXCEPTION 'original gross-only net-ticket regression not demonstrated';END IF;
IF (SELECT sum(amount) FROM public.ca_promo_profit_custody WHERE kind='ticket' AND entity_id=ticket)<>10 THEN RAISE EXCEPTION 'net asset lacks exact restored original W';END IF;
SELECT promo_balance INTO before_fund FROM public.clubs WHERE id='{wallet_club}';
result:=public.fn_ca_register_for_tournament_with_ticket_for('{target}',ticket,'10000000-0000-0000-0000-000000000001');
IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'original net ticket admission refused %',result;END IF;
IF (SELECT amount FROM public.ca_promo_profit_ticket_sources WHERE ticket_id=ticket)<>10 THEN RAISE EXCEPTION 'ticket snapshot retained gross funding';END IF;
IF (SELECT sum(amount) FROM public.ca_promo_profit_custody WHERE kind='ticket' AND entity_id=ticket)<>0 OR (SELECT original_profit FROM public.ca_promo_profit_event_charge_receipts WHERE charge_ledger_id=(result->>'ledger_id')::uuid)<>10 THEN RAISE EXCEPTION 'original net W did not move once';END IF;
SELECT count(*) INTO before_ledgers FROM public.chip_ledger;
result:=public.fn_ca_register_for_tournament_with_ticket_for('{target}',ticket,'10000000-0000-0000-0000-000000000001');
IF result->>'replayed'<>'true' OR (SELECT count(*) FROM public.chip_ledger)<>before_ledgers THEN RAISE EXCEPTION 'original ticket redemption replay duplicated money';END IF;
result:=public.fn_ca_return_satellite_entitlement_as_ticket('{entitlement}','atomic_cancel_tournament','Original cancelled entry');
IF result->>'replayed'<>'true' OR (result->>'value')::numeric<>10 OR (SELECT promo_balance FROM public.clubs WHERE id='{wallet_club}')<>before_fund OR (SELECT count(*) FROM public.chip_ledger)<>before_ledgers THEN RAISE EXCEPTION 'post-redemption original refund replay duplicated money';END IF;
END$$;SET CONSTRAINTS ALL IMMEDIATE;COMMIT;""",label='actual-original-net-ticket-redemption')
  e.report['native'].append({'case':'actual-ticket-return-'+mode,'assertions':13 if mode=='active' else 6})
 e.report['status']='passed'
 for path in list((root/'tests/fixtures/promo-ticket-principal-returns').glob('*.json'))+[Path(__file__),root/'scripts/ci/test-promo-principal-returns.py',root/'scripts/ci/migration-stale-pins.mjs',root/'tests/fixtures/promo-ticket-principal-returns/current-ticket-guards.json',args.ticket_tree/'tests/fixtures/promo-ticket-play-through/generation-nonwallet-owners.json']:remember(path)
 e.report['source_sha256']={**manifest['source_sha256'],**tested}
 e.report['current_function_pins']=len(current['functions']);e.report['current_financial_triggers']=len(current['triggers'])
 e.report['qualification_limits']=['Real original private returned-ticket issuer, escrow refund owner, original bank/journal/31financial guards plus actual ticket immutable/tally/deferred guards execute. Original paid noncash entry, earned completion, bust and terminal loss are explicit typed prior-state openings; this does not qualify their producers or public cancel/unregister reachability. Full W/H earning/movement and fee-return consumers are qualified separately; this source returns only exact original P cost. No player-wallet credit or cash refund tranche.']
finally:
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\n')
'''
exec(compile(s+body,__file__,'exec'))
