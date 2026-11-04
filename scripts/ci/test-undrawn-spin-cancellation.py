#!/usr/bin/env python3
"""Real booked-undrawn Spin cancellation in a private socket-only PG17 cluster."""
import argparse, hashlib, json, sys
from pathlib import Path
sys.dont_write_bytecode=True
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'scripts/ci/fixtures/undrawn-spin-cancellation'
MIGRATION=ROOT/'supabase/migrations/20261103064259_undrawn_spin_cancellation_returns_booked_fees_before_gross_r.sql'
EVENT='92010000-0000-0000-0000-000000000001'
SERVICE="SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true);SET LOCAL ROLE service_role;"
def main():
 p=argparse.ArgumentParser()
 for name in ('evidence','work-root','socket-root','pg-bin'):p.add_argument('--'+name,type=Path,required=True)
 a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=False)
 a.work_root.mkdir(parents=True,exist_ok=True);a.socket_root.mkdir(parents=True,exist_ok=True)
 native=module(ROOT/'scripts/ci/test-mtt-unlimited.py','undrawn_spin_native')
 e=native.Execution(ROOT,a.evidence,a.pg_bin,a.work_root,600,socket_parent=a.socket_root)
 try:
  e.start();db=e.database();install_financial_foundation(e,db,ROOT,a.evidence)
  ddl='SET check_function_bodies=off;'
  for name in ('current-owners.json','current-dependencies.json','current-terminal-owners.json','current-receipt-owners.json'):
   path=DATA/name
   for row in json.loads(path.read_text()):
    assert hashlib.md5(row['definition'].encode()).hexdigest()==row['definition_md5']
    ddl+=row['definition']+';'
   e.report['source_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
  helper_path=ROOT/'scripts/ci/fixtures/spin-owner-command/current-ledger-helpers.json'
  for row in json.loads(helper_path.read_text()):
   assert hashlib.md5(row['definition'].encode()).hexdigest()==row['definition_md5']
   ddl+=row['definition']+';'
  ddl+="INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES ('spin_reserve','counted','spin_pools + union spin_reserve_wallet','spin_bonus_pools balance') ON CONFLICT(store) DO NOTHING;"
  path=a.evidence/'current.sql';path.write_text(ddl);e.sql(db,file=path,label='current-source-owners')
  raw=(ROOT/'scripts/ci/probes/spin-funded-launch-native.sql').read_text()
  opening=raw[raw.index('SET LOCAL session_replication_role=replica;'):raw.index('INSERT INTO public.tournament_launch_receipts(')]
  # Synthetic opening: retained paid wallet/entitlement witnesses, no live data.
  # All reserve booking, cancellation, refund, escrow and journal writes below
  # use real financial owners with their triggers enabled.
  opening=opening.replace('       100\n  FROM generate_series(1,3)', '       99\n  FROM generate_series(1,3)')
  opening=opening.replace('is_sitting_out,is_away,club_id\n)', 'is_sitting_out,is_away,club_id,active_game_scope,active_parent_key\n)')
  opening=opening.replace("       '92000000-0000-0000-0000-000000000001'\n  FROM generate_series(1,3) g(i);\n\nINSERT INTO public.tournament_escrow", "       '92000000-0000-0000-0000-000000000001',\n       'table:92020000-0000-0000-0000-000000000001',\n       'tournament:92010000-0000-0000-0000-000000000001'\n  FROM generate_series(1,3) g(i);\n\nINSERT INTO public.tournament_escrow")
  opening+='''INSERT INTO auth.users(id) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d') ON CONFLICT DO NOTHING;
INSERT INTO public.users(id,username) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','smarterpoker') ON CONFLICT DO NOTHING;
INSERT INTO public.users(id,username) SELECT md5('played-spin-launch-user:'||i)::uuid,'spin_cancel_native_'||i FROM generate_series(1,3)i ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role=origin;
INSERT INTO public.ca_settle_sources(source,note) VALUES('atomic_cancel_tournament','DB caller') ON CONFLICT DO NOTHING;
'''
  book="SELECT public.fn_spin_book_entry('"+EVENT+"');"
  cancel="public.atomic_cancel_tournament('"+EVENT+"',NULL)"
  before="BEGIN;"+opening+SERVICE+book+"DO $$BEGIN BEGIN PERFORM "+cancel+";RAISE EXCEPTION 'baseline unexpectedly passed';EXCEPTION WHEN SQLSTATE 'P0404' THEN IF SQLERRM NOT LIKE '%caches do not equal exact escrow%' THEN RAISE;END IF;END;END$$;ROLLBACK;"
  path=a.evidence/'before.sql';path.write_text(before);e.sql(db,file=path,label='original-booked-spin-reproduces-cache-refusal')
  e.sql(db,file=MIGRATION,label='install-exact-candidate')
  e.sql(db,"DO $$BEGIN IF has_function_privilege('anon','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE') OR NOT has_function_privilege('service_role','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE') OR has_function_privilege('service_role','public.fn_ca_tournament_terminal_receipt(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'financial authority changed';END IF;END$$;",label='exact-installed-role-authority')
  _,postimages,_=e.sql(db,"SELECT jsonb_object_agg(p.proname,md5(pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.oid IN ('public.atomic_cancel_tournament(uuid,uuid)'::regprocedure,'public.fn_stamp_tournament_terminal_evidence_markers()'::regprocedure,'public.fn_ca_tournament_terminal_receipt(uuid,uuid)'::regprocedure);",label='candidate-postimages')
  e.report['postimages']=json.loads(postimages)
  proof_line=next((line[len('-- @live-proof: '):] for line in MIGRATION.read_text().splitlines() if line.startswith('-- @live-proof: ')),None)
  if proof_line:
   _,live_result,_=e.sql(db,'SELECT '+proof_line+';',label='candidate-live-proof')
   assert live_result.strip()=='t'
  proof="""DO $proof$ DECLARE first jsonb; replay jsonb; BEGIN
 first:=public.atomic_cancel_tournament('92010000-0000-0000-0000-000000000001',NULL);
 replay:=public.atomic_cancel_tournament('92010000-0000-0000-0000-000000000001',NULL);
 RESET ROLE;
 IF first IS DISTINCT FROM replay OR first->>'fully_settled' IS DISTINCT FROM 'true'
 OR (first->>'total_refunded')::numeric IS DISTINCT FROM 3
 OR (first->>'fees_reversed')::numeric IS DISTINCT FROM 0.24
 OR (SELECT balance FROM spin_bonus_pools WHERE id='92030000-0000-0000-0000-000000000001') IS DISTINCT FROM 1000
 OR (SELECT count(*) FROM tournament_refund_tranches WHERE tournament_id='92010000-0000-0000-0000-000000000001')<>3
 OR EXISTS(SELECT 1 FROM club_members WHERE club_id='92000000-0000-0000-0000-000000000001' AND chip_balance<>100)
 OR EXISTS(SELECT 1 FROM tournament_escrow WHERE tournament_id='92010000-0000-0000-0000-000000000001' AND (prize_balance<>0 OR fee_balance<>0 OR bounty_balance<>0))
 THEN RAISE EXCEPTION 'booked Spin exact refund or replay failed: %',first;END IF;
 END $proof$;SET CONSTRAINTS ALL IMMEDIATE;ROLLBACK;"""
  path=a.evidence/'after.sql';path.write_text('BEGIN;'+opening+SERVICE+book+proof)
  e.sql(db,file=path,label='candidate-exact-gross-refund-reserve-fees-history-replay')
  # Snapshot actual catalog tables so late failure must roll back every write.
  fingerprint="""CREATE FUNCTION pg_temp.financial_fingerprint() RETURNS text LANGUAGE plpgsql AS $$
DECLARE t record; parts text:=''; digest text; BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind='r' ORDER BY 1,2 LOOP
 EXECUTE format('SELECT md5(COALESCE(string_agg(row_to_json(x)::text, chr(10) ORDER BY row_to_json(x)::text),'''')) FROM %I.%I x',t.nspname,t.relname) INTO digest;
 parts:=parts||t.nspname||'.'||t.relname||':'||digest||';'; END LOOP;RETURN md5(parts);END$$;"""
  cases=[
   ('started-refused', "UPDATE tournaments SET started_at=now() WHERE id='"+EVENT+"';", '55000', 'Tournament has started or committed awards%'),
   ('incorrect-cache-refused', "SET LOCAL session_replication_role=replica;UPDATE tournaments SET prize_pool=4 WHERE id='"+EVENT+"';SET LOCAL session_replication_role=origin;", 'P0404', '%caches do not equal exact escrow%'),
   ('insufficient-reserve-refused', "SET LOCAL session_replication_role=replica;UPDATE spin_bonus_pools SET balance=0;SET LOCAL session_replication_role=origin;", 'P0403', '%reserve cannot return its own contribution%'),
   ('final-receipt-failure-atomic', "CREATE FUNCTION pg_temp.refuse_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected final receipt failure' USING ERRCODE='P9999';END$$;CREATE TRIGGER native_refuse_receipt BEFORE INSERT ON tournament_cancellation_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_receipt();", 'P9999', 'injected final receipt failure'),
  ]
  e.report['cases']=['baseline-cache-refusal','gross-refund-reserve-fees-history-replay']
  for name,mutation,state,message in cases:
   assertion="""DO $case$ DECLARE before_state text:=pg_temp.financial_fingerprint(); refused boolean:=false;BEGIN
 SET LOCAL ROLE service_role;
 BEGIN PERFORM public.atomic_cancel_tournament('"""+EVENT+"""',NULL);
 EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>'"""+state+"""' OR SQLERRM NOT LIKE '"""+message+"""' THEN RAISE;END IF;refused:=true;END;
 RESET ROLE;
 IF NOT refused OR before_state IS DISTINCT FROM pg_temp.financial_fingerprint() THEN RAISE EXCEPTION 'refusal was missing or changed persisted state';END IF;
 END $case$;ROLLBACK;"""
   path=a.evidence/(name+'.sql');path.write_text('BEGIN;'+opening+SERVICE+book+'RESET ROLE;'+mutation+fingerprint+assertion)
   e.sql(db,file=path,label=name);e.report['cases'].append(name)
  guard="""RESET ROLE;DO $$DECLARE n integer:=0;BEGIN
 BEGIN UPDATE spin_reserve_ledger SET amount=0 WHERE tournament_id='"""+EVENT+"""' AND kind='contribution_reversal';EXCEPTION WHEN SQLSTATE '55000' THEN n:=n+1;END;
 BEGIN DELETE FROM spin_reserve_ledger WHERE tournament_id='"""+EVENT+"""' AND kind='contribution_reversal';EXCEPTION WHEN SQLSTATE '55000' THEN n:=n+1;END;
 IF n<>2 THEN RAISE EXCEPTION 'reversal immutability lost';END IF;END$$;ROLLBACK;"""
  path=a.evidence/'immutable.sql';path.write_text('BEGIN;'+opening+SERVICE+book+'SELECT '+cancel+';'+guard)
  e.sql(db,file=path,label='reversal-receipts-remain-immutable');e.report['cases'].append('reversal-receipts-remain-immutable')
  for kind in ('MTT','SNG'):
   regular=opening.replace("'NLH','spin','SPIN',1", "'NLH','regular','"+kind+"',1")
   regular=regular.replace("'tournament','nlh',3,3,'waiting',1000,true,", "'tournament','nlh',3,3,'waiting',1000,false,")
   ordinary_proof=proof.replace("IS DISTINCT FROM 0.24", "IS DISTINCT FROM 0")
   path=a.evidence/(kind.lower()+'-unchanged.sql');path.write_text('BEGIN;'+regular+SERVICE+ordinary_proof)
   e.sql(db,file=path,label=kind.lower()+'-gross-refund-unchanged');e.report['cases'].append(kind.lower()+'-gross-refund-unchanged')
   fees="""SET LOCAL session_replication_role=replica;
UPDATE public.tournaments SET buy_in_amount=0.9,buy_in_fee=0.1,prize_pool=2.7,total_rake=0.3 WHERE id='"""+EVENT+"""';
UPDATE public.tournament_refund_entitlements SET refund_prize=0.9,refund_fee=0.1 WHERE tournament_id='"""+EVENT+"""';
SET LOCAL session_replication_role=origin;
INSERT INTO public.rake_records(club_id,rake_amount,pot_size,num_players,bbj_contribution,is_tournament,tournament_id,source,metadata)
SELECT '92000000-0000-0000-0000-000000000001',0.1,1,1,0,true,'"""+EVENT+"""','fn_register_for_tournament',jsonb_build_object('kind','tournament_entry_fee','user_id',md5('played-spin-launch-user:'||i)::uuid,'registration_id',md5('played-spin-launch-player:'||i)::uuid) FROM generate_series(1,3)i;
"""
   path=a.evidence/(kind.lower()+'-with-fees.sql');path.write_text('BEGIN;'+regular+fees+SERVICE+proof.replace('IS DISTINCT FROM 0.24','IS DISTINCT FROM 0.3'))
   e.sql(db,file=path,label=kind.lower()+'-fee-rail-refund-unchanged');e.report['cases'].append(kind.lower()+'-fee-rail-refund-unchanged')
  union_setup="""SET LOCAL session_replication_role=replica;
INSERT INTO public.clubs(id,name,owner_id) VALUES('92000000-0000-0000-0000-000000000002','Native reserve union',md5('played-spin-launch-user:1')::uuid);
INSERT INTO public.unions(id,name,owner_id,slug) VALUES('92000000-0000-0000-0000-000000000002','Native reserve union',md5('played-spin-launch-user:1')::uuid,'native-reserve-union');
UPDATE public.clubs SET union_id='92000000-0000-0000-0000-000000000002' WHERE id='92000000-0000-0000-0000-000000000001';
UPDATE public.spin_bonus_pools SET club_id='92000000-0000-0000-0000-000000000002',owner_kind='union';
SET LOCAL session_replication_role=origin;"""
  path=a.evidence/'union-reserve.sql';path.write_text('BEGIN;'+opening+union_setup+SERVICE+book+proof)
  e.sql(db,file=path,label='union-reserve-original-owner-refund');e.report['cases'].append('union-reserve-original-owner-refund')
  union_host="""SET LOCAL session_replication_role=replica;
INSERT INTO public.unions(id,name,owner_id,slug) VALUES('92000000-0000-0000-0000-000000000001','Native union host',md5('played-spin-launch-user:1')::uuid,'native-union-host');
UPDATE public.spin_bonus_pools SET owner_kind='union';
SET LOCAL session_replication_role=origin;"""
  path=a.evidence/'union-host-reserve.sql';path.write_text('BEGIN;'+opening+union_host+SERVICE+book+proof)
  e.sql(db,file=path,label='union-host-reserve-refund');e.report['cases'].append('union-host-reserve-refund')
  # Production's eight stake sizes share the fixed 8% fee rule. Independently
  # expect gross=3*stake and fees=0.24*stake, including the full-wallet boundary.
  for stake in (2,3,5,10,20,50,100):
   scaled=opening
   replacements=[
    ("'NLH','spin','SPIN',1,0", "'NLH','spin','SPIN',"+str(stake)+",0"),
    ('       99\n  FROM', '       '+str(100-stake)+'\n  FROM'),
    ("'PLAYER',1,'debit'", "'PLAYER',"+str(stake)+",'debit'"),
    ("       1,'tournament_buyin'", "       "+str(stake)+",'tournament_buyin'"),
    ('       1,1,0,0,', '       '+str(stake)+','+str(stake)+',0,0,'),
    ("'92010000-0000-0000-0000-000000000001',3,0,0,0,0,0,0,0,0,0,0,0,", "'92010000-0000-0000-0000-000000000001',"+str(3*stake)+",0,0,0,0,0,0,0,0,0,0,0,"),
    ("0,0,3,0,0,'played-spin-launch-probe'", "0,0,"+str(3*stake)+",0,0,'played-spin-launch-probe'"),
    ('"duration":180}]\',3,3,', '"duration":180}]\',3,'+str(3*stake)+','),
   ]
   for old,new in replacements:
    assert old in scaled,old
    scaled=scaled.replace(old,new)
   scaled_proof=proof.replace('IS DISTINCT FROM 3\n','IS DISTINCT FROM '+str(3*stake)+'\n').replace('IS DISTINCT FROM 0.24','IS DISTINCT FROM '+str(24*stake/100))
   path=a.evidence/('stake-'+str(stake)+'.sql');path.write_text('BEGIN;'+scaled+union_host+SERVICE+book+scaled_proof)
   e.sql(db,file=path,label='union-stake-'+str(stake));e.report['cases'].append('union-stake-'+str(stake))
  # Two actual PostgreSQL clients share the cancellation lane. A competing
  # cancellation refuses without queuing, then the identical request can
  # execute after rollback and replay after commit without a second payment.
  lane=module(ROOT/'scripts/ci/test-tournament-cancellation-lane.py','undrawn_spin_lane')
  path=a.evidence/'concurrency-opening.sql';path.write_text('BEGIN;'+opening+SERVICE+book+'RESET ROLE;COMMIT;')
  e.sql(db,file=path,label='commit-isolated-funded-concurrency-opening')
  left=lane.Session(e,db);right=lane.Session(e,db)
  try:
   left.query('BEGIN;'+SERVICE+'SELECT '+cancel+';')
   right.query('BEGIN;'+SERVICE+lane.refuse('SELECT '+cancel+';','CANCELLATION_GLOBAL_LANE_BUSY')+'ROLLBACK;')
   left.query('ROLLBACK;')
   right.query('BEGIN;'+SERVICE+'SELECT '+cancel+';COMMIT;')
   left.query('BEGIN;'+SERVICE+'SELECT '+cancel+';COMMIT;')
   e.sql(db,'BEGIN;'+SERVICE+proof,label='concurrent-rollback-commit-replay-one-refund')
   e.report['cases'].append('concurrent-rollback-commit-replay-one-refund')
  finally:
   left.close();right.close()
  for path in (Path(__file__),MIGRATION,helper_path,ROOT/'scripts/ci/probes/spin-funded-launch-native.sql'):
   e.report['source_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
  e.report['status']='passed';e.report['passed']=True
 finally:
  e.close();(a.evidence/'report.json').write_text(json.dumps(e.report,indent=2)+'\n')
if __name__=='__main__':main()
