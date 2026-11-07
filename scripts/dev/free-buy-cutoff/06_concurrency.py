#!/usr/bin/env python3
"""Concurrency proof for the Free Buy cutoff (20261106195136) and the five
Free Buy tickets (20261105223835), on the throwaway cluster that
scripts/dev/test-free-buy-cutoff-postgres.sh has just proved the cases on.

Owner rule (2026-11-06): closing registration funds each eligible first entry
exactly once, including retries and concurrent requests; five tickets per
player per gaming day; one ticket per player per event.

Every racing session first waits on a shared advisory lock that a holder
releases only once all of them are queued, so they start at the same instant.

  cutoff  eight sessions finalize one guaranteed (aiof, G 500) event and one
          non-guaranteed (regular) event at once: one cutoff leg each, promo
          funding exactly H = max(0, G - C) and V, no union bank overlay;
  tickets production's free_buy_ticket_redeem against the exact ticket tables
          of 20261105223835: seven events raced by one player use exactly five
          tickets; two registrations of one player into one event use one; the
          same registration replayed at once uses one.

Usage: 06_concurrency.py <psql> <socket dir> <port> <cutoff db>
"""
import json
import pathlib
import re
import subprocess
import sys
import time

PSQL, SOCKET, PORT, DB = sys.argv[1:5]
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
TICKETS_MIGRATION = ROOT / 'supabase/migrations/20261105223835_five_free_buy_tickets_a_day_for_every_player.sql'
BARRIER = 46_064


def base(db):
    return [PSQL, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', SOCKET, '-p', PORT, '-U', 'postgres', '-d', db]


def q(db, sql):
    r = subprocess.run(base(db), input=sql, text=True, capture_output=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def race(db, statements):
    """Run each statement in its own session, all released at the same moment.
    Returns (stdout, stderr, returncode) per statement."""
    holder = subprocess.Popen(base(db), stdin=subprocess.PIPE, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    holder.stdin.write(f'SELECT pg_advisory_lock({BARRIER});\n')
    holder.stdin.flush()
    time.sleep(0.5)
    workers = [subprocess.Popen(base(db), stdin=subprocess.PIPE, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
               for _ in statements]
    for w, s in zip(workers, statements):
        w.stdin.write(f'SELECT pg_advisory_lock_shared({BARRIER}); SELECT pg_advisory_unlock_shared({BARRIER});\n{s}\n')
        w.stdin.flush()  # communicate() closes it (Python 3.12 refuses a pre-closed stdin)
    deadline = time.time() + 20
    while time.time() < deadline:
        waiting = int(q(db, f"SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid={BARRIER} AND NOT granted"))
        if waiting >= len(statements):
            break
        time.sleep(0.1)
    else:
        raise RuntimeError('racing sessions never all reached the barrier')
    holder.stdin.write(f'SELECT pg_advisory_unlock({BARRIER});\n')
    holder.stdin.close()
    holder.wait(timeout=30)
    out = []
    for w in workers:
        o, e = w.communicate(timeout=120)
        out.append((o, e, w.returncode))
    return out


# ── cutoff: one leg per event under eight simultaneous finalizations ────────
ev = q(DB, """SELECT public.t_new('aiof', 500)||' '||public.t_new('regular', 0)""").split()
g, ng = ev
q(DB, f"""SELECT public.t_register('{g}', 120); SELECT public.t_register('{g}', 60, true);
          SELECT public.t_wallet('{g}', 37);
          SELECT public.t_register('{ng}', 120); SELECT public.t_register('{ng}', 60, true);
          SELECT public.t_wallet('{ng}', 25);""")
res = race(DB, [f"SELECT public.fn_apply_prize_guarantee('{e}', 'race-{i}');" for i in range(8) for e in (g, ng)])
failed = [e for o, e, rc in res if rc]
assert not failed, failed
for e, promo, pool in ((g, '463.00', '500.00'), (ng, '180.00', '205.00')):
    row = q(DB, f"""SELECT (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key='tourney:{e}:free_buy_cutoff_funding')
                     ||'|'||public.t_promo_net('{e}')||'|'||public.t_overlay('{e}')
                     ||'|'||(SELECT prize_pool FROM public.tournaments WHERE id='{e}')
                     ||'|'||(SELECT prize_pool_finalized FROM public.tournaments WHERE id='{e}')""")
    assert row == f'1|{promo}|0|{pool}|true', (e, row)
print('PASS concurrency cutoff: 16 simultaneous finalizations -> one cutoff leg each; '
      'G 500 C 37 promo 463 overlay 0 pool 500; no guarantee 180 entries C 25 promo 180 pool 205', flush=True)

# ── tickets: production's redeem against the exact ticket tables ────────────
q('postgres', 'DROP DATABASE IF EXISTS free_buy_tickets_race; CREATE DATABASE free_buy_tickets_race;')
T = 'free_buy_tickets_race'
mig = TICKETS_MIGRATION.read_text()
ddl = [re.search(p, mig, re.S).group(0) for p in (
    r'CREATE TABLE smarter_private\.free_buy_ticket_days \(.*?\n\);',
    r'CREATE TABLE smarter_private\.free_buy_ticket_redemptions \(.*?\n\);',
    r'CREATE UNIQUE INDEX free_buy_ticket_one_live_per_event\n.*?;')]
fixture = json.loads((HERE / 'ticket-functions.json').read_text())
pol = fixture['daily_window_policy']
q(T, f"""CREATE SCHEMA smarter_private;
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
    got = q(T, f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))")
    assert got == f['md5'], (f['signature'], got)


def event(n):
    tid = f'7a000000-0000-0000-0000-{n:012d}'
    q(T, f"""INSERT INTO public.tournaments VALUES ('{tid}','fade0000-0000-0000-0000-000000000001',
      'fade0000-0000-0000-0000-000000000001',true,'MTT',0,0,NULL,'freezeout',true,false,false,false,1,0,
      now() + interval '2 hours',NULL)""")
    return tid


def register(tid, user, n):
    rid = f'7b000000-0000-0000-{user[-4:]}-{n:012d}'
    q(T, f"INSERT INTO public.tournament_players VALUES ('{rid}','{tid}','{user}')")
    return rid


def redeem(tid, rid):
    return f"SELECT smarter_private.free_buy_ticket_redeem('{tid}','{rid}');"


def books(user):
    return q(T, f"""SELECT coalesce((SELECT sum(used) FROM smarter_private.free_buy_ticket_days WHERE user_id='{user}'),0)
                    ||'|'||(SELECT count(*) FROM smarter_private.free_buy_ticket_redemptions
                             WHERE user_id='{user}' AND returned_at IS NULL)""")


U = '7c000000-0000-0000-0000-00000000000a'
races = [(t, register(t, U, i)) for i, t in enumerate(event(i) for i in range(1, 8))]
res = race(T, [redeem(t, r) for t, r in races])
ok = sum(1 for o, e, rc in res if rc == 0)
used_up = sum(1 for o, e, rc in res if rc and 'FREE_BUY_TICKETS_USED_TODAY' in e)
assert (ok, used_up) == (5, 2), (ok, used_up, [e for o, e, rc in res if rc])
assert books(U) == '5|5', books(U)
print('PASS concurrency tickets: seven simultaneous first entries by one player -> five tickets used, two refused', flush=True)

# Production's unique (tournament_id, user_id) on tournament_players already
# refuses a second registration; the one-live-ticket index must hold on its own.
V = '7c000000-0000-0000-0000-00000000000b'
one = event(20)
res = race(T, [redeem(one, register(one, V, 1)), redeem(one, register(one, V, 2))])
ok = sum(1 for o, e, rc in res if rc == 0)
dup = sum(1 for o, e, rc in res if rc and 'FREE_BUY_TICKET_ALREADY_USED_FOR_EVENT' in e)
assert (ok, dup) == (1, 1), (ok, dup, [e for o, e, rc in res])
assert books(V) == '1|1', books(V)
print('PASS concurrency tickets: two simultaneous entries by one player into one event -> one ticket', flush=True)

W = '7c000000-0000-0000-0000-00000000000c'
two = event(21)
rid = register(two, W, 1)
res = race(T, [redeem(two, rid)] * 4)
assert books(W) == '1|1', (books(W), [e for o, e, rc in res if rc])
print('PASS concurrency tickets: the same entry replayed four times at once -> one ticket', flush=True)
