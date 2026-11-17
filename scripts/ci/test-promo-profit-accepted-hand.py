#!/usr/bin/env python3
"""Exercise original-grant winnings custody through the maintained full PG17 accepted-hand owner.

Reuses its real money authority closure and exact seat-generation fixture.
Only the isolated opening principal is seeded; actual hand acceptance, losses,
envelope, seat writes and response-loss replay execute the real source chain.
"""
import argparse,os,sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,required=True);p.add_argument('--pg-bin',type=Path,required=True)
p.add_argument('--custody-root',type=Path,default=ROOT);p.add_argument('--fee-root',type=Path,default=ROOT);p.add_argument('--ticket-root',type=Path,default=ROOT)
args=p.parse_args();root=args.custody_root.resolve();sys.path.insert(0,str(root/'scripts/ci'))
from satellite_qualifier_fixture import module
baseline=module(root/'scripts/ci/test-promo-play-through.py','promo_baseline')
base_migrations=[root/'supabase/migrations'/name for name in baseline.BASE_MIGRATION_FILES]
roster=module(root/'scripts/ci/test-accepted-hand-roster.py','integrity_roster')
hs=module(root/'scripts/ci/test-hand-submission.py','integrity_hs')
native=module(root/'scripts/ci/test-mtt-unlimited.py','integrity_native')
if sys.platform=='darwin' and not os.environ.get('TMPDIR','').startswith('/Volumes/'):
 raise SystemExit('external TMPDIR required')
out=args.output.resolve();out.mkdir(parents=True,exist_ok=False)
manifest=hs.prepare(root,out)
(out/'current-chain.sql').write_text(roster.current_chain(root))
e=native.Execution(root,out,args.pg_bin.resolve(),Path(os.environ.get('TMPDIR',str(out))),600,
 socket_parent=Path(os.environ.get('TMPDIR',str(out))))
try:
 e.start();db=e.database()
 for f,label in [(out/'foundation.sql','foundation'),(out/'current-authorities.sql','authorities'),(root/'scripts/ci/probes/atomic-terminal-rehearsal-fixture.sql','structural'),(root/roster.SUBMISSION,'submission'),(out/'current-chain.sql','chain'),(root/roster.RAKED_DIAMOND,'diamond'),(root/roster.MIGRATION,'roster')]:
  e.sql(db,file=f,label=label,seconds=180)
 e.sql(db,"""CREATE TABLE IF NOT EXISTS public.ca_declared_money_triggers(table_name text,trigger_name text,note text,PRIMARY KEY(table_name,trigger_name));
 CREATE TABLE IF NOT EXISTS public.accounting_tournament_fee_sources(id uuid DEFAULT gen_random_uuid(),tournament_id uuid,player_id uuid,club_id uuid,rake_credit numeric,charged_at timestamptz,rake_record_id uuid);
 ALTER TABLE public.accounting_tournament_fee_sources ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),ADD COLUMN IF NOT EXISTS rake_record_id uuid,ADD COLUMN IF NOT EXISTS source_charge_ledger_id uuid,ADD COLUMN IF NOT EXISTS source_entitlement_id uuid;
 ALTER TABLE public.rake_records ADD COLUMN IF NOT EXISTS source text;
 CREATE TABLE IF NOT EXISTS public.tournament_unregistration_receipts(registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid,user_id uuid,fees_reversed numeric,fee_reversal_ids uuid[],fee_source_rake_record_ids uuid[]);
 CREATE TABLE IF NOT EXISTS public.tournament_cancellation_receipts(tournament_id uuid PRIMARY KEY,total_rake_before numeric,total_rake_after numeric,fees_reversed numeric,fee_reversal_ids uuid[]);
 """,label='promo-fee-relation')
 original_funding=(root/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql').read_text()
 funding_start=original_funding.index('CREATE FUNCTION public.fn_cash_record_original_funding(')
 funding_end=original_funding.index('-- This is a prospective game/roster snapshot',funding_start)
 e.sql(db,original_funding[funding_start:funding_end],label='original-cash-funding-owner')
 for f in base_migrations:e.sql(db,file=f,label=f.stem[:35])
 inventory=json.loads((root/'tests/fixtures/promo-custody-inventory-pin.json').read_text())
 for source in inventory['funding_owners']:
  e.sql(db,source['definition']+';REVOKE ALL ON FUNCTION '+source['signature']+' FROM PUBLIC,anon,authenticated,service_role;',label='actual-'+source['signature'].split('(')[0])
 e.sql(db,'CREATE SCHEMA IF NOT EXISTS smarter_private;'+inventory['definition']+';REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC,anon,authenticated,service_role;',label='actual-inventory-funding-pin')
 e.sql(db,file=root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql',label='custody')
 relations=ROOT/'tests/fixtures/promo-integrity-lineage-relations.json'
 for relation in json.loads(relations.read_text()):e.sql(db,'CREATE TABLE IF NOT EXISTS public.'+relation['table_name']+'('+relation['columns']+');',label='actual-lineage-relation')
 e.sql(db,'ALTER TABLE public.cash_participant_funding_receipts ADD COLUMN IF NOT EXISTS transaction_id xid8 DEFAULT pg_current_xact_id();',label='funding-transaction-column')
 lineage=ROOT/'tests/fixtures/promo-integrity-funding-lineage.json'
 for source in json.loads(lineage.read_text()):
  e.sql(db,source['definition']+';REVOKE ALL ON FUNCTION '+source['signature']+' FROM PUBLIC,anon,authenticated,service_role;',label='actual-'+source['signature'].split('(')[0])
  e.sql(db,"DO $$BEGIN IF md5(pg_get_functiondef('"+source['signature']+"'::regprocedure))<>'"+source['md5']+"' THEN RAISE EXCEPTION 'original_lineage_owner_changed';END IF;END$$;",label='actual-lineage-preimage')
 accepted_owner=ROOT/'tests/fixtures/promo-integrity-accepted-provenance-owner.json';accepted_source=json.loads(accepted_owner.read_text())
 accepted_signature=accepted_source['signature']
 e.sql(db,accepted_source['definition']+';REVOKE ALL ON FUNCTION '+accepted_signature+' FROM PUBLIC,anon,authenticated,service_role;',label='actual-current-accepted-provenance-owner')
 for role in ['anon','authenticated','service_role']:
  if role+'=X/' in (accepted_source['acl'] or ''):e.sql(db,'GRANT EXECUTE ON FUNCTION '+accepted_signature+' TO '+role+';',label='actual-accepted-provenance-acl')
 e.sql(db,"DO $$BEGIN IF md5(pg_get_functiondef('"+accepted_signature+"'::regprocedure))<>'"+accepted_source['md5']+"' THEN RAISE EXCEPTION 'original_accepted_provenance_owner_changed';END IF;END$$;",label='actual-accepted-provenance-preimage')
 manifest_owner=ROOT/'tests/fixtures/promo-integrity-manifest-owner.json';manifest_source=json.loads(manifest_owner.read_text())
 e.sql(db,manifest_source['definition']+';REVOKE ALL ON FUNCTION public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid) TO service_role;',label='actual-current-manifest-owner')
 e.sql(db,"DO $$BEGIN IF md5(pg_get_functiondef('public.fn_cash_capture_hand_manifest(uuid,bigint,jsonb,text,uuid)'::regprocedure))<>'1a5e66c29d3d36e41752589d59daa478' THEN RAISE EXCEPTION 'original_cash_manifest_owner_changed';END IF;END$$;",label='actual-manifest-preimage')

 fee=args.fee_root/'supabase/migrations/20261116154831_promo_funded_fees_keep_gross_rake_but_earn_no_commission_or_.sql'
 fee_sql=fee.read_text();e.sql(db,fee_sql.split('DO $owners$')[0]+'COMMIT;',label='actual-eligible-fee-helpers')
 ticket=next((args.ticket_root/'supabase/migrations').glob('20261116154719_*.sql'));ticket_sql=ticket.read_text()
 for start,end in [('CREATE TABLE public.ca_promo_event_principal_lots','CREATE FUNCTION public.fn_ca_promo_retire_busted_entry('),('CREATE FUNCTION public.fn_ca_promo_finish_event_principal()','-- The ordinary debit already owns'),('CREATE FUNCTION public.fn_ca_promo_roll_event_principal(','-- One original money owner, explicit source')]:
  e.sql(db,ticket_sql[ticket_sql.index(start):ticket_sql.index(end)],label='actual-event-custody-'+start.split('.')[-1][:20])
 integrity=ROOT/'supabase/migrations/20261116161707_suspect_promo_chip_dumping_holds_only_attributable_incoming_.sql'
 import subprocess
 wrapper="import{stalePinGuardSQL}from'./scripts/ci/migration-stale-pins.mjs';let s='';for await(const b of process.stdin)s+=b;process.stdout.write(stalePinGuardSQL(process.argv[1],s,s));"
 integrity_sql=integrity.read_text();guarded=subprocess.run(['node','--input-type=module','-e',wrapper,integrity.name],input=integrity_sql,text=True,capture_output=True,check=True,cwd=ROOT).stdout
 e.sql(db,guarded,label='real-applier-integrity-migration')
 winnings=next((ROOT/'supabase/migrations').glob('20261116190221_*.sql'));winnings_sql=winnings.read_text()
 selected_winnings=winnings_sql.split('-- BEGIN ORIGINAL BBJ WINNINGS SOURCE')[0]+'COMMIT;'
 e.sql(db,"CREATE SCHEMA fixture_only;CREATE TABLE fixture_only.profit_notices(grant_id uuid PRIMARY KEY,unlocked_at timestamptz);CREATE FUNCTION public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN INSERT INTO fixture_only.profit_notices VALUES($1,$2) ON CONFLICT DO NOTHING;RETURN true;END$$;CREATE FUNCTION public.fn_ca_promo_notice_support_override(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;REVOKE ALL ON FUNCTION public.fn_ca_promo_notice_profit_unlocked(uuid,timestamptz),public.fn_ca_promo_notice_support_override(uuid) FROM PUBLIC,anon,authenticated,service_role;",label='explicit-notification-only-fixture')
 guarded_w=subprocess.run(['node','--input-type=module','-e',wrapper,winnings.name],input=selected_winnings,text=True,capture_output=True,check=True,cwd=ROOT).stdout
 e.sql(db,guarded_w,label='real-applier-winnings-cash-source-prefix')
 probe='BEGIN;\n'+(out/'opening.sql').read_text()+(root/roster.FIXTURE).read_text()+'''
UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
SELECT fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',70,'club_promo','native-full-hand');
SELECT fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001',70);
INSERT INTO ca_promo_integrity_cases(id,hand_id,source_club_id,source_user_id,club_id,recipient_id,amount,evidence)
VALUES('70000000-0000-0000-0000-000000000001',gen_random_uuid(),'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',30,'{"fixture":"isolated original review opening"}');
INSERT INTO ca_promo_integrity_custody VALUES('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001',30);
DO $$DECLARE r jsonb;BEGIN
 r:=pg_temp.roster_commit(8800007,'88400000-0000-0000-0000-000000000007');
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual cash hand refused %',r; END IF;
 IF (SELECT remaining FROM ca_promo_play_through_grants WHERE source_ref='native-full-hand') IS DISTINCT FROM 70::numeric THEN RAISE EXCEPTION 'actual hand consumed promo before its integrity-held chips'; END IF;
 IF (SELECT promo_contribution FROM ca_promo_cash_hand_funding WHERE hand_id='88400000-0000-0000-0000-000000000007') IS DISTINCT FROM 0::numeric THEN RAISE EXCEPTION 'actual hand did not retain unrestricted-first funding'; END IF;
 IF (SELECT held_contribution FROM ca_promo_integrity_hand_funding WHERE hand_id='88400000-0000-0000-0000-000000000007') IS DISTINCT FROM 10::numeric THEN RAISE EXCEPTION 'actual accepted hand missing frozen H funding'; END IF;
 IF public.fn_ca_promo_integrity_locked_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001') IS DISTINCT FROM 20::numeric THEN RAISE EXCEPTION 'actual accepted hand did not consume H before P'; END IF;
 RAISE NOTICE 'INTEGRITY ACTUAL ACCEPTED HAND PASS';
 r:=pg_temp.roster_commit(8800007,'88400000-0000-0000-0000-000000000007');
 IF r->>'success' IS DISTINCT FROM 'true' OR (SELECT remaining FROM ca_promo_play_through_grants WHERE source_ref='native-full-hand') IS DISTINCT FROM 70::numeric THEN RAISE EXCEPTION 'actual accepted replay changed principal %',r; END IF;
 IF (SELECT count(*) FROM ca_promo_integrity_hand_funding WHERE hand_id='88400000-0000-0000-0000-000000000007')<>1 THEN RAISE EXCEPTION 'actual replay duplicated H funding'; END IF;
 RAISE NOTICE 'INTEGRITY ACTUAL REPLAY PASS';
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;'''
 e.sql(db,probe,label='actual-accepted-cash-hand',seconds=120)
 # A second fresh opening exercises actual HU case creation through the
 # accepted-hand owner, rather than inserting an accepted provenance receipt.
 fixture=(root/roster.FIXTURE).read_text()
 start=fixture.index('CREATE FUNCTION pg_temp.roster_row(');end=fixture.index('CREATE FUNCTION pg_temp.roster_obligations(',start)
 original_row=fixture[start:end].replace('pg_temp.roster_row(', 'pg_temp.roster_row_base(',1)
 hu_probe='BEGIN;\n'+(out/'opening.sql').read_text()+fixture+original_row+'''
CREATE OR REPLACE FUNCTION pg_temp.roster_seats(p_variant text DEFAULT 'exact') RETURNS TABLE(user_id text,seat_id text,joined text,before numeric,after numeric,contributed numeric,uses integer,secs integer)
LANGUAGE sql IMMUTABLE AS $$SELECT * FROM (VALUES
 ('10000000-0000-0000-0000-000000000001','88300000-0000-0000-0000-000000000001','2026-10-06T10:00:01.123456+00:00',100::numeric,0::numeric,100::numeric,3,17),
 ('10000000-0000-0000-0000-000000000002','88300000-0000-0000-0000-000000000002','2026-10-06T10:00:02+00:00',100::numeric,200::numeric,100::numeric,2,19))v$$;
CREATE OR REPLACE FUNCTION pg_temp.roster_row(p_hand bigint,p_id uuid,p_variant text DEFAULT 'exact') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.roster_row_base(p_hand,p_id,p_variant)||jsonb_build_object('pot_size',200,
 'actions',jsonb_build_array(jsonb_build_object('userId','10000000-0000-0000-0000-000000000001','action','bet','amount',100),jsonb_build_object('userId','10000000-0000-0000-0000-000000000002','action','call','amount',100)),
 'winners',jsonb_build_array(jsonb_build_object('user_id','10000000-0000-0000-0000-000000000002','amount',200)))$$;
-- Isolated original funding opening; the real source owner verifies each
-- ledger/journal and captures original custody before the real manifest.
SET LOCAL session_replication_role=replica;
UPDATE clubs SET asset='chips' WHERE id='20000000-0000-0000-0000-000000000001';
UPDATE tables SET is_private=true WHERE id='88100000-0000-0000-0000-000000000001';
INSERT INTO chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,performed_by)
SELECT ('71000000-0000-0000-0000-00000000000'||n)::uuid,'player_wallet',('10000000-0000-0000-0000-00000000000'||n)::uuid,'table_stack','88100000-0000-0000-0000-000000000001',100,'buyin','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001' FROM generate_series(1,2)n;
INSERT INTO wallet_transactions(id,user_id,wallet_type,amount,type,category,table_id,balance_after)
SELECT ('72000000-0000-0000-0000-00000000000'||n)::uuid,('10000000-0000-0000-0000-00000000000'||n)::uuid,'PLAYER',100,'debit','buyin','88100000-0000-0000-0000-000000000001',0 FROM generate_series(1,2)n;
SET LOCAL session_replication_role=origin;
SELECT fn_cash_record_original_funding('buyin','hu-opening:'||n,('10000000-0000-0000-0000-00000000000'||n)::uuid,'88100000-0000-0000-0000-000000000001',('71000000-0000-0000-0000-00000000000'||n)::uuid,('72000000-0000-0000-0000-00000000000'||n)::uuid,'20000000-0000-0000-0000-000000000001',100,0,NULL) FROM generate_series(1,2)n;
SELECT fn_cash_capture_hand_manifest('88100000-0000-0000-0000-000000000001',8800008,
 (SELECT jsonb_agg(jsonb_build_object('user_id',s.user_id,'seat_id',s.id,'occupancy_id',s.occupancy_id,'seat_joined_at',s.joined_at,'stack_before',s.stack,'is_horse',p.is_horse)) FROM table_seats s JOIN profiles p ON p.id=s.user_id WHERE s.id IN('88300000-0000-0000-0000-000000000001','88300000-0000-0000-0000-000000000002')),
 'roster-probe','88500000-0000-0000-0000-000000000001');
CREATE OR REPLACE FUNCTION pg_temp.roster_stacks(p_variant text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_agg(jsonb_build_object('seat_id',s.seat_id,'occupancy_id',(SELECT occupancy_id FROM table_seats WHERE id=s.seat_id::uuid),'seat_joined_at',s.joined,'user_id',s.user_id,'stack_before',s.before,'stack',s.after,'funding_manifest_id',(SELECT id FROM cash_hand_participant_manifests WHERE table_id='88100000-0000-0000-0000-000000000001' AND hand_number=8800008)) ORDER BY s.user_id) FROM pg_temp.roster_seats(p_variant)s$$;
UPDATE ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
SELECT fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',100,'club_promo','native-hu');
SELECT fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001',100);
DO $$DECLARE r jsonb;BEGIN
 r:=pg_temp.roster_commit(8800008,'88400000-0000-0000-0000-000000000008');
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual HU refused %',r;END IF;
 IF (SELECT amount FROM ca_promo_integrity_cases WHERE hand_id='88400000-0000-0000-0000-000000000008') IS DISTINCT FROM 100::numeric THEN RAISE EXCEPTION 'actual HU source did not hold attributable incoming principal cases=% provenance=% funding=%', (SELECT jsonb_agg(to_jsonb(k)) FROM ca_promo_integrity_cases k),(SELECT jsonb_agg(to_jsonb(h)) FROM cash_hand_provenance_receipts h),(SELECT jsonb_agg(to_jsonb(f)) FROM ca_promo_cash_hand_funding f);END IF;
 IF (SELECT count(*) FROM ca_promo_play_through_grants WHERE user_id='10000000-0000-0000-0000-000000000002')<>0 THEN RAISE EXCEPTION 'actual HU minted a recipient promo grant'; END IF;
 r:=pg_temp.roster_commit(8800008,'88400000-0000-0000-0000-000000000008');
 IF r->>'success' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM ca_promo_integrity_cases WHERE hand_id='88400000-0000-0000-0000-000000000008')<>1 THEN RAISE EXCEPTION 'actual HU replay duplicated case';END IF;
 RAISE NOTICE 'ACTUAL HU HOLD AND REPLAY PASS';END$$;
SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;'''
 e.sql(db,hu_probe,label='actual-heads-up-hold-and-replay',seconds=120)
 e.report['native'].append({'case':'actual-heads-up-hold-and-replay','assertions':4})
 # The exact same real accepted HU chain now receives only W-funded chips.
 w_only=hu_probe.replace("SELECT fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','player_wallet','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001',100);", """SELECT fn_ca_promo_profit_credit_owned('cash_win',gen_random_uuid(),(SELECT id FROM ca_promo_play_through_grants WHERE source_ref='native-hu'),'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001',100);
 UPDATE ca_promo_principal_custody SET amount=0 WHERE grant_id=(SELECT id FROM ca_promo_play_through_grants WHERE source_ref='native-hu');
 UPDATE ca_promo_play_through_grants SET remaining=0,closed_at=clock_timestamp(),close_reason='spent' WHERE source_ref='native-hu';""")
 w_only=w_only.replace("RAISE NOTICE 'ACTUAL HU HOLD AND REPLAY PASS';", """IF (SELECT sum(profit_lost) FROM ca_promo_profit_cash_loss_slices WHERE hand_id='88400000-0000-0000-0000-000000000008')<>100 THEN RAISE EXCEPTION 'original W HU loss missing';END IF;
 IF EXISTS(SELECT 1 FROM ca_promo_profit_fee_phases WHERE grant_id=(SELECT id FROM ca_promo_play_through_grants WHERE source_ref='native-hu') AND closed_at IS NULL) THEN RAISE EXCEPTION 'original W HU loss retained future debt';END IF;
 RAISE NOTICE 'ACTUAL W HU HOLD AND REPLAY PASS';""")
 e.sql(db,w_only,label='actual-winnings-only-hu-and-replay',seconds=120)
 e.report['native'].append({'case':'actual-winnings-only-hu-and-replay','assertions':6})
 # Original investment and net winnings are the actual accepted owner's facts,
 # rather than manually inserted fee/cash/provenance receipts.
 gain=hu_probe[:hu_probe.index('DO $$DECLARE r jsonb;BEGIN')]
 gain=gain.replace('100::numeric,0::numeric,100::numeric,3,17','100::numeric,200::numeric,100::numeric,3,17').replace('100::numeric,200::numeric,100::numeric,2,19','100::numeric,0::numeric,100::numeric,2,19')
 gain=gain.replace("'user_id','10000000-0000-0000-0000-000000000002','amount',200","'user_id','10000000-0000-0000-0000-000000000001','amount',200")
 gain+="""DO $$DECLARE r jsonb;BEGIN
 r:=pg_temp.roster_commit(8800008,'88400000-0000-0000-0000-000000000008');
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actual original gain refused %',r;END IF;
 IF (SELECT sum(amount) FROM ca_promo_profit_custody WHERE kind='table_stack' AND user_id='10000000-0000-0000-0000-000000000001')<>100 THEN RAISE EXCEPTION 'actual original P-funded gain did not retain W100';END IF;
 IF public.fn_ca_promo_restricted_at('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','table_stack','88100000-0000-0000-0000-000000000001')<>200 THEN RAISE EXCEPTION 'actual accepted ending stack union failed';END IF;
 r:=pg_temp.roster_commit(8800008,'88400000-0000-0000-0000-000000000008');
 IF r->>'success' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM ca_promo_profit_realization_receipts WHERE source_kind='cash_win' AND source_id='88400000-0000-0000-0000-000000000008')<>1 THEN RAISE EXCEPTION 'actual gain replay duplicated W';END IF;
 END$$;SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;"""
 e.sql(db,gain,label='actual-promo-funded-net-gain-and-replay',seconds=120)
 e.report['native'].append({'case':'actual-promo-funded-net-gain-and-replay','assertions':4})
 if winnings.read_text()!=winnings_sql:raise RuntimeError('winnings source changed during qualification')
 e.report['selected_winnings_sha256']=roster.sha(winnings)
 e.report['qualification_limits']=['Actual original accepted-hand/seat/journal/provenance chain; original W/P opening source is explicitly typed. Selected W prefix excludes separately qualified BBJ source. Notification-only fixture sink, no notice-delivery claim.']
 inputs_w=[winnings]
 if fee.read_text()!=fee_sql or ticket.read_text()!=ticket_sql or integrity.read_text()!=integrity_sql:raise RuntimeError('prerequisite changed during qualification')
 e.report['status']='passed'
 e.report['native'].append({'case':'actual-accepted-cash-hand-and-replay','assertions':5})
 inputs=[Path(__file__).resolve(),root/'scripts/ci/test-promo-play-through.py',root/'tests/fixtures/promo-custody-inventory-pin.json',root/'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql',
  root/'scripts/ci/test-accepted-hand-roster.py',root/roster.CAPTURE,root/roster.LIGHTNING,
  root/roster.RETIRED_CASH,root/roster.RAKED_DIAMOND,root/roster.MIGRATION,root/roster.FIXTURE]
 inputs += inputs_w+[fee,ticket,integrity,relations,lineage,manifest_owner,accepted_owner,root/'supabase/migrations/20260917230925_cash_funding_retains_original_participant_custody.sql']
 inputs+=base_migrations
 e.report['source_sha256']={**manifest['source_sha256'],**{str(f):roster.sha(f) for f in inputs}}
 print('actual accepted hand and replay passed')
finally:
 e.close();(out/'RESULTS.json').write_text(json.dumps(e.report,indent=2)+'\n')
