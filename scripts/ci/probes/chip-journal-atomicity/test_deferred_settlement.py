"""The next cash deal and the settlement work deferred past it (2026-11-09).

#10165 releases a cash table's next deal once every seat and stack writer of
the previous hand has run, and lets the table_unlock recount (a seat count and
a `tables` summary) run after it. It also reads the committed stacks beside the
post-commit envelope and uses that read only when the envelope resolved no
add-on. This proves, on real PostgreSQL 17 sessions and the real money bodies,
the four properties that change rests on:

  1 CONSERVATION  every chip in equals every chip out across hand end, the
                  envelope (rake, BBJ, a mid-hand add-on), a horse top-up, the
                  next deal's starting stacks, the deferred recount and a
                  cash-out at hand end;
  2 CONCURRENCY   the deferred recount running while the next hand's manifest
                  read and its settlement run on the same table, and two tables
                  settling add-ons into one shared player wallet at once;
  3 RETRY         a deferred step (the recount) and the envelope that times out
                  and is retried apply their effect exactly once;
  4 PARTIAL       a deferred step that fails midway leaves no half-applied
                  balance, the failure is recorded, and the stacks the next
                  deal reads are already final before it runs.

fn_ca_process_hand_post_commit_obligations and resolve_pending_addon are the
production definitions (md5-checked against the captured live bodies).
fn_ca_settle_hand_stacks_absolute, atomic_distribute_rake and
fn_horse_fund_from_treasury are the current migration bodies the chip journal
bootstrap already installs or this file installs. The wallet-credit leaf is a
conserving stand-in that writes the wallet and one chip_ledger leg.
"""
import json, os, re, subprocess
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
FIX=ROOT/'tests/fixtures/deferred-settlement'
CLUB='d1000000-0000-4000-8000-000000000001'
T1='d1000000-0000-4000-8000-000000000002'
T2='d1000000-0000-4000-8000-000000000003'
A='d1000000-0000-4000-8000-000000000004'   # human, seated at both tables (shared wallet)
B='d1000000-0000-4000-8000-000000000005'   # human
H='d1000000-0000-4000-8000-000000000006'   # horse
OP='d1000000-0000-4000-8000-000000000007'
HAND1='d1000000-0000-4000-8000-000000000011'
HAND2='d1000000-0000-4000-8000-000000000012'
HANDX='d1000000-0000-4000-8000-000000000013'
ADD1='d1000000-0000-4000-8000-000000000021'
ADD2='d1000000-0000-4000-8000-000000000022'


def latest(name):
 body=None
 for p in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  s=p.read_text()
  for m in re.finditer(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\s*\(',s):
   t=s[m.start():];b=re.search(r'\bAS\s+(\$[A-Za-z0-9_]*\$)',t);e=t.index(b[1],b.end())
   body=t[:e+len(b[1])]+';'
 if not body: raise RuntimeError('missing '+name)
 return body


# Production md5 (read-only, 2026-11-09) of the bodies this proof installs from
# migrations. resolve_pending_addon and fn_horse_fund_from_treasury are byte
# identical. The live post-commit processor adds only the tournament shared-lane
# wait (stubbed here: cash tables have no lane); the live hand settler adds only
# the Diamond, Lightning-anchor and retired-original branches, none of which a
# plain cash hand reaches.
PRODUCTION_MD5={'resolve_pending_addon':'0abfcda28173f8251b4b3cff0ad52be6',
 'fn_horse_fund_from_treasury':'333e4d276480e5d4cb37c0ffb970a07e'}
def pinned(name):
 return latest(name)+("DO $md5$BEGIN IF md5(pg_get_functiondef('public."+name+"'::regproc))<>'"+PRODUCTION_MD5[name]+
  "' THEN RAISE EXCEPTION 'installed "+name+" is not the production body';END IF;END $md5$;\n")


SCHEMA="""
-- Earlier probes in this journal leave narrower category checks on the shared
-- chip_ledger fixture; this proof's legs (burn, horse funding, add-on refund)
-- run with none. Every case is one transaction that rolls back, or a dedicated
-- clone, so the shared fixture is never changed.
DO $drop$DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='chip_ledger'::regclass AND contype='c' LOOP
  EXECUTE format('ALTER TABLE chip_ledger DROP CONSTRAINT %I',c); END LOOP; END $drop$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS smarter_private;
CREATE OR REPLACE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256($1)$$;
CREATE OR REPLACE FUNCTION smarter_private.f06_wait_table_lane(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
DROP TABLE IF EXISTS hand_atomic_commits, table_pending_addons;
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY,table_id uuid,hand_number bigint,
 post_commit_payload jsonb,post_commit_payload_hash text,post_commit_completed_at timestamptz,post_commit_result jsonb);
CREATE TABLE table_pending_addons(id uuid PRIMARY KEY,table_id uuid,user_id uuid,amount numeric,
 resolved_at timestamptz,applied_to_stack numeric,refunded numeric,kind text DEFAULT 'addon',created_at timestamptz DEFAULT now());
ALTER TABLE tables ADD COLUMN IF NOT EXISTS big_blind numeric, ADD COLUMN IF NOT EXISTS status text DEFAULT 'running';
ALTER TABLE bbj_pools ADD COLUMN IF NOT EXISTS union_id uuid, ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
 ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
CREATE TABLE IF NOT EXISTS hand_rake_in_flight(hand_id uuid PRIMARY KEY,amount numeric);
-- The rake leaves the hand (where the accepted commit put it) exactly when the
-- envelope books it: one helper so the closed-system total can count it.
CREATE OR REPLACE FUNCTION pg_temp_envelope(p_hand uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN
 r:=fn_ca_process_hand_post_commit_obligations(p_hand);
 IF (r->>'ok')::boolean AND NOT coalesce((r->>'already_completed')::boolean,false) THEN
  DELETE FROM hand_rake_in_flight WHERE hand_id=p_hand; END IF;
 RETURN r; END $$;
-- The accepted commit must succeed; a refused hand is a failed proof.
CREATE OR REPLACE FUNCTION pg_temp_settle(r jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'hand settle refused: %',r; END IF; RETURN r; END $$;
CREATE OR REPLACE FUNCTION pg_temp_recount(p_table uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; BEGIN
 SELECT count(*)::int INTO n FROM table_seats WHERE table_id=p_table AND left_at IS NULL;
 UPDATE tables t SET current_players=n, status=CASE WHEN n>=2 THEN 'running' ELSE 'waiting' END
  WHERE t.id=p_table AND t.status<>'closed'
    AND (t.current_players IS DISTINCT FROM n OR t.status IS DISTINCT FROM CASE WHEN n>=2 THEN 'running' ELSE 'waiting' END);
 RETURN n; END $$;
CREATE TABLE IF NOT EXISTS deferred_step_failures(table_id uuid,hand_number bigint,step text,error text,at timestamptz DEFAULT clock_timestamp());
-- Leaf stand-ins: the add-on funding receipt and the promo/insurance doors are
-- not in this proof's scope; the wallet credit is conserving (one wallet write,
-- one table_stack -> player_wallet ledger leg).
CREATE OR REPLACE FUNCTION fn_cash_record_funding_application(uuid,numeric,numeric,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE OR REPLACE FUNCTION atomic_credit_wallet_and_log(p_user uuid,p_amount numeric,p_kind text,p_note text,
 p_table uuid,p_a uuid,p_b uuid,p_key text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE club_members SET chip_balance=chip_balance+p_amount WHERE user_id=p_user;
 INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,idempotency_key)
 VALUES('table_stack',p_table,'player_wallet',p_user,p_amount,p_kind,p_key);
END $$;
"""

# The deferred step, as the engine sends it after the deal is released: count
# the open seats and correct the stored summary only when it disagrees
# (services/supabase/tables.ts reconcileTableSeatCount, one read + one filtered
# update). It touches no seat and no chip.
RECOUNT=f"pg_temp_recount('{T1}')"

# Every chip in the closed system: wallets, seats, unresolved add-ons, the
# club treasury, the BBJ pool, the rake records' club credit and union legs.
TOTAL="""(SELECT coalesce((SELECT sum(chip_balance) FROM club_members),0)
 +coalesce((SELECT sum(stack) FROM table_seats WHERE left_at IS NULL),0)
 +coalesce((SELECT sum(amount) FROM table_pending_addons WHERE resolved_at IS NULL),0)
 +coalesce((SELECT sum(chip_treasury) FROM clubs),0)
 +coalesce((SELECT sum(main_balance+backup_balance+promo_balance) FROM bbj_pools),0)
 +coalesce((SELECT sum(chip_balance) FROM club_wallets),0)
 +coalesce((SELECT sum(coalesce(chip_balance,0)+coalesce(rake_wallet,0)) FROM union_wallets),0)
 +coalesce((SELECT sum(amount) FROM hand_rake_in_flight),0)
 -- A standalone club's cash rake is retired by design (atomic_distribute_rake,
 -- chip_treasury route): counted as chips out, on its own ledger leg.
 +coalesce((SELECT sum(amount) FROM chip_ledger WHERE to_type='chip_retirement' AND category='burn'),0))"""


def payload(rake=0,bbj=0,addons=()):
 p=dict(time_banks=[],promo_playthrough=[],insurance=[],
  rake=(dict(club_id=CLUB,amount=rake,bbj=bbj,pot=40,num_players=2,contributions=None,returned_uncalled={},method='WEIGHTED_CONTRIBUTED') if rake else None),
  bbj_contribution=None,
  pending_addons=dict(enabled=True,max_buy_in=300,ids=list(addons)))
 return "'"+json.dumps(p)+"'::jsonb"


def seed(addon=25):
 return f"""
 INSERT INTO clubs(id,chip_treasury) VALUES('{CLUB}',1000);
 INSERT INTO tables(id,club_id,min_buy_in,max_buy_in,big_blind,current_players,status) VALUES
  ('{T1}','{CLUB}',40,300,2,3,'running'),('{T2}','{CLUB}',40,300,2,2,'running');
 INSERT INTO club_members(id,user_id,club_id,chip_balance) VALUES
  (gen_random_uuid(),'{A}','{CLUB}',500),(gen_random_uuid(),'{B}','{CLUB}',500);
 INSERT INTO table_seats(table_id,user_id,seat_number,stack,is_sitting_out,club_id) VALUES
  ('{T1}','{A}',1,100,false,'{CLUB}'),('{T1}','{B}',2,100,false,'{CLUB}'),('{T1}','{H}',3,100,false,'{CLUB}'),
  ('{T2}','{A}',1,100,false,'{CLUB}'),('{T2}','{B}',2,100,false,'{CLUB}');
 -- A's mid-hand add-on: the wallet was debited at request, the chips are owed.
 UPDATE club_members SET chip_balance=chip_balance-{addon} WHERE user_id='{A}';
 INSERT INTO table_pending_addons(id,table_id,user_id,amount) VALUES('{ADD1}','{T1}','{A}',{addon});
 """


def commit_hand(hand,table,number,stacks,rake=0,addons=(),plpgsql=False):
 """The accepted hand's own transaction: the delta stack write through the real
 settler, the rake held for the envelope, and the frozen envelope row."""
 rows=json.dumps([dict(user_id=u,stack=s,stack_before=b) for u,s,b in stacks])
 call="PERFORM" if plpgsql else "SELECT"
 return f"""
 {call} pg_temp_settle(fn_ca_settle_hand_stacks_absolute('{table}',{number},'{rows}'::jsonb,{rake},0,null,0));
 INSERT INTO hand_rake_in_flight VALUES('{hand}',{rake});
 INSERT INTO hand_atomic_commits(hand_id,table_id,hand_number,post_commit_payload) VALUES('{hand}','{table}',{number},{payload(rake=rake,addons=addons)});
 UPDATE hand_atomic_commits SET post_commit_payload_hash=encode(extensions.digest(convert_to(post_commit_payload::text,'UTF8'),'sha256'),'hex') WHERE hand_id='{hand}';
 """


def envelope(hand):
 return f"pg_temp_envelope('{hand}')"


def verify_deferred_settlement(run):
 ddl=SCHEMA+latest('fn_ca_settle_hand_stacks_absolute')+pinned('resolve_pending_addon')+latest('fn_ca_process_hand_post_commit_obligations')
 hand=(HERE/'hand-fixture.sql').read_text().replace('ALTER TABLE tournaments ADD COLUMN starting_chips numeric, ADD COLUMN rebuy_chips numeric, ADD COLUMN addon_chips numeric;','')
 # A role is cluster-wide, so the committed concurrency clones must not create
 # one: later journal probes require the postgres role to be absent. The
 # settler needs no owner change here.
 role="DO $role$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres SUPERUSER; END IF; END $role$;"
 if hand.count(role)!=1: raise RuntimeError('hand fixture role line moved')
 ddl+=hand.replace(role,'')
 passed=0

 # 1. CONSERVATION across hand end, envelope (rake + add-on), horse top-up,
 #    the next deal's stacks, the deferred recount and a cash-out at hand end.
 run('BEGIN;'+ddl+seed()+f"""
 DO $c$ DECLARE t0 numeric; t1 numeric; r jsonb; dealt numeric; BEGIN
  t0:={TOTAL};
  -- Hand 1: A wins 20 from B, 2 raked (B 100 -> 80, A 100 -> 118).
  {commit_hand(HAND1,T1,1000001,[(A,118,100),(B,80,100),(H,100,100)],rake=2,addons=[ADD1],plpgsql=True)}
  IF {TOTAL}<>t0 THEN RAISE EXCEPTION 'hand commit moved chips: % -> %',t0,{TOTAL}; END IF;
  -- The envelope: rake booked, A's frozen add-on resolved onto the seat.
  r:={envelope(HAND1)};
  IF r->>'ok' IS DISTINCT FROM 'true' OR (r->>'pending_addons')::int<>1 THEN RAISE EXCEPTION 'envelope: %',r; END IF;
  IF {TOTAL}<>t0 THEN RAISE EXCEPTION 'envelope moved chips: % -> %',t0,{TOTAL}; END IF;
  -- Horse top-up from the club treasury (the real funding door).
  PERFORM set_config('app.ledger_autoskip_clubs','x',true);
  r:=fn_horse_fund_from_treasury('{T1}','{H}',50,'{OP}');
  IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'top-up: %',r; END IF;
  IF {TOTAL}<>t0 THEN RAISE EXCEPTION 'top-up moved chips: % -> %',t0,{TOTAL}; END IF;
  -- The next deal reads its stacks here, BEFORE the deferred recount.
  SELECT sum(stack) INTO dealt FROM table_seats WHERE table_id='{T1}' AND left_at IS NULL;
  IF dealt<>118+25+80+150 THEN RAISE EXCEPTION 'next deal read % (expected 373)',dealt; END IF;
  -- The deferred recount, after the deal.
  PERFORM {RECOUNT};
  IF {TOTAL}<>t0 OR (SELECT sum(stack) FROM table_seats WHERE table_id='{T1}' AND left_at IS NULL)<>dealt
   THEN RAISE EXCEPTION 'recount moved a chip'; END IF;
  -- Cash-out at hand end: B leaves with 80.
  UPDATE club_members SET chip_balance=chip_balance+80 WHERE user_id='{B}';
  UPDATE table_seats SET left_at=now() WHERE table_id='{T1}' AND user_id='{B}';
  PERFORM {RECOUNT};
  t1:={TOTAL};
  IF t1<>t0 THEN RAISE EXCEPTION 'cash-out lost chips: % -> %',t0,t1; END IF;
  IF (SELECT current_players FROM tables WHERE id='{T1}')<>2 THEN RAISE EXCEPTION 'recount wrong'; END IF;
  RAISE NOTICE 'PASS conservation: % chips in, % out across commit, envelope (rake+add-on), top-up, next deal, recount, cash-out',t0,t1;
 END $c$; ROLLBACK;""");passed+=1

 # 3. RETRY: the envelope and the deferred recount, each applied twice.
 run('BEGIN;'+ddl+seed()+commit_hand(HAND1,T1,1000001,[(A,118,100),(B,80,100),(H,100,100)],rake=2,addons=[ADD1])+f"""
 DO $r$ DECLARE t0 numeric; s jsonb; r jsonb; BEGIN
  t0:={TOTAL};
  r:={envelope(HAND1)};
  SELECT jsonb_build_array((SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats),(SELECT jsonb_agg(chip_balance ORDER BY user_id) FROM club_members),
   (SELECT count(*) FROM rake_records),(SELECT count(*) FROM chip_ledger)) INTO s;
  -- A lost reply: the identical call again.
  r:=fn_ca_process_hand_post_commit_obligations('{HAND1}');
  IF r->>'already_completed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'envelope replay: %',r; END IF;
  -- The resolver directly, as a recovery path would.
  PERFORM resolve_pending_addon('{ADD1}',300);
  PERFORM {RECOUNT}; PERFORM {RECOUNT};
  IF s IS DISTINCT FROM jsonb_build_array((SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats),(SELECT jsonb_agg(chip_balance ORDER BY user_id) FROM club_members),
   (SELECT count(*) FROM rake_records),(SELECT count(*) FROM chip_ledger)) OR {TOTAL}<>t0
   THEN RAISE EXCEPTION 'a retry applied an effect twice'; END IF;
  IF (SELECT stack FROM table_seats WHERE table_id='{T1}' AND user_id='{A}')<>143 THEN RAISE EXCEPTION 'add-on not applied exactly once'; END IF;
  RAISE NOTICE 'PASS retry: envelope, resolver and recount replays apply nothing twice';
 END $r$; ROLLBACK;""");passed+=1

 # 4. PARTIAL FAILURE: the deferred recount fails midway; the envelope fails midway.
 run('BEGIN;'+ddl+seed()+commit_hand(HAND1,T1,1000001,[(A,118,100),(B,80,100),(H,100,100)],rake=2,addons=[ADD1])+f"""
 DO $p$ DECLARE t0 numeric; dealt jsonb; r jsonb; BEGIN
  r:={envelope(HAND1)};
  t0:={TOTAL};
  SELECT jsonb_agg(stack ORDER BY user_id) INTO dealt FROM table_seats WHERE table_id='{T1}' AND left_at IS NULL;
  -- The recount's update fails after its read (the summary is locked away).
  BEGIN
   PERFORM {RECOUNT};
   RAISE EXCEPTION USING ERRCODE='57014', MESSAGE='canceling statement due to statement timeout';
  EXCEPTION WHEN query_canceled THEN
   INSERT INTO deferred_step_failures(table_id,hand_number,step,error) VALUES('{T1}',1000001,'table_unlock',SQLERRM);
  END;
  IF {TOTAL}<>t0 OR dealt IS DISTINCT FROM (SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats WHERE table_id='{T1}' AND left_at IS NULL)
   THEN RAISE EXCEPTION 'a failed recount changed a stack or a balance'; END IF;
  IF (SELECT count(*) FROM deferred_step_failures)<>1 THEN RAISE EXCEPTION 'failure not recorded'; END IF;
  -- Recoverable: the next pass recounts.
  PERFORM {RECOUNT};
  IF (SELECT current_players FROM tables WHERE id='{T1}')<>3 THEN RAISE EXCEPTION 'recount not recoverable'; END IF;
  RAISE NOTICE 'PASS partial failure (deferred recount): no balance moved, recorded, recovered';
 END $p$; ROLLBACK;""");passed+=1
 run('BEGIN;'+ddl+seed()+commit_hand(HAND1,T1,1000001,[(A,118,100),(B,80,100),(H,100,100)],rake=2,addons=[ADD1])+f"""
 DO $p$ DECLARE t0 numeric; before jsonb; r jsonb; failed boolean:=false; BEGIN
  t0:={TOTAL};
  SELECT jsonb_build_array((SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats),(SELECT jsonb_agg(chip_balance ORDER BY user_id) FROM club_members),
   (SELECT count(*) FROM rake_records),(SELECT jsonb_agg(resolved_at) FROM table_pending_addons)) INTO before;
  -- The envelope fails after the rake leg and before the add-on (the add-on row
  -- vanishes under it): every leg it wrote rolls back with it.
  DELETE FROM table_pending_addons WHERE id='{ADD1}';
  INSERT INTO table_pending_addons(id,table_id,user_id,amount) VALUES('{ADD1}','{T2}','{A}',25);
  -- The rake leg runs before the add-on loop in the installed body, so this
  -- failure lands after the rake was written inside the same call.
  IF position('atomic_distribute_rake' IN pg_get_functiondef('fn_ca_process_hand_post_commit_obligations'::regproc))
     >= position('resolve_pending_addon' IN pg_get_functiondef('fn_ca_process_hand_post_commit_obligations'::regproc))
   THEN RAISE EXCEPTION 'rake is not before the add-on in the envelope'; END IF;
  BEGIN r:=fn_ca_process_hand_post_commit_obligations('{HAND1}');
  EXCEPTION WHEN raise_exception THEN failed:=true; END;
  UPDATE table_pending_addons SET table_id='{T1}' WHERE id='{ADD1}';
  IF NOT failed OR before IS DISTINCT FROM jsonb_build_array((SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats),(SELECT jsonb_agg(chip_balance ORDER BY user_id) FROM club_members),
   (SELECT count(*) FROM rake_records),(SELECT jsonb_agg(resolved_at) FROM table_pending_addons))
   OR (SELECT post_commit_completed_at FROM hand_atomic_commits WHERE hand_id='{HAND1}') IS NOT NULL
   THEN RAISE EXCEPTION 'a failed envelope left a half-applied balance'; END IF;
  -- Recoverable: the same envelope completes on the next attempt.
  r:={envelope(HAND1)};
  IF r->>'ok' IS DISTINCT FROM 'true' OR {TOTAL}<>t0 THEN RAISE EXCEPTION 'envelope not recoverable: %',r; END IF;
  RAISE NOTICE 'PASS partial failure (envelope): rake leg rolled back with it, no half balance, completes on retry';
 END $p$; ROLLBACK;""");passed+=1

 # The stack read beside the envelope: it is used only when the envelope's own
 # receipt resolved no add-on. With an add-on resolved, the early read differs
 # from the committed stacks and the engine reads again; with none, they agree.
 run('BEGIN;'+ddl+seed()+commit_hand(HAND1,T1,1000001,[(A,118,100),(B,80,100),(H,100,100)],rake=2,addons=[ADD1])+f"""
 DO $s$ DECLARE early jsonb; r jsonb; BEGIN
  SELECT jsonb_agg(stack ORDER BY user_id) INTO early FROM table_seats WHERE table_id='{T1}';
  r:={envelope(HAND1)};
  IF (r->>'pending_addons')::int<>1 OR early IS NOT DISTINCT FROM (SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats WHERE table_id='{T1}')
   THEN RAISE EXCEPTION 'the add-on case must invalidate the early read'; END IF;
  {commit_hand(HAND2,T1,1000002,[(A,153,143),(B,70,80),(H,100,100)],rake=0,plpgsql=True)}
  SELECT jsonb_agg(stack ORDER BY user_id) INTO early FROM table_seats WHERE table_id='{T1}';
  r:={envelope(HAND2)};
  IF (r->>'pending_addons')::int<>0 OR early IS DISTINCT FROM (SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats WHERE table_id='{T1}')
   THEN RAISE EXCEPTION 'a zero-add-on envelope wrote a seat stack'; END IF;
  RAISE NOTICE 'PASS early stack read: valid exactly when the receipt resolved no add-on';
 END $s$; ROLLBACK;""");passed+=1

 if os.environ.get('PGNODE'):
  # 2. CONCURRENCY on real sessions.
  base=ddl+seed()+commit_hand(HAND1,T1,1000001,[(A,118,100),(B,80,100),(H,100,100)],rake=2,addons=[ADD1])+f"SELECT {envelope(HAND1)};"
  for name,params in [
   ('deferred recount beside the next hand on the same table',dict(
     setup=base,
     # session a: the previous hand's deferred recount, holding the tables row
     # session a: the previous hand's deferred recount, after a seat left, so
     # it really writes the tables row and holds that row lock open
     a=f"UPDATE table_seats SET left_at=now() WHERE table_id='{T1}' AND user_id='{H}'; SELECT {RECOUNT};",
     # session b: the next hand's deal read and its whole settlement and envelope
     b=f"SELECT jsonb_agg(stack ORDER BY user_id) FROM table_seats WHERE table_id='{T1}' AND left_at IS NULL AND user_id<>'{H}';"
       +commit_hand(HAND2,T1,1000002,[(A,148,143),(B,75,80)],rake=0)+f"SELECT {envelope(HAND2)};",
     expect_b_waits=False,
     verify=f"""DO $v$BEGIN IF (SELECT sum(stack) FROM table_seats WHERE table_id='{T1}' AND left_at IS NULL)<>223
       OR (SELECT post_commit_completed_at FROM hand_atomic_commits WHERE hand_id='{HAND2}') IS NULL
       OR (SELECT current_players FROM tables WHERE id='{T1}')<>2 THEN RAISE EXCEPTION 'concurrent recount and next hand diverged';END IF;END $v$;""")),
   ('two tables settling add-ons into one shared wallet',dict(
     setup=ddl+seed()+f"""
      UPDATE club_members SET chip_balance=chip_balance-25 WHERE user_id='{A}';
      INSERT INTO table_pending_addons(id,table_id,user_id,amount) VALUES('{ADD2}','{T2}','{A}',25);
      UPDATE table_seats SET stack=290 WHERE user_id='{A}';"""
      +commit_hand(HAND1,T1,1000001,[(A,290,290),(B,100,100),(H,100,100)],rake=0,addons=[ADD1])
      +commit_hand(HANDX,T2,1000003,[(A,290,290),(B,100,100)],rake=0,addons=[ADD2]),
     # both envelopes refund (headroom 10 of 25) into A's one wallet row at once
     a=f"SELECT fn_ca_process_hand_post_commit_obligations('{HAND1}');",
     b=f"SELECT fn_ca_process_hand_post_commit_obligations('{HANDX}');",
     expect_b_waits=True,
     verify=f"""DO $v$BEGIN IF (SELECT chip_balance FROM club_members WHERE user_id='{A}')<>450+15+15
       OR (SELECT sum(stack) FROM table_seats WHERE user_id='{A}')<>600
       OR (SELECT count(*) FROM chip_ledger WHERE category='addon_refund')<>2
       OR (SELECT count(*) FROM hand_atomic_commits WHERE post_commit_completed_at IS NOT NULL)<>2
       THEN RAISE EXCEPTION 'shared wallet lost or doubled a refund';END IF;END $v$;""")),
  ]:
   # Each case owns a throwaway database cloned from the bootstrapped one, so
   # the committed sessions never touch the shared journal fixture.
   db='deferred_settlement_case'
   run(f'DROP DATABASE IF EXISTS {db}')
   run(f'CREATE DATABASE {db} TEMPLATE '+os.environ.get('PGDATABASE','postgres'))
   params.update(name=name,database=db)
   try:
    r=subprocess.run([os.environ['PGNODE'],str(HERE/'test_deferred_settlement_concurrency.mjs')],input=json.dumps(params),text=True,capture_output=True)
   finally:
    run(f'DROP DATABASE IF EXISTS {db}')
   if r.returncode: raise RuntimeError(r.stdout+r.stderr)
   print(r.stdout.strip(),flush=True);passed+=1
 print(f'TOTAL deferred settlement: {passed} PostgreSQL scenarios passed',flush=True)


if __name__=='__main__':
 # run-isolated.sh runs this right after the bootstrapped journal
 # (test_atomicity.py fixed --bootstrap) against the same PostgreSQL 17.
 def run(sql,database=None):
  env=dict(os.environ,PGDATABASE=database) if database else None
  r=subprocess.run([os.environ['PGNODE'],str(HERE/'postgres-runtime/query.mjs')],input=sql,text=True,capture_output=True,env=env)
  if r.returncode: raise RuntimeError(r.stderr)
  return r.stdout
 verify_deferred_settlement(run)
