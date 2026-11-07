#!/usr/bin/env python3
"""Native proof for 20261107043307: a player reads the Free Buy tickets an
event will use, on the throwaway cluster scripts/dev/test-free-buy-cutoff-postgres.sh
started, over production's fn_ca_midway_free_buy_format, free_buy_gaming_day
and free_buy_ticket_redeem (ticket-functions.json, md5-checked) and the exact
ticket tables of 20261105223835.

  * a Midway Free Buy starting on a LATER gaming day reads that day's book,
    not today's: four tickets used tomorrow, none today, reads 1 of 5 left
    tomorrow and today=false; today's event reads 5 of 5 and today=true;
  * the count follows production's own redeem: one more entry tomorrow reads
    0 left, and the sixth entry is refused with FREE_BUY_TICKETS_USED_TODAY;
  * used_here is true only on the event the caller holds a live ticket on,
    and only for that caller; a returned ticket is not counted;
  * a paid event reads applies=false; an anonymous caller and an unknown
    event read NULL; anon cannot execute it, authenticated can;
  * it writes nothing.

Usage: 07_tickets_for_event.py <psql> <socket dir> <port>
"""
import json
import pathlib
import re
import subprocess
import sys

PSQL, SOCKET, PORT = sys.argv[1:4]
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
TICKETS_MIGRATION = ROOT / 'supabase/migrations/20261105223835_five_free_buy_tickets_a_day_for_every_player.sql'
MIG = ROOT / 'supabase/migrations/20261107043307_a_player_reads_the_free_buy_tickets_an_event_will_use.sql'
DB = 'free_buy_tickets_for_event'


def q(sql, db=DB):
    r = subprocess.run([PSQL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', SOCKET, '-p', PORT,
                        '-U', 'postgres', '-d', db], input=sql, text=True, capture_output=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def must_fail(sql, needle):
    try:
        q(sql)
    except RuntimeError as e:
        assert needle in str(e), str(e)
        return
    raise AssertionError(f'expected a refusal containing {needle!r}')


q(f'DROP DATABASE IF EXISTS {DB}; CREATE DATABASE {DB};', 'postgres')
q("DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;", 'postgres')
mig = TICKETS_MIGRATION.read_text()
ddl = [re.search(p, mig, re.S).group(0) for p in (
    r'CREATE TABLE smarter_private\.free_buy_ticket_days \(.*?\n\);',
    r'CREATE TABLE smarter_private\.free_buy_ticket_redemptions \(.*?\n\);',
    r'CREATE UNIQUE INDEX free_buy_ticket_one_live_per_event\n.*?;')]
fixture = json.loads((HERE / 'ticket-functions.json').read_text())
pol = fixture['daily_window_policy']
q(f"""CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO PUBLIC;
  CREATE TABLE public.tournaments (id uuid PRIMARY KEY, union_id uuid, club_id uuid, free_buy boolean,
    tournament_type text, buy_in_amount numeric, buy_in_fee numeric, satellite_target_id uuid, variant text,
    is_pko boolean, is_mystery_bounty boolean, is_bounty boolean, all_in_or_fold boolean, bounty_amount numeric,
    guaranteed_prize numeric, start_time timestamptz, started_at timestamptz);
  CREATE TABLE public.tournament_players (id uuid PRIMARY KEY, tournament_id uuid, user_id uuid);
  CREATE TABLE smarter_private.daily_window_policy (singleton boolean, time_zone text, window_end time);
  INSERT INTO smarter_private.daily_window_policy VALUES ({pol['singleton']}, '{pol['time_zone']}', '{pol['window_end']}');
  {chr(10).join(ddl)}
  SET check_function_bodies = off;
  {chr(10).join(f['definition'] + ';' for f in fixture['functions'])}""".replace('REVOKE', '-- REVOKE'))
for f in fixture['functions']:
    got = q(f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))")
    assert got == f['md5'], (f['signature'], got)
q(MIG.read_text())
print('PASS tickets for event: production definitions at their md5; the exact migration installed', flush=True)

U = '7c000000-0000-0000-0000-0000000000a1'
V = '7c000000-0000-0000-0000-0000000000b2'
MIDWAY = 'fade0000-0000-0000-0000-000000000001'
# Gaming days turn at 06:00 Chicago; noon Chicago is safely inside one.
TODAY = "((smarter_private.free_buy_gaming_day(clock_timestamp()) + time '12:00') AT TIME ZONE 'America/Chicago')"
TOMORROW = f"({TODAY} + interval '1 day')"


def event(n, at, paid=False):
    tid = f'7a000000-0000-0000-0000-{n:012d}'
    q(f"""INSERT INTO public.tournaments VALUES ('{tid}','{MIDWAY}','{MIDWAY}',{str(not paid).lower()},'MTT',
      {5 if paid else 0},0,NULL,'freezeout',true,false,false,false,1,0,{at},NULL)""")
    return tid


def enter(tid, user, n):
    rid = f'7b000000-0000-0000-{user[-4:]}-{n:012d}'
    q(f"""INSERT INTO public.tournament_players VALUES ('{rid}','{tid}','{user}');
          SELECT smarter_private.free_buy_ticket_redeem('{tid}','{rid}');""")
    return rid


def read(tid, user=U):
    out = q(f"""SET ROLE authenticated; SET request.jwt.claim.sub = '{user or ''}';
                SELECT coalesce(public.fn_ca_free_buy_tickets_for_event('{tid}')::text, 'null');""")
    return json.loads(out)


today_ev = event(1, TODAY)
later = [event(10 + i, TOMORROW) for i in range(6)]
for i in range(4):
    enter(later[i], U, i)
r = read(later[5])
assert (r['applies'], r['today'], r['allotment'], r['used'], r['remaining'], r['used_here']) == (True, False, 5, 4, 1, False), r
r = read(today_ev)
assert (r['applies'], r['today'], r['used'], r['remaining']) == (True, True, 0, 5), r
print("PASS tickets for event: tomorrow's event reads tomorrow's book (4 used, 1 left, today=false); today's reads 5 of 5", flush=True)

enter(later[4], U, 4)
assert read(later[5])['remaining'] == 0
q(f"INSERT INTO public.tournament_players VALUES ('7b000000-0000-0000-00a1-000000000099','{later[5]}','{U}')")
must_fail(f"SELECT smarter_private.free_buy_ticket_redeem('{later[5]}','7b000000-0000-0000-00a1-000000000099')",
          'FREE_BUY_TICKETS_USED_TODAY')
print('PASS tickets for event: the count follows production redeem; at 0 left the next entry is refused', flush=True)

assert read(later[0])['used_here'] is True and read(later[5])['used_here'] is False
assert read(later[0], V)['used_here'] is False and read(later[0], V)['remaining'] == 5
q(f"UPDATE smarter_private.free_buy_ticket_redemptions SET returned_at = clock_timestamp() WHERE tournament_id = '{later[0]}'")
assert read(later[0])['used_here'] is False
print('PASS tickets for event: used_here is the caller\'s live ticket on that event only; a returned ticket is not counted', flush=True)

paid = event(30, TOMORROW, paid=True)
assert read(paid) == {'applies': False}, read(paid)
assert read(today_ev, None) is None
assert read('7a000000-0000-0000-0000-00000000dead') is None
must_fail(f"SET ROLE anon; SELECT public.fn_ca_free_buy_tickets_for_event('{today_ev}')", 'permission denied')
before = q("SELECT count(*)||'|'||coalesce(sum(used),0) FROM smarter_private.free_buy_ticket_days")
for _ in range(3):
    read(later[5])
assert q("SELECT count(*)||'|'||coalesce(sum(used),0) FROM smarter_private.free_buy_ticket_days") == before
must_fail(MIG.read_text(), 'already exists')
print('PASS tickets for event: a paid event reads applies=false; anonymous and unknown read null; anon is refused; '
      'it writes nothing; a second install is refused', flush=True)
