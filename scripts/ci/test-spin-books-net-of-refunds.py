#!/usr/bin/env python3
"""A Spin's third paid seat is proven NET of refunds (incident 7e8dce13).

Production 2026-11-24: a player bought into a 5-chip Spin, unregistered
(refunded), bought in again, and waited 13 minutes at 2/3 while every horse
offered for the third seat was refused with three_paid_seats_required
(paid_users 2, buyin_debits 4, buyin_total 20). fn_spin_book_entry counted
gross buy-in debits and never subtracted the refund.

This runs the exact live fn_spin_book_entry (pinned, md5-checked, in
scripts/ci/fixtures/undrawn-spin-cancellation/current-dependencies.json) in a
private PG17 cluster, proves the re-registered and the left-the-board shapes
are refused BEFORE the candidate migration, installs the candidate, and proves
they book exactly once AFTER it while a double charge and an over-refund stay
refused.
"""
import argparse, hashlib, json, sys
from pathlib import Path
sys.dont_write_bytecode=True
from satellite_qualifier_fixture import module
from tournament_abort_fixture import install_financial_foundation
ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'scripts/ci/fixtures/undrawn-spin-cancellation'
MIGRATION=next((ROOT/'supabase/migrations').glob('*_a_spin_seat_counts_a_refunded_entry_as_refunded.sql'))
EVENT='92010000-0000-0000-0000-000000000001'
SERVICE="SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true);SET LOCAL ROLE service_role;"
U1="md5('played-spin-launch-user:1')::uuid"
LEAVER="md5('played-spin-launch-user:4')::uuid"

def wallet(user,kind,category,key):
 return ("INSERT INTO public.wallet_transactions(id,user_id,wallet_type,amount,type,category,description,related_entity_id,balance_after) "
         "VALUES (md5('"+key+"')::uuid,"+user+",'PLAYER',1,'"+kind+"','"+category+"','net-of-refunds probe','"+EVENT+"',99);")

LEAVER_ROWS=("INSERT INTO auth.users(id) VALUES ("+LEAVER+") ON CONFLICT DO NOTHING;"
 "INSERT INTO public.profiles(id,username,display_name) VALUES ("+LEAVER+",'net_refund_leaver','Net Refund Leaver') ON CONFLICT DO NOTHING;")
# Each shape is extra history on top of the three exact paid seats the opening
# already holds. All rows are written with triggers off, like the opening.
SHAPES={
 # A paid seat whose holder bought in, was refunded and bought in again.
 're-registered-player': wallet(U1,'debit','tournament_buyin','net-rereg-debit')+wallet(U1,'credit','refund','net-rereg-refund'),
 # Somebody else bought in and left before the board filled.
 'player-who-left': LEAVER_ROWS+wallet(LEAVER,'debit','tournament_buyin','net-left-debit')+wallet(LEAVER,'credit','refund','net-left-refund'),
 # Both at once: a leaver and a re-registered seat on one board.
 'left-and-re-registered': LEAVER_ROWS+wallet(LEAVER,'debit','tournament_buyin','net-both-left-debit')+wallet(LEAVER,'credit','refund','net-both-left-refund')
   +wallet(U1,'debit','tournament_buyin','net-both-rereg-debit')+wallet(U1,'credit','refund','net-both-rereg-refund'),
}
# Must stay refused after the fix: these are real money faults, not history.
FAULTS={
 'double-charged-seat': wallet(U1,'debit','tournament_buyin','net-double-debit'),
 'refund-without-charge': LEAVER_ROWS+wallet(LEAVER,'credit','refund','net-orphan-refund'),
}

def case_sql(opening,extra,expect_booked):
 check=("DO $c$ DECLARE r jsonb; BEGIN r:=public.fn_spin_book_entry('"+EVENT+"'); RESET ROLE;"
  +("IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'reason' IS DISTINCT FROM 'booked' OR (r->>'collected')::numeric IS DISTINCT FROM 3 "
    "OR (SELECT count(*) FROM spin_reserve_ledger WHERE tournament_id='"+EVENT+"' AND kind='contribution')<>1 "
    "OR (SELECT count(*) FROM chip_ledger WHERE tournament_id='"+EVENT+"' AND category='spin_entry')<>1 "
    "THEN RAISE EXCEPTION 'expected exactly one booking, got %',r;END IF;"
    "SET LOCAL ROLE service_role; r:=public.fn_spin_book_entry('"+EVENT+"'); RESET ROLE;"
    "IF r->>'reason' IS DISTINCT FROM 'already_booked' OR (SELECT count(*) FROM spin_reserve_ledger WHERE tournament_id='"+EVENT+"' AND kind='contribution')<>1 "
    "THEN RAISE EXCEPTION 'replay booked twice: %',r;END IF;"
    if expect_booked else
    "IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'reason' IS DISTINCT FROM 'three_paid_seats_required' "
    "OR EXISTS(SELECT 1 FROM spin_reserve_ledger WHERE tournament_id='"+EVENT+"') "
    "THEN RAISE EXCEPTION 'expected a refusal with nothing booked, got %',r;END IF;")
  +"END $c$;ROLLBACK;")
 return 'BEGIN;'+opening+'SET LOCAL session_replication_role=replica;'+extra+'SET LOCAL session_replication_role=origin;'+SERVICE+check

def main():
 p=argparse.ArgumentParser()
 for name in ('evidence','work-root','socket-root','pg-bin'):p.add_argument('--'+name,type=Path,required=True)
 a=p.parse_args();a.evidence.mkdir(parents=True,exist_ok=False)
 a.work_root.mkdir(parents=True,exist_ok=True);a.socket_root.mkdir(parents=True,exist_ok=True)
 native=module(ROOT/'scripts/ci/test-mtt-unlimited.py','spin_net_refund_native')
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
  _,live_md5,_=e.sql(db,"SELECT md5(pg_get_functiondef('public.fn_spin_book_entry(uuid)'::regprocedure));",label='baseline-is-live-definition')
  # The production definition read on 2026-11-24 before the candidate.
  assert live_md5.strip()=='3e861cfde0bda50d16bc836a665bf4ab',live_md5
  raw=(ROOT/'scripts/ci/probes/spin-funded-launch-native.sql').read_text()
  opening=raw[raw.index('SET LOCAL session_replication_role=replica;'):raw.index('INSERT INTO public.tournament_launch_receipts(')]
  opening=opening.replace('is_sitting_out,is_away,club_id\n)', 'is_sitting_out,is_away,club_id,active_game_scope,active_parent_key\n)')
  opening=opening.replace("       '92000000-0000-0000-0000-000000000001'\n  FROM generate_series(1,3) g(i);\n\nINSERT INTO public.tournament_escrow", "       '92000000-0000-0000-0000-000000000001',\n       'table:92020000-0000-0000-0000-000000000001',\n       'tournament:92010000-0000-0000-0000-000000000001'\n  FROM generate_series(1,3) g(i);\n\nINSERT INTO public.tournament_escrow")
  # The same actor rows the cancellation harness seeds: the ledger triggers
  # attribute automatic legs to the platform actor.
  opening+='''INSERT INTO auth.users(id) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d') ON CONFLICT DO NOTHING;
INSERT INTO public.users(id,username) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','smarterpoker') ON CONFLICT DO NOTHING;
INSERT INTO public.users(id,username) SELECT md5('played-spin-launch-user:'||i)::uuid,'spin_net_refund_'||i FROM generate_series(1,4)i ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role=origin;
'''
  e.report['cases']=[]
  # BEFORE: the clean board books; every history shape reproduces the refusal.
  path=a.evidence/'before-clean.sql';path.write_text(case_sql(opening,'',True))
  e.sql(db,file=path,label='before-clean-board-books');e.report['cases'].append('before-clean-board-books')
  for name,extra in SHAPES.items():
   path=a.evidence/('before-'+name+'.sql');path.write_text(case_sql(opening,extra,False))
   e.sql(db,file=path,label='before-'+name+'-reproduces-refusal');e.report['cases'].append('before-'+name+'-reproduces-refusal')
  e.sql(db,file=MIGRATION,label='install-exact-candidate')
  proof_line=next(line[len('-- @live-proof: '):] for line in MIGRATION.read_text().splitlines() if line.startswith('-- @live-proof: '))
  _,live_result,_=e.sql(db,'SELECT '+proof_line+';',label='candidate-live-proof')
  assert live_result.strip()=='t',live_result
  _,privs,_=e.sql(db,"SELECT has_function_privilege('anon','public.fn_spin_book_entry(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.fn_spin_book_entry(uuid)','EXECUTE') OR NOT has_function_privilege('service_role','public.fn_spin_book_entry(uuid)','EXECUTE');",label='candidate-role-authority')
  assert privs.strip()=='f',privs
  # AFTER: the clean board and every history shape book exactly once.
  path=a.evidence/'after-clean.sql';path.write_text(case_sql(opening,'',True))
  e.sql(db,file=path,label='after-clean-board-books');e.report['cases'].append('after-clean-board-books')
  for name,extra in SHAPES.items():
   path=a.evidence/('after-'+name+'.sql');path.write_text(case_sql(opening,extra,True))
   e.sql(db,file=path,label='after-'+name+'-books-once');e.report['cases'].append('after-'+name+'-books-once')
  for name,extra in FAULTS.items():
   path=a.evidence/('after-'+name+'.sql');path.write_text(case_sql(opening,extra,False))
   e.sql(db,file=path,label='after-'+name+'-still-refused');e.report['cases'].append('after-'+name+'-still-refused')
  for path in (Path(__file__),MIGRATION,helper_path,ROOT/'scripts/ci/probes/spin-funded-launch-native.sql'):
   e.report['source_sha256'][str(path.relative_to(ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
  e.report['status']='passed';e.report['passed']=True
 finally:
  e.close();(a.evidence/'report.json').write_text(json.dumps(e.report,indent=2)+'\n')
if __name__=='__main__':main()
