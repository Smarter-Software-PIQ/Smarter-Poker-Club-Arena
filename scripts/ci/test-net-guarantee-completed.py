#!/usr/bin/env python3
"""Native caller/transaction proof using the established isolated house-settlement fixture.
Wallet door is the fixture's explicit model; production credit implementation is
separately governed by its existing checks. No sealed evidence is mutated.
"""
from pathlib import Path
import ast,json,os,shutil,socket,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[2]
PG=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
work=Path(tempfile.mkdtemp(prefix='net-terminal-',dir=os.environ['TMPDIR']))
sock=Path(tempfile.mkdtemp(prefix='s-',dir=os.environ.get('CA_PG_SOCKET_ROOT',os.environ['TMPDIR'])))
guard=socket.socket();guard.bind(('127.0.0.1',0));port=str(guard.getsockname()[1]);started=False
T='f22ceae6-2850-40ef-8f97-7d3660be32a3'; U='fade0000-0000-0000-0000-000000000001'
def run(args,sql=None):
 r=subprocess.run([str(x)for x in args],input=sql,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout
def q(sql):return run([PG/'psql','-X','-qAt','-h',sock,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],sql).strip()
def fail(sql,needle):
 try:q(sql)
 except RuntimeError as e:
  assert needle in str(e),str(e);return str(e)
 raise AssertionError('expected refusal '+needle)
try:
 run([PG/'initdb','-D',work/'data','-U','postgres','-A','trust','--no-locale'])
 run([PG/'pg_ctl','-D',work/'data','-l',work/'pg.log','-o',f"-k {sock} -p {port} -c listen_addresses=''",'-w','start']);started=True
 tree=ast.parse((ROOT/'scripts/ci/test-bounty-only-final-two-make-good.py').read_text())
 schema=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SCHEMA' for t in n.targets))
 schema=schema.replace('description text,\n  club_id uuid','description text, from_label text,\n  club_id uuid')
 schema=schema.replace('description, club_id, union_id, tournament_id, idempotency_key, correlation_id)','description, from_label, club_id, union_id, tournament_id, idempotency_key, correlation_id)')
 schema=schema.replace('p_description, v_club, (SELECT union_id','p_description, current_setting(\'app.ledger_counterparty_label\',true), v_club, (SELECT union_id')
 q(schema)
 q("""ALTER TABLE union_wallets ADD promo_wallet numeric(20,2);
 ALTER TABLE tournaments ADD club_id uuid, ADD total_rake numeric, ADD prize_pool_finalized boolean, ADD payout_math_version integer, ADD payout_structure jsonb, ADD bubble_protection boolean;
 ALTER TABLE tournament_players ADD club_id uuid;
 ALTER TABLE tournament_payouts ADD id uuid DEFAULT gen_random_uuid(),ADD user_id uuid,ADD position integer,ADD amount numeric,ADD source text,ADD paid_at timestamptz DEFAULT now();
 ALTER TABLE tournament_obligations ADD settled_at timestamptz;
 CREATE TABLE tournament_escrow(tournament_id uuid,prize_out numeric,prize_balance numeric,bounty_balance numeric,fee_balance numeric,terminal_closed_at timestamptz);
 CREATE TABLE tournament_terminal_settlements(tournament_id uuid,settlement_mode text,cash_payout_total numeric,bounty_payout_total numeric,cash_payout_count integer,prize_pool numeric,bounty_pool numeric,completed_at timestamptz);
 CREATE FUNCTION fn_ca_lock_settlement_lane_for_tournament(uuid)RETURNS void LANGUAGE sql AS $$SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))$$;
 CREATE FUNCTION fn_ca_tournament_unit_cents(uuid)RETURNS integer LANGUAGE sql AS $$SELECT 1$$;""")
 supplemental=(ROOT/'tests/sql/fixtures/bounty-owner-correction.sql').read_text()
 ladder=supplemental[supplemental.index('CREATE OR REPLACE FUNCTION public.fn_ca_prize_ladder('):]
 q(ladder[:ladder.index('CREATE OR REPLACE FUNCTION public.fn_ca_prize_ladder_versioned')])
 structure=json.dumps([{'place':i,'percentage':p}for i,p in enumerate([26.94,15.47,11.19,8.89,7.43,6.42,5.68,5.10,4.65,4.27,3.96],1)])
 q(f"INSERT INTO clubs VALUES('{U}','union','{U}');INSERT INTO union_wallets VALUES('{U}',100000,now(),1000);INSERT INTO tournaments(id,status,prize_pool,bounty_pool,total_rake,guaranteed_prize,union_id,club_id,prize_pool_finalized,payout_math_version,payout_structure)VALUES('{T}','COMPLETED',1742,670,268,2500,'{U}','{U}',true,1,'{structure}');INSERT INTO tournament_escrow VALUES('{T}',1742,0,0,0,'2026-11-08 05:05:19Z');INSERT INTO tournament_terminal_settlements VALUES('{T}','places',1742,670,11,1742,670,'2026-11-08 05:05:19Z');")
 q(f"INSERT INTO tournament_players(tournament_id,user_id,position,prize) SELECT '{T}',md5('user:'||i)::uuid,i,0 FROM generate_series(1,67)i;UPDATE tournament_players SET club_id='{U}' WHERE tournament_id='{T}';INSERT INTO club_members SELECT user_id,club_id,9000 FROM tournament_players WHERE position<=11;INSERT INTO tournament_payouts(tournament_id,user_id,position,amount,source)SELECT '{T}',md5('user:'||i)::uuid,i,a,'structure' FROM unnest(ARRAY[469.29,269.49,194.93,154.86,129.43,111.84,98.95,88.84,81,74.38,68.99])WITH ORDINALITY x(a,i);")
 op=(ROOT/'scripts/operations/owner-net-guarantee-completed-f22ceae6.sql').read_text()
 probe=op.replace('BEGIN;\n',"BEGIN;\nSET LOCAL app.owner_net_guarantee_probe='on';\n",1)
 result=fail(probe,'OWNER_NET_GUARANTEE_ROLLBACK')
 line=result.split('OWNER_NET_GUARANTEE_ROLLBACK ',1)[1].split('\n')[0];proof=json.loads(line)
 assert proof['total']==88 and len(proof['plan'])==11
 assert q('SELECT promo_wallet FROM union_wallets')=='1000.00'
 assert q('SELECT count(*) FROM wallet_credit_idempotency')=='0'
 commit=op.replace('BEGIN;\n',f"BEGIN;\nSET LOCAL app.owner_net_guarantee_expected_paid='{proof['paid_digest']}';\nSET LOCAL app.owner_net_guarantee_expected_promo='1000';\n",1)+'\nCOMMIT;'
 fail(commit.replace(proof['paid_digest'],'00000000000000000000000000000000'),'proof inputs changed')
 q('UPDATE union_wallets SET promo_wallet=87;');fail(probe,'promo balance insufficient');q('UPDATE union_wallets SET promo_wallet=1000;')
 q("CREATE FUNCTION fail_credit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.amount<10 THEN RAISE EXCEPTION 'injected journal refusal';END IF;RETURN NEW;END$$;CREATE TRIGGER fail_credit BEFORE INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION fail_credit();")
 fail(commit,'injected journal refusal');assert q('SELECT count(*) FROM wallet_credit_idempotency')=='0';assert q('SELECT promo_wallet FROM union_wallets')=='1000.00'
 q('DROP TRIGGER fail_credit ON chip_ledger;')
 cmd=[str(x) for x in [PG/'psql','-X','-qAt','-h',sock,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']]
 sessions=[subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
 for session in sessions:
  session.stdin.write(commit);session.stdin.close();session.stdin=None
 for session in sessions:
  out,err=session.communicate(timeout=20);assert session.returncode==0,err
 assert q('SELECT promo_wallet FROM union_wallets')=='912.00';assert q('SELECT sum(amount) FROM wallet_credit_idempotency')=='88.00';assert q("SELECT count(*) FROM ca_manual_adjustments WHERE status='settled'")=='11'
 q(commit);assert q('SELECT promo_wallet FROM union_wallets')=='912.00'
 q("UPDATE ca_manual_adjustments SET status='approved' WHERE id=(SELECT id FROM ca_manual_adjustments LIMIT 1);");fail(commit,'replay receipts conflict')
 print('PASS: completed guarantee supplements pay 11 canonical deltas totaling88 from promo; sealed records unchanged; rollback probe, drift, insufficient bank, partial journal rollback, replay and tamper refusal',flush=True)
finally:
 if started:run([PG/'pg_ctl','-D',work/'data','-m','immediate','stop'])
 guard.close();shutil.rmtree(work);shutil.rmtree(sock)
