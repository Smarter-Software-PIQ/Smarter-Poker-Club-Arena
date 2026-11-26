#!/usr/bin/env python3
"""Actual reporting SQL, fail-before/pass-after, in a socket-only private PG17."""
import argparse, hashlib, json, os, shutil, subprocess, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FIX=ROOT/'scripts/ci/fixtures/spin-cancellation-reporting'
MIG=ROOT/'supabase/migrations/20261126160519_spin_cancellation_readers_count_fee_and_reserve_reversals.sql'
p=argparse.ArgumentParser();p.add_argument('--pg-bin',default=os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin'));p.add_argument('--scratch',default=tempfile.gettempdir());a=p.parse_args()
pg=Path(a.pg_bin);scratch=Path(tempfile.mkdtemp(prefix='scr-',dir=a.scratch));started=False
# macOS Unix-domain socket paths have a 104-byte ceiling. The caller supplies
# a short, task-owned external scratch directory.
def run(argv,sql=None,error=None):
 r=subprocess.run([str(x) for x in argv],input=sql,text=True,capture_output=True,timeout=90)
 if error: assert r.returncode and error in r.stderr,r.stdout+r.stderr
 else: assert r.returncode==0,r.stdout+r.stderr
 return r.stdout.strip()
def q(sql,error=None):return run([pg/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',scratch,'-U','postgres','-d','postgres'],sql,error)
def event(n):return '92010000-0000-0000-0000-'+str(n).zfill(12)
def result(n):return json.loads(q("SELECT json_build_object('prize',s.prize_balance,'fee',s.fee_balance,'delta',fn_tournament_conservation_delta('"+event(n)+"')) FROM fn_ca_tournament_escrow_chips('"+event(n)+"') s;"))
try:
 assert ' 17.' in run([pg/'postgres','--version'])
 run([pg/'initdb','-D',scratch/'data','-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8'])
 with (scratch/'data/postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(scratch)+"'\nautovacuum=off\n")
 run([pg/'pg_ctl','-D',scratch/'data','-l',scratch/'server.log','-w','start']);started=True
 q((FIX/'setup.sql').read_text())
 for row in json.loads((FIX/'current-readers.json').read_text()):
  assert hashlib.md5(row['definition'].encode()).hexdigest()==row['md5']
  q(row['definition'])
 # Undrawn cancellation at every production stake; an absent receipt must not
 # get the fee exception. Drawn cancellation tests both signed reserve legs.
 for n,stake in enumerate((1,2,3,5,10,20,50,100),1):
  gross=stake*3;fee=round(gross*.08,2);contribution=round(gross-fee,2);tid=event(n)
  q(f"INSERT INTO tournaments(id,variant,tournament_type) VALUES('{tid}','spin','SPIN'); INSERT INTO wallet_transactions VALUES('{tid}','debit','tournament_buyin',{gross},NULL),('{tid}','credit','refund',{gross},NULL); INSERT INTO rake_records VALUES('{tid}',true,{fee},{gross},'fn_spin_book_entry','{{}}'),('{tid}',true,{-fee},0,'atomic_cancel_tournament','{{}}'); INSERT INTO tournament_refund_tranches VALUES('{tid}',{gross},{gross},0,0); INSERT INTO spin_reserve_ledger VALUES('{tid}','contribution',{contribution}),('{tid}','contribution_reversal',{-contribution}); INSERT INTO tournament_spin_cancellation_unwinds VALUES('{tid}',NULL);")
  r=result(n);assert r=={'prize':-fee,'fee':fee,'delta':-contribution},(n,r)
 # Ordinary cancellation/unregister/operator abort keeps exact fee refund rails.
 for n,source in ((20,'atomic_cancel_tournament'),(21,'fn_unregister_from_tournament'),(22,'operator_abort_tournament')):
  tid=event(n);q(f"INSERT INTO tournaments(id,variant,tournament_type) VALUES('{tid}','regular','MTT'); INSERT INTO wallet_transactions VALUES('{tid}','debit','tournament_buyin',100,NULL),('{tid}','credit','refund',100,NULL); INSERT INTO rake_records VALUES('{tid}',true,8,100,'registration','{{}}'),('{tid}',true,-8,0,'{source}','{{}}'); INSERT INTO tournament_refund_tranches VALUES('{tid}',100,92,0,8);")
 # Healthy low/high multiplier Spin, missing draw, and unrelated reserve-owner
 # adjustment: only the event's four signed movement kinds affect conservation.
 for n,prize,draw in ((30,20,-20),(31,100,-100),(32,100,-99)):
  tid=event(n);q(f"INSERT INTO tournaments(id,variant,tournament_type) VALUES('{tid}','spin','SPIN'); INSERT INTO wallet_transactions VALUES('{tid}','debit','tournament_buyin',30,NULL),('{tid}','credit','prize',{prize},NULL); INSERT INTO rake_records VALUES('{tid}',true,3,30,'fn_spin_book_entry','{{}}'); INSERT INTO spin_reserve_ledger VALUES('{tid}','contribution',27),('{tid}','jackpot_draw',{draw}),('{tid}','seed_return',-999);")
 tid=event(40);q(f"INSERT INTO clubs VALUES('{event(400)}','diamonds',true,NULL); INSERT INTO tournaments(id,club_id) VALUES('{tid}','{event(400)}');")
 q("UPDATE tournaments SET name=id::text,status='CANCELLED',ended_at=now()-interval '1 hour',buy_in_amount=100 WHERE variant IS DISTINCT FROM 'spin';")
 batch_sql="SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM fn_tournament_conservation_deltas(now()-interval '2 hours',now()) x;"
 batch_before=q(batch_sql)
 assert len(json.loads(batch_before))==4,'batch excludes Spins'
 assert q("SELECT count(*) FROM fn_tournament_conservation_deltas(now()-interval '2 hours',now()) x WHERE x.delta IS DISTINCT FROM fn_tournament_conservation_delta(x.id);")=='0'
 before={n:result(n) for n in (20,21,22,30,31,32,40)}
 q("CREATE ROLE reporting_reader; REVOKE ALL ON FUNCTION fn_ca_tournament_escrow_chips(uuid),fn_tournament_conservation_delta(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION fn_ca_tournament_escrow_chips(uuid),fn_tournament_conservation_delta(uuid) TO reporting_reader;")
 catalog=q("SELECT json_agg(json_build_array(oid,proowner,prosecdef,provolatile,proconfig,proacl) ORDER BY oid) FROM pg_proc WHERE oid IN ('fn_ca_tournament_escrow_chips(uuid)'::regprocedure,'fn_tournament_conservation_delta(uuid)'::regprocedure);")
 q(MIG.read_text().replace('COMMIT;',"DO $$BEGIN RAISE EXCEPTION 'rollback_fixture';END$$;COMMIT;"),'rollback_fixture')
 assert result(1)['delta']==-2.76
 q(MIG.read_text())
 proof=next(line[len('-- @live-proof: '):] for line in MIG.read_text().splitlines() if line.startswith('-- @live-proof: '))
 assert q('SELECT '+proof)== 't','exact installed postimages'
 for n in range(1,9):assert result(n)=={'prize':0,'fee':0,'delta':0},(n,result(n))
 assert before=={n:result(n) for n in before},'non-Spin and played-Spin parity'
 assert batch_before==q(batch_sql),'non-Spin batch parity'
 assert q("SELECT count(*) FROM fn_tournament_conservation_deltas(now()-interval '2 hours',now()) x WHERE x.delta IS DISTINCT FROM fn_tournament_conservation_delta(x.id);")=='0','batch scalar parity'
 assert catalog==q("SELECT json_agg(json_build_array(oid,proowner,prosecdef,provolatile,proconfig,proacl) ORDER BY oid) FROM pg_proc WHERE oid IN ('fn_ca_tournament_escrow_chips(uuid)'::regprocedure,'fn_tournament_conservation_delta(uuid)'::regprocedure);"),'authority preserved'
 q('DELETE FROM tournament_spin_cancellation_unwinds WHERE tournament_id=\''+event(1)+"';")
 assert result(1)['fee']==.24,'no receipt must keep fee mismatch visible'
 tid=event(2);q(f"UPDATE tournament_spin_cancellation_unwinds SET original_draw_id='{event(99)}' WHERE tournament_id='{tid}'; INSERT INTO spin_reserve_ledger VALUES('{tid}','jackpot_draw',-100),('{tid}','draw_reversal',100);")
 assert result(2)['fee']==.48 and result(2)['delta']==0,'drawn cancellation signed reversals; no undrawn fee exception'
 q(MIG.read_text(),'spin_cancellation_reporting_preimage_refused')
 print('PASS: eight stakes fail-before/pass-after; refund-rail and healthy Spin parity; missing receipt; drawn reversals; rollback; stale preimage; role/config/OID preserved')
finally:
 if started:run([pg/'pg_ctl','-D',scratch/'data','-m','fast','-w','stop'])
 shutil.rmtree(scratch)
