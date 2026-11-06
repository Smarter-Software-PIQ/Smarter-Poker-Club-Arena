#!/usr/bin/env python3
"""Real seat/wallet/pending writes against captured production purchase owners."""
import os,socket,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PG=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
with tempfile.TemporaryDirectory(prefix='cash-min-',dir=os.environ.get('TMPDIR',str(ROOT/'work'))) as tmp:
 folder=Path(tmp)
 def run(args,sql=None):
  p=subprocess.run([str(a) for a in args],input=sql,text=True,capture_output=True,timeout=45)
  if p.returncode: raise RuntimeError(p.stdout+p.stderr)
  return p.stdout.strip()
 with socket.socket() as s:
  s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
 run([PG/'initdb','-D',folder/'db','-U','postgres','-A','trust','--no-locale'])
 run([PG/'pg_ctl','-D',folder/'db','-l',folder/'log','-o',f"-h 127.0.0.1 -p {port} -k ''",'-w','start'])
 def q(sql):return run([PG/'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres'],sql)
 try:
  q('''CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
CREATE FUNCTION fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE TABLE clubs(id uuid,union_id uuid);
CREATE TABLE tables(id uuid,club_id uuid,big_blind numeric,min_buy_in numeric,max_buy_in numeric);
CREATE TABLE table_seats(id uuid DEFAULT gen_random_uuid(),table_id uuid,user_id uuid,club_id uuid,stack numeric,left_at timestamptz,occupancy_id uuid DEFAULT gen_random_uuid());
CREATE TABLE club_members(user_id uuid,club_id uuid,chip_balance numeric,updated_at timestamptz);
CREATE TABLE blacklists(id uuid,user_id uuid,club_id uuid,union_id uuid,expires_at timestamptz);
CREATE TABLE table_addon_idempotency(key text PRIMARY KEY,user_id uuid,table_id uuid,amount numeric,applied_to_seat boolean);
CREATE TABLE transaction_idempotency_keys(key uuid PRIMARY KEY,user_id uuid,action text,amount numeric);
CREATE TABLE table_pending_addons(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,table_id uuid,user_id uuid,amount numeric,kind text,resolved_at timestamptz,applied_to_stack numeric,refunded numeric);
CREATE TABLE wallet_transactions(id uuid DEFAULT gen_random_uuid(),user_id uuid,wallet_type text,type text,amount numeric,category text,description text,table_id uuid,balance_after numeric);
CREATE FUNCTION fn_ensure_club_wallet(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_seat_club_for_user(uuid,uuid,uuid) RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
CREATE FUNCTION fn_cash_session_add_baseline(uuid,uuid,numeric) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_cash_record_original_funding(text,text,uuid,uuid,uuid,uuid,uuid,numeric,numeric,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_cash_record_funding_application(uuid,numeric,numeric,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION atomic_credit_wallet_and_log(uuid,numeric,text,text,uuid,uuid,uuid,text) RETURNS void LANGUAGE sql AS $$UPDATE club_members SET chip_balance=chip_balance+$2 WHERE user_id=$1$$;
INSERT INTO clubs VALUES('11111111-1111-1111-1111-111111111111',NULL);
INSERT INTO tables VALUES('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111',2,80,400);
INSERT INTO table_seats(table_id,user_id,club_id,stack) VALUES('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',0);
INSERT INTO club_members VALUES('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',500,now());
''')
  q((ROOT/'tests/fixtures/cash-minimum-purchase-owners.sql').read_text())
  t="'11111111-1111-1111-1111-111111111111'";u="'22222222-2222-2222-2222-222222222222'"
  rebuy=lambda n:f"atomic_table_rebuy_before_maintenance_announcement_gate({u},{t},{n},gen_random_uuid())"
  addon=lambda n,direct:f"atomic_table_addon_before_maintenance_announcement_gate({u},{t},{n},{direct},gen_random_uuid()::text)"
  # Demonstrate the captured production defect, inside rollback only.
  assert q(f'BEGIN; SELECT {rebuy(44)}; ROLLBACK;')=='456'
  assert q(f'BEGIN; SELECT {addon(41.88,"true")}; ROLLBACK;')=='458.12'
  q((ROOT/'supabase/migrations/20261106043954_cash_rebuys_require_the_full_minimum.sql').read_text())
  for call in [rebuy(44),rebuy(79.99),addon(41.88,'true'),addon(44,'false')]:
   q(f"DO $$ BEGIN BEGIN PERFORM {call}; RAISE EXCEPTION 'short buy accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM NOT LIKE 'BUYIN_BELOW_MINIMUM%' THEN RAISE; END IF; END; ASSERT (SELECT chip_balance FROM club_members)=500; ASSERT NOT EXISTS(SELECT FROM wallet_transactions); END $$;")
  assert q(f'BEGIN; SELECT {rebuy(80)}; ROLLBACK;')=='420'
  assert q(f'BEGIN; SELECT {addon(80,"true")}; ROLLBACK;')=='420'
  # Exact Madness table row minimum (200) is respected above the 40BB floor.
  q('UPDATE tables SET min_buy_in=200;')
  q(f"DO $$ BEGIN BEGIN PERFORM {rebuy(80)}; RAISE EXCEPTION 'table minimum bypassed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END; END $$;")
  q('UPDATE tables SET min_buy_in=80; UPDATE table_seats SET stack=10;')
  assert q(f'BEGIN; SELECT {addon(5,"true")}; ROLLBACK;')=='495'
  # Original queued request is refunded once if the hand subsequently felts it.
  q(f"SELECT {addon(44,'false')}; UPDATE table_seats SET stack=0;")
  assert q('SELECT applied||\',\'||refunded FROM resolve_pending_addon((SELECT id FROM table_pending_addons),400)')=='0,44'
  assert q('SELECT chip_balance FROM club_members')=='500.00'
  assert q('SELECT was_resolved FROM resolve_pending_addon((SELECT id FROM table_pending_addons),400)')=='f'
  assert q('SELECT chip_balance FROM club_members')=='500.00'
  print('PASS: reproduced short rebuy/addon; minimum and table floor, no debit on refusal, exact boundary, legitimate topup, queued bust refund and replay')
 finally:run([PG/'pg_ctl','-D',folder/'db','-m','immediate','-w','stop'])
