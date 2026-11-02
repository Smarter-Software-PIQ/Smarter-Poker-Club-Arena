#!/usr/bin/env python3
"""Actual horse purchase wrappers + actual transaction lock, disposable PG only.
Unchanged economic delegates are fixture sinks: no claim to requalify their money rules.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import select
import uuid

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
BASE = Path(os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP') or tempfile.gettempdir())
if __import__('sys').platform == 'darwin' and not str(BASE).startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('Use owned external SSD scratch')
ENV = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
MIGRATION = ROOT/'supabase/migrations/20261027062132_horse_future_tournament_purchase_budget.sql'
def uid(s): return str(uuid.uuid5(uuid.NAMESPACE_URL,'horse-future-purchase/'+s))
def main():
    checks=[]
    def check(label, ok):
        if not ok: raise AssertionError(label)
        checks.append(label)
    with tempfile.TemporaryDirectory(prefix='horse-future-',dir=BASE) as d:
        d=Path(d); sock=d/'s';sock.mkdir()
        def command(args): return subprocess.run([str(x) for x in args],env=ENV,text=True,capture_output=True,check=True).stdout
        command([PG/'initdb','-D',d/'db','-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
        command([PG/'pg_ctl','-D',d/'db','-l',d/'log','-o',f"-k {sock} -p 55479 -c listen_addresses='' -c shared_buffers=16MB -c max_connections=10",'-w','start'])
        psql=[str(PG/'psql'),'-X','-At','-v','ON_ERROR_STOP=1','-h',str(sock),'-p','55479','-U','postgres','-d','postgres']
        def run(q, failure=False):
            r=subprocess.run([*psql,'-c',q],env=ENV,text=True,capture_output=True,timeout=30)
            if r.returncode and not failure: raise AssertionError(r.stderr)
            return r.stderr if failure else r.stdout.strip()
        def call(label,seat=False,horse='horse'):
            return f"SELECT {'fn_seat_horse_in_seat_first_game' if seat else 'fn_register_horse_for_tournament'}('{uid(label)}','{uid(horse)}'"+(');' if seat else ',true);')
        def entry(label,horse='horse',status='registered'):
            return f"INSERT INTO tournament_players VALUES(gen_random_uuid(),'{uid(label)}','{uid(horse)}','{status}');"
        def reset(horse='horse',n=4):
            run(f"TRUNCATE tournament_players,table_seats,purchases,tickets,ticket_redemptions,ca_diamond_arena_owner_closure,ca_operator_floor_hold,ca_launch_operator_scopes; INSERT INTO profiles VALUES('{uid(horse)}',true) ON CONFLICT DO NOTHING;"+''.join(entry('old'+str(i),horse) for i in range(n)))
        try:
            run("""CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE SCHEMA extensions;
CREATE TABLE profiles(id uuid PRIMARY KEY,is_horse boolean);
CREATE TABLE tournaments(id uuid PRIMARY KEY,status text,start_time timestamptz,prize_pool_finalized boolean DEFAULT false,club_id uuid,union_id uuid,format_contract text DEFAULT 'mtt-v2');
CREATE TABLE tournament_players(id uuid PRIMARY KEY,tournament_id uuid,user_id uuid,status text);
CREATE TABLE tables(id uuid PRIMARY KEY,tournament_id uuid,status text DEFAULT 'running');
CREATE TABLE table_seats(id uuid PRIMARY KEY,table_id uuid,user_id uuid,left_at timestamptz);
CREATE TABLE ca_diamond_arena_owner_closure(club_id uuid PRIMARY KEY,operation_id uuid NOT NULL UNIQUE,closed boolean NOT NULL,reason text NOT NULL,requested_at timestamptz NOT NULL DEFAULT transaction_timestamp());
CREATE TABLE ca_operator_floor_hold(operation_id uuid,mode text);
CREATE TABLE ca_launch_operator_scopes(operation_id uuid,club_ids uuid[]);
CREATE TABLE tournament_launch_receipts(tournament_id uuid);
CREATE TABLE purchases(tournament_id uuid,user_id uuid);
CREATE TABLE tickets(tournament_id uuid,user_id uuid,corrupt boolean DEFAULT false);
CREATE TABLE ticket_redemptions(tournament_id uuid,user_id uuid);
CREATE FUNCTION fn_ca_lock_settlement_lane_for_tournament(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_ca_lock_mtt_admission_contract() RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_lock_daily_mission_user(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.frozen',true)='true'$$;
CREATE FUNCTION fn_lightning_pilot_assignment_blocks(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION fn_ca_entry_paying_club(uuid,uuid) RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
CREATE FUNCTION fn_tournament_primary_table(uuid) RETURNS uuid LANGUAGE sql AS $$SELECT id FROM tables WHERE tournament_id=$1 LIMIT 1$$;
CREATE FUNCTION fn_register_horse_for_tournament_before_terminal_gate(uuid,uuid,boolean) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
 IF EXISTS(SELECT 1 FROM tournament_players WHERE tournament_id=$1 AND user_id=$2 AND status IN ('registered','playing')) THEN RETURN '{"ok":true,"already_registered":true}'::jsonb;END IF;
 IF EXISTS(SELECT 1 FROM tournaments WHERE id=$1 AND prize_pool_finalized) THEN RETURN '{"ok":false,"reason":"registration_closed"}'::jsonb;END IF;
 IF EXISTS(SELECT 1 FROM tickets WHERE tournament_id=$1 AND user_id=$2 AND corrupt) THEN RAISE EXCEPTION 'corrupt ticket evidence' USING ERRCODE='P0404';END IF;
 IF EXISTS(SELECT 1 FROM tickets WHERE tournament_id=$1 AND user_id=$2) THEN
   DELETE FROM tickets WHERE tournament_id=$1 AND user_id=$2;
   INSERT INTO tournament_players VALUES(gen_random_uuid(),$1,$2,'registered');
   INSERT INTO ticket_redemptions VALUES($1,$2);RETURN '{"ok":true,"ticket":true}'::jsonb;
 END IF;
 IF $3 IS NOT TRUE THEN RETURN '{"ok":false,"reason":"hinted_tournament_ticket_no_longer_available"}'::jsonb;END IF;
 PERFORM pg_sleep(.05); INSERT INTO tournament_players VALUES(gen_random_uuid(),$1,$2,'registered');INSERT INTO purchases VALUES($1,$2);
 IF current_setting('test.purchase_failure',true)='true' THEN RAISE EXCEPTION 'purchase fixture interrupted';END IF;
 RETURN '{"ok":true}'::jsonb;END$$;
CREATE FUNCTION fn_seat_horse_in_seat_first_game_before_terminal_seat_gate(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;BEGIN
 IF EXISTS(SELECT 1 FROM table_seats WHERE user_id=$2 AND table_id=fn_tournament_primary_table($1) AND left_at IS NULL) THEN RETURN '{"ok":true,"already_seated":true}'::jsonb;END IF;
 r:=fn_register_horse_for_tournament($1,$2,true);IF (r->>'ok')::boolean IS NOT TRUE THEN RETURN r;END IF;
 IF NOT EXISTS(SELECT 1 FROM table_seats WHERE user_id=$2 AND table_id=fn_tournament_primary_table($1) AND left_at IS NULL) THEN INSERT INTO table_seats VALUES(gen_random_uuid(),fn_tournament_primary_table($1),$2,NULL);END IF;RETURN r;END$$;
""")
            run((ROOT/'tests/sql/fixtures/horse-future-purchase-lock.sql').read_text())
            check('captured acquisition gate matches the installed protected owner closure',
                  run("SELECT md5(pg_get_functiondef('fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure))")=='2622a05f060e54b18204205fc08bc7e9')
            run('REVOKE ALL ON FUNCTION fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role')
            run((ROOT/'tests/sql/fixtures/horse-future-purchase-before.sql').read_text())
            for sig in ['fn_register_horse_for_tournament(uuid,uuid,boolean)','fn_seat_horse_in_seat_first_game(uuid,uuid)']:
                run(f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION {sig} TO service_role;')
            labels=['old'+str(i) for i in range(6)]+['new','race-a','race-b','paid','target']
            for label in labels:
                run(f"INSERT INTO tournaments(id,status,start_time)VALUES('{uid(label)}','REGISTERING',now()+interval '3 hours');INSERT INTO tables(id,tournament_id)VALUES('{uid('table'+label)}','{uid(label)}');")
            reset(); check('actual preimage buys fifth far-future entry',json.loads(run(call('new')))['ok'])
            reset(); run(MIGRATION.read_text())
            for seat in [False,True]:
                reset();r=json.loads(run(call('new',seat)))
                check(('seat-first' if seat else 'MTT')+' new purchase refused at four',r.get('reason')=='horse_tournament_reservation_budget')
                check('refusal has no charge/roster/chair effect '+str(seat),run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)||\':\'||(SELECT count(*) FROM table_seats)')=='4:0:0')
            reset(n=3); check('third allows fourth',json.loads(run(call('new')))['ok'])
            check('fourth prevents fifth through other format',json.loads(run(call('race-a',True))).get('reason')=='horse_tournament_reservation_budget')
            reset();run(f"UPDATE tournament_players SET status='eliminated' WHERE tournament_id='{uid('old0')}';")
            check('busting releases choice budget',json.loads(run(call('new')))['ok'])
            reset();run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{uid('old0')}';")
            check('finished event releases choice budget',json.loads(run(call('new')))['ok'])
            run(f"UPDATE tournaments SET status='REGISTERING' WHERE id='{uid('old0')}';")
            reset(n=3);run(entry('old0'))
            check('same-event duplicate roster counted once',json.loads(run(call('new')))['ok'])
            reset();run(entry('paid'))
            check('existing paid target seats even above budget',json.loads(run(call('paid',True)))['ok'])
            check('paid seating buys no new entry',run('SELECT count(*) FROM purchases')=='0')
            check('paid replay stays idempotent',json.loads(run(call('paid',True)))['ok'] and run('SELECT count(*) FROM table_seats')=='1')
            reset(n=3)
            barrier=threading.Barrier(2)
            def contender(x):
                barrier.wait(timeout=5)
                return json.loads(run(call(x[0],x[1])))
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(contender,[('race-a',False),('race-b',True)]))
            check('cross-wrapper concurrent last slot buys exactly once',sum(r.get('ok') is True for r in results)==1 and sum(r.get('reason')=='horse_tournament_reservation_budget' for r in results)==1)
            check('race leaves four promises and one charge',run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)')=='4:1')
            reset();run(f"UPDATE tournaments SET status='COMPLETING' WHERE id='{uid('old0')}';")
            check('finished-play COMPLETING releases choice budget',json.loads(run(call('new')))['ok'])
            run(f"UPDATE tournaments SET status='REGISTERING' WHERE id='{uid('old0')}';")
            reset();run(f"UPDATE tables SET status='closed' WHERE tournament_id='{uid('new')}';INSERT INTO table_seats VALUES(gen_random_uuid(),'{uid('tablenew')}','{uid('horse')}',NULL);")
            check('closed historical target chair cannot bypass new budget',json.loads(run(call('new',True))).get('reason')=='horse_tournament_reservation_budget')
            run(f"UPDATE tables SET status='running' WHERE tournament_id='{uid('new')}';")
            check('direct registration cannot use bare chair as payment',json.loads(run(call('new'))).get('reason')=='horse_tournament_reservation_budget')
            check('live primary chair reaches only read-only replay',json.loads(run(call('new',True))).get('already_seated') is True and run('SELECT count(*) FROM purchases')=='0')
            reset();run(f"UPDATE tournaments SET status=NULL WHERE id='{uid('old0')}';")
            check('unknown event status cannot erase an outstanding promise',json.loads(run(call('new'))).get('reason')=='horse_tournament_reservation_budget')
            run(f"UPDATE tournaments SET status='CANCELLED' WHERE id='{uid('old0')}';")
            check('cancelled event releases choice budget',json.loads(run(call('new')))['ok'])
            run(f"UPDATE tournaments SET status='REGISTERING' WHERE id='{uid('old0')}';")
            reset(n=3);check('freeze precedes new choice guard',json.loads(run("SET test.frozen='true';"+call('new')).splitlines()[-1]).get('reason')=='platform_frozen')
            for sig in ['fn_register_horse_for_tournament(uuid,uuid,boolean)','fn_seat_horse_in_seat_first_game(uuid,uuid)']:
                check('service ACL preserved '+sig,run(f"SELECT proacl::text FROM pg_proc WHERE oid='{sig}'::regprocedure")=='{postgres=X/postgres,service_role=X/postgres}')
                check('public invocation remains denied '+sig,'permission denied' in run('SET ROLE anon;'+call('new',sig.startswith('fn_seat')),True))
            check('migration replay refuses drift','horse_future_purchase_preimage_changed' in run(MIGRATION.read_text(),True))
            # The two services' shortfall snapshots are outside the existing
            # purchase transaction. Its real gate serializes the calls, but
            # cannot enforce a target its three-argument API never received.
            reset(n=0)
            run(f"INSERT INTO profiles VALUES('{uid('target-a')}',true),('{uid('target-b')}',true) ON CONFLICT DO NOTHING")
            for horse in ['target-a','target-b']:
                check('RED ordinary pass commits its stale one-entry shortfall '+horse,
                      json.loads(run(call('target',horse=horse)))['ok'])
            check('RED separate one-entry passes overshoot target one',
                  run(f"SELECT count(*) FROM tournament_players WHERE tournament_id='{uid('target')}'")=='2')
            unchanged=run("SELECT md5(pg_get_functiondef('fn_register_horse_for_tournament(uuid,uuid,boolean)'::regprocedure))")
            target_migration=ROOT/'supabase/migrations/20261102153439_horse_attendance_targets_serialize_funded_registrations.sql'
            run(target_migration.read_text())
            check('target input does not rewrite the ordinary economic authority',
                  run("SELECT md5(pg_get_functiondef('fn_register_horse_for_tournament(uuid,uuid,boolean)'::regprocedure))")==unchanged)
            def target_call(horse,target='1',allow=True,label='target'):
                return f"SELECT fn_register_horse_for_tournament_to_target('{uid(label)}','{uid(horse)}',{str(allow).lower()},{target});"
            reset(n=0)
            barrier=threading.Barrier(2)
            def target_contender(horse):
                barrier.wait(timeout=5)
                return json.loads(run(target_call(horse)))
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(target_contender,['target-a','target-b']))
            check('GREEN competing passes buy only one entry at target one',
                  sum(r.get('ok') is True for r in results)==1 and
                  sum(r.get('reason')=='horse_attendance_target_met' for r in results)==1)
            check('target race commits one roster and one wallet delegate effect',
                  run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)')=='1:1')
            winner=['target-a','target-b'][next(i for i,r in enumerate(results) if r.get('ok') is True)]
            loser=({'target-a','target-b'}-{winner}).pop()
            check('lost-ACK paid replay succeeds even below the filled target',
                  json.loads(run(target_call(winner,'0'))).get('already_registered') is True)
            check('paid replay does not purchase twice',run('SELECT count(*) FROM purchases')=='1')
            run(f"INSERT INTO tickets(tournament_id,user_id) VALUES('{uid('target')}','{uid(loser)}')")
            check('a ticket issued after hints is honored at the target without wallet authority',
                  json.loads(run(target_call(loser,'0'))).get('ticket') is True)
            check('paid ticket remains separate from wallet purchases',
                  run('SELECT (SELECT count(*) FROM purchases)||\':\'||(SELECT count(*) FROM ticket_redemptions)')=='1:1')
            check('ticket receipt replay remains idempotent',
                  json.loads(run(target_call(loser,'0',False))).get('already_registered') is True and run('SELECT count(*) FROM ticket_redemptions')=='1')
            reset(n=0)
            for invalid in ['NULL','-1','9007199254740992']:
                check('invalid target cannot authorize a purchase '+invalid,
                      json.loads(run(target_call('target-a',invalid))).get('reason')=='invalid_horse_attendance_target')
            check('zero target does not fall back to a wallet charge',
                  json.loads(run(target_call('target-a','0'))).get('reason')=='horse_attendance_target_met')
            check('target input preserves maintenance freeze',
                  json.loads(run("SET test.frozen='true';"+target_call('target-a')).splitlines()[-1]).get('reason')=='platform_frozen')
            run(f"UPDATE tournaments SET club_id='{uid('closed-arena')}' WHERE id='{uid('target')}'")
            run(f"INSERT INTO ca_diamond_arena_owner_closure(club_id,operation_id,closed,reason) VALUES('{uid('closed-arena')}','{uid('closure-operation')}',true,'isolated owner closure input')")
            check('target input propagates the installed owner closure',
                  json.loads(run(target_call('target-a'))).get('reason')=='diamond_arena_closed')
            check('owner closure cannot create an entry or controlled charge',
                  run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)')=='0:0')
            run(entry('target','target-a'))
            check('existing paid entry replay survives the owner closure without a new charge',
                  json.loads(run(target_call('target-a','0'))).get('already_registered') is True and
                  run('SELECT count(*) FROM purchases')=='0')
            reset(n=0)
            run(f"INSERT INTO ca_operator_floor_hold VALUES('{uid('park-operation')}','park'); INSERT INTO ca_launch_operator_scopes VALUES('{uid('park-operation')}',ARRAY['{uid('closed-arena')}']::uuid[])")
            check('target input retains an existing operator park without a purchase',
                  json.loads(run(target_call('target-a'))).get('reason')=='operator_floor_parked' and
                  run('SELECT count(*) FROM purchases')=='0')
            reset(n=0)
            run(f"UPDATE tournaments SET prize_pool_finalized=true WHERE id='{uid('target')}'")
            check('the existing closed-pool decision remains authoritative',
                  json.loads(run(target_call('target-a'))).get('reason')=='registration_closed')
            run(f"UPDATE tournaments SET prize_pool_finalized=false,format_contract='sng-v1' WHERE id='{uid('target')}'")
            check('target input never becomes a bought-seat shortcut',
                  json.loads(run(target_call('target-a'))).get('reason')=='horse_attendance_target_requires_mtt')
            run(f"UPDATE tournaments SET format_contract='mtt-v2' WHERE id='{uid('target')}'")
            check('interrupted economic delegate error propagates',
                  'purchase fixture interrupted' in run("SET test.purchase_failure='true';"+target_call('target-a'),True))
            check('interruption rolls back entry and controlled charge together',
                  run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)')=='0:0')
            run(f"INSERT INTO tickets VALUES('{uid('target')}','{uid('target-a')}',true)")
            check('corrupt ticket at quota is not hidden as a filled target',
                  'corrupt ticket evidence' in run(target_call('target-a','0'),True))
            check('ticket refusal leaves all controlled effects unchanged',
                  run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)||\':\'||(SELECT count(*) FROM tickets)')=='0:0:1')
            sig='fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)'
            check('target authority is service-only',run(f"SELECT proacl::text FROM pg_proc WHERE oid='{sig}'::regprocedure")=='{postgres=X/postgres,service_role=X/postgres}')
            for role in ['anon','authenticated']:
                check('target input denies '+role,'permission denied' in run('SET ROLE '+role+';'+target_call('target-a'),True))
            check('target migration cannot silently replace an installed authority',
                  'already exists' in run(target_migration.read_text(),True))
            reset(n=0)
            bulk_horses=['target-bulk-'+str(i) for i in range(80)]
            run('INSERT INTO profiles VALUES '+','.join(f"('{uid(h)}',true)" for h in bulk_horses))
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                bulk=list(pool.map(lambda h:json.loads(run(target_call(h,'31'))),bulk_horses))
            check('eighty overlapping inputs stop exactly at the 31-entry target',
                  sum(r.get('ok') is True for r in bulk)==31 and
                  sum(r.get('reason')=='horse_attendance_target_met' for r in bulk)==49)
            check('large input batch has no duplicate entries or extra controlled charges',
                  run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(DISTINCT user_id) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)')=='31:31:31')
            reset(n=0)
            holder=subprocess.Popen(psql,env=ENV,text=True,stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            assert holder.stdin and holder.stdout
            holder.stdin.write(f"BEGIN;SELECT id FROM tournaments WHERE id='{uid('target')}' FOR UPDATE;SELECT 'target_lock_held';\n")
            holder.stdin.flush()
            held_output=b''
            try:
                deadline=time.monotonic()+5
                while b'target_lock_held' not in held_output:
                    ready,_,_=select.select([holder.stdout],[],[],max(0,deadline-time.monotonic()))
                    if not ready:raise AssertionError('cutoff holder readiness timeout')
                    chunk=os.read(holder.stdout.fileno(),4096)
                    if not chunk:raise AssertionError('cutoff holder exited early')
                    held_output+=chunk
            except BaseException:
                holder.kill();holder.wait(timeout=5)
                raise
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                waiting=pool.submit(run,"SET application_name='horse_target_close_race';"+target_call('target-a'))
                try:
                    deadline=time.monotonic()+5
                    blocked=False
                    while time.monotonic()<deadline:
                        if run("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='horse_target_close_race' AND wait_event_type='Lock')")=='t':
                            blocked=True;break
                        time.sleep(.02)
                finally:
                    holder.stdin.write(f"UPDATE tournaments SET prize_pool_finalized=true WHERE id='{uid('target')}';COMMIT;\n")
                    holder.stdin.close()
                    holder.wait(timeout=5)
                result=json.loads(waiting.result(timeout=5).splitlines()[-1])
            check('cutoff race actually waits on the existing tournament acquisition lock',blocked)
            check('close committed before admission leaves no charged entry',
                  result.get('reason')=='registration_closed' and
                  run('SELECT (SELECT count(*) FROM tournament_players)||\':\'||(SELECT count(*) FROM purchases)')=='0:0')
            run(f"UPDATE tournaments SET prize_pool_finalized=false WHERE id='{uid('target')}'")
            run(f"UPDATE tournaments SET status='COMPLETED' WHERE id='{uid('target')}'")
            check('completed target status propagates the actual gate refusal without a purchase',
                  json.loads(run(target_call('target-a'))).get('reason')=='tournament_not_seatable' and
                  run('SELECT count(*) FROM purchases')=='0')
            run(f"DELETE FROM tournaments WHERE id='{uid('target')}'")
            check('deleted target propagates the actual gate refusal without a purchase',
                  json.loads(run(target_call('target-a'))).get('reason')=='tournament_not_found' and
                  run('SELECT count(*) FROM purchases')=='0')
            # Representative shared-fleet day: 1,000 accounts already holding
            # two legitimate promises compete across eight different targets.
            # The real acquisition lock/cap wrapper remains authoritative;
            # financial delegates are still controlled sinks, not a benchmark.
            reset(n=0)
            busy_horses=['busy-day-'+str(i) for i in range(1000)]
            busy_ids=','.join("'"+uid(h)+"'" for h in busy_horses)
            run('INSERT INTO profiles VALUES '+','.join(f"('{uid(h)}',true)" for h in busy_horses))
            run(f"UPDATE tournaments SET status='REGISTERING' WHERE id IN ('{uid('old0')}','{uid('old1')}')")
            run(f"INSERT INTO tournament_players SELECT gen_random_uuid(),t.id,h.id,'registered' FROM profiles h CROSS JOIN tournaments t WHERE h.id IN ({busy_ids}) AND t.id IN ('{uid('old0')}','{uid('old1')}')")
            busy_targets={f'busy-event-{i}':n for i,n in enumerate([313,143,127,91,80,69,53,41])}
            for label in busy_targets:
                run(f"INSERT INTO tournaments(id,status,start_time) VALUES('{uid(label)}','REGISTERING',now()+interval '3 hours')")
            def busy_event(item):
                label,target=item
                ordered=sorted(busy_horses,key=lambda h:hashlib.sha256(
                    f"{uid(label)}:horse-candidates-v1:0:{uid(h)}".encode()).hexdigest())
                chosen=[];refused=0;deadline=time.monotonic()+120
                for horse in ordered:
                    if time.monotonic()>=deadline:raise AssertionError('busy-day admission deadline')
                    answer=json.loads(run(target_call(horse,str(target),label=label)))
                    if answer.get('ok') is True:
                        chosen.append(horse)
                        if len(chosen)==target:break
                    elif answer.get('reason')=='horse_tournament_reservation_budget':refused+=1
                    else:raise AssertionError('unexpected shared-fleet admission: '+str(answer))
                return label,chosen,refused
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                busy=list(pool.map(busy_event,busy_targets.items()))
            check('one thousand shared accounts reach eight independent varied event targets',
                  all(len(chosen)==busy_targets[label] for label,chosen,_ in busy))
            event_ids=','.join("'"+uid(label)+"'" for label in busy_targets)
            actual_fields=json.loads(run(f"SELECT json_object_agg(tournament_id,n) FROM (SELECT tournament_id,count(*)n FROM tournament_players WHERE tournament_id IN ({event_ids}) GROUP BY tournament_id)s"))
            check('each persisted busy-day field independently matches its own target',
                  actual_fields=={uid(label):n for label,n in busy_targets.items()})
            check('shared-fleet run actually exercises cross-event capacity refusals',
                  sum(refused for _,_,refused in busy)>0)
            actual=json.loads(run("SELECT json_build_object("+
                "'entries',(SELECT count(*) FROM tournament_players),"+
                "'charges',(SELECT count(*) FROM purchases),"+
                "'unique_charges',(SELECT count(DISTINCT (tournament_id,user_id)) FROM purchases),"+
                "'min_load',(SELECT min(n) FROM (SELECT count(DISTINCT tournament_id)n FROM tournament_players GROUP BY user_id)s),"+
                "'max_load',(SELECT max(n) FROM (SELECT count(DISTINCT tournament_id)n FROM tournament_players GROUP BY user_id)s))"))
            check('shared-fleet promises and controlled charges commit exactly once with no fifth game',
                  actual=={'entries':2000+sum(busy_targets.values()),'charges':sum(busy_targets.values()),
                           'unique_charges':sum(busy_targets.values()),'min_load':2,'max_load':4})
            for label,chosen,_ in busy:
                replay=json.loads(run(target_call(chosen[0],'0',label=label)))
                if replay.get('already_registered') is not True:raise AssertionError('durable shared-fleet replay lost original entry')
            check('fresh connections recover original shared-fleet entries without another charge',
                  run('SELECT count(*) FROM purchases')==str(sum(busy_targets.values())))
            print(json.dumps({'passed':len(checks),'checks':checks,'busy_day':{'accounts':len(busy_horses),'events':len(busy_targets),'targets':busy_targets,'controlled_charges':actual['charges'],'max_promises':actual['max_load'],'capacity_refusals':sum(refused for _,_,refused in busy)},'scope':'actual wrappers and actual cap lock; controlled unchanged economic delegate sinks'}))
        finally: command([PG/'pg_ctl','-D',d/'db','-m','immediate','-w','stop'])
    # Qualify the same purchase wrapper's timing migration after this cluster
    # stops; failures propagate through the existing required accounting owner.
    subprocess.run([
        sys.executable, '-B', str(ROOT/'scripts/ci/test-horse-registration-timing.py'),
    ], cwd=ROOT, env={**ENV, 'PG_BIN':str(PG), 'TMPDIR':str(BASE)}, check=True, timeout=120)
if __name__=='__main__':main()
