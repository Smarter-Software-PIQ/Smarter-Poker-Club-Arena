import argparse,sys,json,hashlib
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/ci'))
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
from tournament_abort_native import install_f06_extension,sql_file,SERVICE
p=argparse.ArgumentParser(description='Qualify bank-funded refunds using real isolated financial components.')
for key in ('pg-bin','evidence','work-root','socket-root'):p.add_argument('--'+key,type=Path,required=True)
a=p.parse_args()
out=a.evidence.resolve();out.mkdir(parents=True,exist_ok=False)
n=module(ROOT/'scripts/ci/test-mtt-unlimited.py','bank_native')
e=n.Execution(ROOT,out,a.pg_bin.resolve(),a.work_root.resolve(),300,socket_parent=a.socket_root.resolve())
try:
 e.start();db=e.database();install_financial_foundation(e,db,ROOT,out);install_f06_extension(e,db,ROOT)
 # The older, merged but uninstalled inline house disposition is permanently
 # refused before any schema or financial statement can execute.
 old=ROOT/'supabase/migrations/20261102150315_the_fifteen_frozen_diamond_events_close_and_their_diamonds_g.sql'
 rc,_,err=e.sql(db,old.read_text(),label='superseded-house-disposition',check=False)
 if rc==0 or 'owner_house_disposition_superseded_use_verified_kingfish_retirement' not in err:raise RuntimeError('superseded house disposition was not refused before writes')

 diamond=module(ROOT/'scripts/ci/fixtures/tournament-abort/diamond/diamond_abort_native.py','bank_diamond');diamond.install_diamond_extension(e,db,ROOT)
 bank_catalog=json.loads((ROOT/'scripts/ci/fixtures/tournament-abort/owner-bank-refund-catalog.json').read_text())
 for f in bank_catalog['functions']:
  sql_file(e,db,'actual-'+f['signature'].split('(')[0],f['definition']+';')
 sql_file(e,db,'actual-bank-reserve-guard',"CREATE TABLE IF NOT EXISTS public.diamond_game_pools(host_id uuid NOT NULL,game text NOT NULL,rounds bigint NOT NULL DEFAULT 0,intake_diamonds numeric NOT NULL DEFAULT 0,chips_minted numeric NOT NULL DEFAULT 0,chips_paid numeric NOT NULL DEFAULT 0,reserved_chips numeric NOT NULL DEFAULT 0,constrained_rounds bigint NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),wheel_allocated_diamonds numeric NOT NULL DEFAULT 0);DROP TRIGGER IF EXISTS diamond_game_union_reserves ON public.union_wallets;CREATE TRIGGER diamond_game_union_reserves BEFORE UPDATE OF promo_wallet,chip_balance ON public.union_wallets FOR EACH ROW EXECUTE FUNCTION public.fn_diamond_game_reserved_cover_guard();")
 for row in bank_catalog['coverage']:
  values=','.join("'"+str(row[k]).replace("'","''")+"'" for k in ('store','treatment','counted_by','notes'))
  sql_file(e,db,'actual-store-'+row['store'],'INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES('+values+') ON CONFLICT(store) DO NOTHING;')
 seed=(ROOT/'scripts/ci/probes/satellite-cancel-current-native.sql').read_text().split('-- Fund the source through')[0].replace('ON COMMIT DROP;','ON COMMIT PRESERVE ROWS;')
 # Fixture keys and prices only; the actual request-owned registration is unchanged.
 replacements={'d3000000-0000-4000-8000-000000000002':'2781bcd7-cc8a-4713-ab3e-0d0a81fdf110','d1000000-0000-4000-8000-000000000001':'eed278a8-3ca2-4e2d-a196-0a0cd9e74f90','d2000000-0000-4000-8000-000000000002':'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',"'Cancellation Entrant Target',90,10,1000":"'Cancellation Entrant Target',4.5,0.5,1000",'FROM 100::numeric':'FROM 5::numeric','FROM 10::numeric':'FROM 0.5::numeric','IS DISTINCT FROM 100::numeric':'IS DISTINCT FROM 195::numeric','AND e.gross=100 AND e.refund_prize=90':'AND e.gross=5 AND e.refund_prize=4.5','AND e.refund_bounty=0 AND e.refund_fee=10':'AND e.refund_bounty=0 AND e.refund_fee=0.5','AND r.rake_amount=10':'AND r.rake_amount=0.5'}
 # Keep independent entry result checks with corrected opening bank balance.
 for a,b in replacements.items():seed=seed.replace(a,b)
 seed=seed.replace('IS DISTINCT FROM 5::numeric\n     OR (SELECT count(*)','IS DISTINCT FROM 195::numeric\n     OR (SELECT count(*)')
 sql_file(e,db,'real-five-chip-entry','BEGIN;'+seed+'COMMIT;')
 prefix=(ROOT/'supabase/migrations/20261102152756_owner_tournament_deletion_replaces_equal_share_intent.sql').read_text().split('DO $$BEGIN')[0]+'COMMIT;'
 sql_file(e,db,'actual-owner-manifest-schema',prefix)
 sql_file(e,db,'synthetic-source-identities',"""BEGIN;SET LOCAL session_replication_role=replica;
 INSERT INTO public.unions(id,name,owner_id,slug) VALUES('fade0000-0000-0000-0000-000000000001','Native Midway Main Bank','2d1cd6c3-5700-4af9-a271-d4863fdab20d','native-midway');
 INSERT INTO public.union_wallets(union_id,chip_balance) VALUES('fade0000-0000-0000-0000-000000000001',1000);
 UPDATE public.tournaments SET status='RUNNING',union_id='fade0000-0000-0000-0000-000000000001',started_at=(SELECT original_started_at FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id='2781bcd7-cc8a-4713-ab3e-0d0a81fdf110') WHERE id='2781bcd7-cc8a-4713-ab3e-0d0a81fdf110';
 UPDATE public.chip_ledger SET id='322489e1-e6a3-4f6e-a8b9-50f66d7866a5' WHERE id=(SELECT source_ledger_id FROM public.tournament_refund_entitlements WHERE tournament_id='2781bcd7-cc8a-4713-ab3e-0d0a81fdf110');
 UPDATE public.tournament_refund_entitlements SET id='26b465dd-600d-42eb-9f37-68f6052febac',source_ledger_id='322489e1-e6a3-4f6e-a8b9-50f66d7866a5' WHERE tournament_id='2781bcd7-cc8a-4713-ab3e-0d0a81fdf110';
 COMMIT;""")
 sql_file(e,db,'exact-bank-refund-candidate',(ROOT/'supabase/migrations/20261102161821_owner_retirement_main_bank_funds_exact_player_refunds.sql').read_text())
 call="public.fn_ca_owner_retirement_bank_refund('26b465dd-600d-42eb-9f37-68f6052febac')"
 def snapshot(label):
  names=['union_wallets','union_wallet_transactions','club_members','chip_ledger','wallet_transactions','wallet_credit_idempotency','tournament_escrow','tournament_players','tournament_refund_tranches','tournament_obligations','tournament_refund_entitlements']
  query="SELECT jsonb_build_object("+','.join("'"+name+"',(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."+name+" x)" for name in names)+",'receipts',(SELECT jsonb_agg(to_jsonb(x)) FROM smarter_private.owner_retirement_bank_refunds x));"
  return e.sql(db,query,label=label)[1]
 before=snapshot('before-refund')
 sql_file(e,db,'bank-funded-refund-rolled-back','BEGIN;'+SERVICE+'SELECT '+call+';SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;')
 assert snapshot('after-rollback')==before
 def refuse(label,setup,reason,expression=call):
  sql_file(e,db,label,"BEGIN;"+SERVICE+setup+"DO $$DECLARE rejected boolean:=false;BEGIN BEGIN PERFORM "+expression+";EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '"+reason+"%' THEN RAISE;END IF;rejected:=true;END;IF NOT rejected THEN RAISE EXCEPTION 'expected refusal missing';END IF;END$$;ROLLBACK;")
  assert snapshot(label+'-unchanged')==before
 refuse('browser-denied',"SET LOCAL ROLE authenticated;",'permission denied for function')
 refuse('foreign-entitlement','', 'owner_refund_outside_verified_manifest',call.replace('26b465dd-600d-42eb-9f37-68f6052febac','ffffffff-ffff-4fff-8fff-ffffffffffff'))
 refuse('reserved-bank-cannot-pay',"SET LOCAL session_replication_role=replica;INSERT INTO public.diamond_game_pools(host_id,game,reserved_chips) VALUES('fade0000-0000-0000-0000-000000000001','native',1000);SET LOCAL session_replication_role=origin;",'These Chips Are Reserved')
 refuse('insufficient-bank',"SET LOCAL session_replication_role=replica;UPDATE public.union_wallets SET chip_balance=0 WHERE union_id='fade0000-0000-0000-0000-000000000001';SET LOCAL session_replication_role=origin;",'owner_refund_main_bank_insufficient')
 refuse('journal-failure-atomic',"CREATE FUNCTION pg_temp.reject_credit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.category='refund' THEN RAISE EXCEPTION 'native_credit_fault';END IF;RETURN NEW;END$$;CREATE TRIGGER native_fault BEFORE INSERT ON public.chip_ledger FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_credit();",'native_credit_fault')
 refuse('receipt-failure-atomic',"CREATE FUNCTION pg_temp.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'native_receipt_fault';END$$;CREATE TRIGGER native_fault BEFORE INSERT ON smarter_private.owner_retirement_bank_refunds FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_receipt();",'native_receipt_fault')
 # Two real sessions race the same original entitlement; the parent/lane
 # boundary must refuse the competing call; its later replay returns one receipt.
 race=e.database(db)
 binary=n.stock_isolationtester(e.pg)
 spec="""session "a"
step "a_begin" { BEGIN; }
step "a_refund" { SELECT public.fn_ca_owner_retirement_bank_refund('26b465dd-600d-42eb-9f37-68f6052febac')->>'amount'; }
step "a_commit" { COMMIT; }
session "b"
step "b_begin" { BEGIN; }
step "b_refund" { SELECT public.fn_ca_owner_retirement_bank_refund('26b465dd-600d-42eb-9f37-68f6052febac')->>'amount'; }
step "b_commit" { COMMIT; }
step "b_replay" { SELECT public.fn_ca_owner_retirement_bank_refund('26b465dd-600d-42eb-9f37-68f6052febac')->>'amount'; }
permutation "a_begin" "b_begin" "a_refund" "b_refund" "a_commit" "b_commit" "b_replay"
"""
 rc,race_out,race_err=e.run('same-entitlement-race',[binary,f'host={e.socket} port={e.port} dbname={race} user=postgres'],text=spec,seconds=30,check=False)
 if rc or race_err.strip() or [line for line in race_out.splitlines() if line.startswith('ERROR:')]!=['ERROR:  CANCELLATION_GLOBAL_LANE_BUSY'] or race_out.count('    5.00')!=2:raise RuntimeError('refund race did not preserve lane refusal and replay: '+race_out+race_err)
 sql_file(e,race,'race-one-debit',"""DO $$BEGIN
 IF (SELECT chip_balance FROM public.union_wallets WHERE union_id='fade0000-0000-0000-0000-000000000001')<>995
 OR (SELECT count(*) FROM smarter_private.owner_retirement_bank_refunds)<>1
 OR (SELECT count(*) FROM public.tournament_refund_tranches WHERE entitlement_id='26b465dd-600d-42eb-9f37-68f6052febac')<>1
 THEN RAISE EXCEPTION 'concurrent refund duplicated';END IF;END$$;""")
 e.discard(race)
 _,outcome,_=sql_file(e,db,'exact-refund-commit','BEGIN;'+SERVICE+'SELECT '+call+';SET CONSTRAINTS ALL IMMEDIATE;COMMIT;')
 receipt=next(json.loads(x) for x in outcome.splitlines() if x.startswith('{') and 'funding_ledger_id' in x)
 assert receipt['amount']==5 and receipt['bank_before']==1000 and receipt['bank_after']==995
 assert receipt['player_before']==195 and receipt['player_after']==200
 assert receipt['event_custody_before']==receipt['event_custody_after']==5
 committed=snapshot('committed')
 _,replay,_=sql_file(e,db,'lost-ack-replay-no-second-debit','BEGIN;'+SERVICE+'SELECT '+call+';COMMIT;')
 assert next(json.loads(x) for x in replay.splitlines() if x.startswith('{') and 'funding_ledger_id' in x)==receipt
 assert snapshot('replay-unchanged')==committed
 for verb in ('UPDATE smarter_private.owner_retirement_bank_refunds SET receipt=receipt','DELETE FROM smarter_private.owner_retirement_bank_refunds','TRUNCATE smarter_private.owner_retirement_bank_refunds'):
  rc,_,err=e.sql(db,verb,label='receipt-immutable',check=False)
  assert rc!=0 and 'owner_retirement_bank_refund_receipt_is_immutable' in err
 assert snapshot('immutability-unchanged')==committed
 e.report['cases']=['real-entry','rollback','browser-denied','scope','bank-reserve','insufficient-bank','credit-fault-atomic','receipt-fault-atomic','commit-conservation','same-receipt-replay','receipt-immutable','concurrent-same-entitlement']
 e.report['source_sha256']={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),old,ROOT/'supabase/migrations/20261102161821_owner_retirement_main_bank_funds_exact_player_refunds.sql',ROOT/'scripts/ci/fixtures/tournament-abort/owner-bank-refund-catalog.json']}
 e.report['status']='passed'

except BaseException as err:e.report['failure']=repr(err);print(repr(err),flush=True)
finally:
 e.close();(out/'result.json').write_text(json.dumps(e.report,indent=2));print(json.dumps({k:e.report.get(k) for k in ('status','failure','cleanup')}))

sys.exit(0 if e.report.get('status')=='passed' else 1)
