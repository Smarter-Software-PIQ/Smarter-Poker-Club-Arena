#!/usr/bin/env python3
"""A held seat is refused to anyone but its invited holder, on a real cluster.

Installs, UNCHANGED from supabase/migrations, the Heads Up hold migration
(20261122025900), the private game hold rule (20261123013126) and the window
migration that attaches its entry guard (20261123013136), over the stand-in
doors in scripts/ci/fixtures/private-game-holds/bootstrap.sql. Then, as real
authenticated sessions:

  * Invite To Game from outside a Heads Up that already holds a horse opens a
    PRIVATE copy of the same board and buys the inviter in once;
  * a stranger and a horse are both refused the held seat by the same line,
    and the refused purchase charges nothing;
  * the invited friend is admitted by the token and seated, and the hold ends;
  * a seat held in a shared Spin keeps only the held seat;
  * the hold expires, is thawed by every frozen second, ends when the inviter
    leaves, and is released by Cancel - each time the game is ordinary again;
  * a failed inviter buy-in leaves no game, no hold and no charge;
  * Specific Player at an empty Heads Up is the same hold;
  * removing the trigger lets the stranger in: the trigger is the cause.

Usage: python3 scripts/ci/test-private-game-holds-postgres.py [--pg-bin DIR]
"""
import json, os, shutil, subprocess, sys, tempfile, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
args = sys.argv[1:]
PG = Path(args[args.index('--pg-bin') + 1]) if '--pg-bin' in args else Path(
    os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
MIG = ROOT / 'supabase/migrations'
FILES = [
    MIG / '20261122025900_heads_up_wait_mode_and_invite_hold.sql',
    MIG / '20261123013126_a_private_game_holds_its_seats_for_invited_friends.sql',
    MIG / '20261123013136_a_held_seat_is_refused_to_anyone_but_its_invited_holder.sql',
]
BOOT = ROOT / 'scripts/ci/fixtures/private-game-holds/bootstrap.sql'
CLUB = '00000000-0000-4000-8000-0000000000c1'

cluster = Path(tempfile.mkdtemp(prefix='private-holds-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='private-holds-sock-', dir='/tmp'))
env = {'PATH': str(PG) + ':/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
started = False
passed = 0


def run(argv, sql=None, check=True):
    r = subprocess.run([str(a) for a in argv], input=sql, text=True, capture_output=True, env=env, timeout=120)
    if check and r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r


def psql(sql, actor=None, role='authenticated', check=True):
    pre = ''
    if actor:
        pre = (f"SET request.jwt.claim.sub='{actor}';\nSET request.jwt.claim.role='{role}';\n"
               f"SET ROLE {role};\n")
    r = run([PG / 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', 'postgres', '-d', 'postgres'],
            pre + sql, check=check)
    return r


def q(sql, actor=None, role='authenticated'):
    return psql(sql, actor, role).stdout.strip()


def j(sql, actor=None, role='authenticated'):
    return json.loads(q(sql, actor, role).splitlines()[-1])


def ok(cond, label):
    global passed
    if not cond:
        raise AssertionError(label)
    passed += 1
    print('PASS', label, flush=True)


def refused(sql, actor, role='authenticated'):
    r = psql(sql, actor, role, check=False)
    return r.returncode != 0 and 'PRIVATE_GAME_SEAT_HELD' in (r.stderr + r.stdout)


def person(balance=100, horse=False):
    uid = str(uuid.uuid4())
    q(f"INSERT INTO public.profiles VALUES ('{uid}', 'u{uid[:6]}', 'Player {uid[:4]}', {str(horse).lower()});"
      f"INSERT INTO public.wallets_fixture VALUES ('{uid}', {balance});")
    return uid


def board(seats, variant):
    tid = str(uuid.uuid4())
    ttype = 'SPIN' if variant == 'spin' else 'SNG'
    q(f"""INSERT INTO public.tournaments (id, club_id, name, game_type, variant, tournament_type, buy_in_amount, buy_in_fee,
            guaranteed_prize, starting_chips, max_players, min_players, table_size, current_players, status, blind_structure,
            payout_structure, start_time, late_reg_levels, late_reg_mins, format_contract)
          VALUES ('{tid}', '{CLUB}', 'NLH Board {seats}', 'nlh', '{variant}', '{ttype}', 9, 1, 0, 1000, {seats}, {seats},
            {seats}, 0, 'REGISTERING', '[{{"level":1,"smallBlind":10,"bigBlind":20}}]', '[100]',
            now() + interval '3 hours', 0, 0, 'sng-v1');
          INSERT INTO public.tables (tournament_id, max_players) VALUES ('{tid}', {seats});""")
    return tid


def table_of(tid):
    return q(f"SELECT public.fn_tournament_primary_table('{tid}')")


def balance(uid):
    return float(q(f"SELECT balance FROM public.wallets_fixture WHERE user_id='{uid}'"))


def horse_seat(tid, horse):
    return f"SELECT public.fn_seat_horse_in_seat_first_game('{tid}', '{horse}');"


try:
    run([PG / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '-A', 'trust'])
    run([PG / 'pg_ctl', '-D', cluster / 'data', '-o', f'-k {sock} -c listen_addresses=', '-l', cluster / 'log', '-w', 'start'])
    started = True
    q(BOOT.read_text())
    for f in FILES:
        q(f.read_text())
    ok(q("SELECT count(*) FROM pg_trigger WHERE tgname='trg_private_game_entry_guard'") == '1',
       'the three migrations install unchanged and attach the entry guard')

    inviter, friend, stranger, friend2 = person(), person(), person(), person()
    horse, horse2 = person(horse=True), person(horse=True)

    # ── 1. Invite To Game from outside a Heads Up that holds a horse ──────────
    hu = board(2, 'sng')
    q(horse_seat(hu, horse))
    res = j(f"SELECT public.fn_invite_to_private_game('{hu}', 1)", inviter)
    ok(res['ok'] and res['created'] and res['tournament_id'] != hu and res['exclusive'] and res['live'],
       'an inviter outside the game gets a private copy of the same board')
    priv, priv_table, token = res['tournament_id'], res['table_id'], res['invite_token']
    ok(q(f"SELECT name || '|' || max_players || '|' || buy_in_amount || '|' || club_id FROM public.tournaments WHERE id='{priv}'")
       == q(f"SELECT name || '|' || max_players || '|' || buy_in_amount || '|' || club_id FROM public.tournaments WHERE id='{hu}'"),
       'the copy is the same board: name, seats, stake and club')
    ok(balance(inviter) == 90.0, 'the inviter is charged exactly one buy-in, through the normal seat door')
    ok(q(f"SELECT count(*) FROM public.tournament_players WHERE tournament_id='{priv}'") == '1',
       'the copy holds only its inviter; the horse stayed at the public board')
    ok(q(f"SELECT wait_mode || '|' || (invite_token = '{token}') FROM public.heads_up_wait_holds WHERE tournament_id='{priv}'")
       == 'specific_player|true', 'older engines see the same hold through heads_up_wait_holds')
    again = j(f"SELECT public.fn_invite_to_private_game('{priv}', 1)", inviter)
    ok(again['ok'] and again['invite_token'] == token and balance(inviter) == 90.0,
       'asking again from the private game returns the same hold and charges nothing')

    # ── 2. A stranger and a horse are refused by the same line ───────────────
    ok(refused(f"SELECT public.fn_take_seat_and_buy_in('{priv_table}', 2)", stranger),
       'a person without the invite cannot take the held seat')
    ok(balance(stranger) == 100.0, 'the refused purchase charged nothing')
    ok(refused(horse_seat(priv, horse2), None, 'postgres'),
       'a horse cannot take the held seat either: the same rule, no horse branch')
    deny = j(f"SELECT public.fn_accept_private_game_invite('{priv}', NULL)", stranger)
    ok(deny['allowed'] is False and deny['reason'] == 'private_game_seat_held',
       'the door answers a stranger with the rule before any money moves')
    state = j(f"SELECT public.fn_private_game_hold_state('{priv}', NULL)", stranger)
    ok('invite_token' not in state and state.get('inviter_name') is None,
       'a stranger is told neither the token nor who holds the seat')

    # ── 3. The friend is admitted by the token and seated ────────────────────
    acc = j(f"SELECT public.fn_accept_private_game_invite('{priv}', '{token}')", friend)
    ok(acc['allowed'] and acc['admitted'] and acc['table_id'] == priv_table, 'the token admits the invited friend')
    full = j(f"SELECT public.fn_accept_private_game_invite('{priv}', '{token}')", friend2)
    ok(full['allowed'] is False and full['reason'] == 'private_game_full',
       'a Heads Up holds one seat: a second token holder is not admitted')
    seat = j(f"SELECT public.fn_take_seat_and_buy_in('{priv_table}', 2)", friend)
    ok(seat['ok'] and balance(friend) == 90.0, 'the admitted friend buys the held seat through the normal door, once')
    view = j(f"SELECT public.fn_private_game_hold_view('{priv}')", None, 'postgres')
    ok(view['outcome'] == 'fulfilled' and view['live'] is False, 'the hold ends the moment the friend is seated')

    # ── 4. A seat held in a shared Spin keeps only the held seat ─────────────
    spin = board(3, 'spin')
    q(f"SELECT public.fn_take_seat_and_buy_in('{table_of(spin)}', 1)", inviter)
    q(horse_seat(spin, horse))
    held = j(f"SELECT public.fn_invite_to_private_game('{spin}', 2)", inviter)
    ok(held['ok'] and not held['created'] and held['exclusive'] is False and held['seats_held'] == 1,
       'a Spin with a horse already seated holds its one open seat in place')
    ok(refused(f"SELECT public.fn_take_seat_and_buy_in('{table_of(spin)}', 3)", stranger),
       'the last seat of the shared Spin is refused to a stranger while held')
    j(f"SELECT public.fn_accept_private_game_invite('{spin}', '{held['invite_token']}')", friend)
    ok(j(f"SELECT public.fn_take_seat_and_buy_in('{table_of(spin)}', 3)", friend)['ok'],
       'and taken by the invited friend')

    # ── 5. Expiry, the freeze credit, the inviter leaving, Cancel ────────────
    def fresh_private(seats=2, variant='sng'):
        src = board(seats, variant)
        r = j(f"SELECT public.fn_invite_to_private_game('{src}', 1)", inviter)
        q(f"UPDATE public.wallets_fixture SET balance = 100 WHERE user_id = '{inviter}'")
        return r['tournament_id'], r['table_id']

    def age_hold(tid, minutes):
        q(f"UPDATE public.private_game_holds SET hold_started_at = now() - interval '{minutes} minutes',"
          f" hold_expires_at = now() - interval '{minutes} minutes' + make_interval(secs => hold_seconds)"
          f" WHERE tournament_id = '{tid}'")

    p2, t2 = fresh_private()
    age_hold(p2, 11)
    ok(j(f"SELECT public.fn_private_game_hold_view('{p2}')", None, 'postgres')['outcome'] == 'expired',
       'after ten open minutes the hold expires')
    ok(j(f"SELECT public.fn_take_seat_and_buy_in('{t2}', 2)", stranger)['ok'],
       'an expired hold is an ordinary board again: anyone may sit')

    p3, t3 = fresh_private()
    age_hold(p3, 12)
    q(f"INSERT INTO public.engine_maintenance_thaws VALUES (now() - interval '6 minutes', 300)")
    v3 = j(f"SELECT public.fn_private_game_hold_view('{p3}')", None, 'postgres')
    ok(v3['live'] is True, 'every frozen second the thaw recorded is given back to the hold')
    ok(refused(f"SELECT public.fn_take_seat_and_buy_in('{t3}', 2)", stranger),
       'so a five-minute cutover never hands the friend\'s seat to someone else')
    q("DELETE FROM public.engine_maintenance_thaws")

    p4, t4 = fresh_private()
    age_hold(p4, 9)
    q("INSERT INTO public.engine_maintenance_break (phase, announced_at, break_started_at)"
      " VALUES ('counting_down', now() - interval '3 minutes', now() - interval '3 minutes')")
    ok(j(f"SELECT public.fn_private_game_hold_view('{p4}')", None, 'postgres')['live'] is True,
       'while a break is in progress the hold\'s clock stands still')
    q("DELETE FROM public.engine_maintenance_break")

    p5, t5 = fresh_private()
    q(f"DELETE FROM public.tournament_players WHERE tournament_id = '{p5}' AND user_id = '{inviter}';"
      f"UPDATE public.table_seats SET left_at = now() WHERE table_id = '{t5}' AND user_id = '{inviter}'")
    ok(j(f"SELECT public.fn_private_game_hold_view('{p5}')", None, 'postgres')['outcome'] == 'creator_left',
       'a hold ends when its inviter leaves')
    ok(j(f"SELECT public.fn_take_seat_and_buy_in('{t5}', 2)", stranger)['ok'], 'and the game is open to anyone')

    p6, t6 = fresh_private()
    c = j(f"SELECT public.fn_cancel_private_game_hold('{p6}')", inviter)
    ok(c['ok'] and j(f"SELECT public.fn_private_game_hold_view('{p6}')", None, 'postgres')['outcome'] == 'cancelled',
       'Cancel releases the hold')
    ok(q(f"SELECT wait_mode FROM public.heads_up_wait_holds WHERE tournament_id='{p6}'") == 'play_anyone',
       'and releases the older engines\' Heads Up row with it')
    ok(j(f"SELECT public.fn_cancel_private_game_hold('{p6}')", stranger)['ok'] is False,
       'nobody but the inviter can cancel a hold')

    # ── 6. A failed inviter buy-in leaves nothing behind ─────────────────────
    poor = person(balance=3)
    before = q("SELECT count(*) FROM public.tournaments")
    src = board(2, 'sng')
    r = j(f"SELECT public.fn_invite_to_private_game('{src}', 1)", poor)
    ok(r['ok'] is False and r['reason'] == 'insufficient_balance', 'an inviter who cannot pay is told why')
    ok(q("SELECT count(*) FROM public.tournaments") == str(int(before) + 1)
       and q(f"SELECT count(*) FROM public.private_game_holds WHERE creator_user_id='{poor}'") == '0'
       and balance(poor) == 3.0, 'and no copy, no hold and no charge remain')
    q("INSERT INTO public.fixture_knobs VALUES ('window', 'spin_sng_closed_until_reopen')")
    w = j(f"SELECT public.fn_invite_to_private_game('{board(3, 'spin')}', 1)", inviter)
    ok(w['ok'] is False and w['reason'] == 'spin_sng_closed_until_reopen',
       'no private game opens inside the daily Spin and Sit & Go close')
    q("DELETE FROM public.fixture_knobs")

    # ── 7. Specific Player at an empty Heads Up is the same hold ─────────────
    solo = board(2, 'sng')
    q(f"SELECT public.fn_take_seat_and_buy_in('{table_of(solo)}', 1)", inviter)
    sp = j(f"SELECT public.fn_set_heads_up_wait_mode('{table_of(solo)}', 'specific_player')", inviter)
    hold_token = q(f"SELECT invite_token FROM public.private_game_holds WHERE tournament_id='{solo}'")
    ok(sp['ok'] and sp['invite_token'] == hold_token, 'Specific Player opens the private game hold, not a second one')
    ok(refused(f"SELECT public.fn_take_seat_and_buy_in('{table_of(solo)}', 2)", stranger),
       'and the database now refuses the seat it holds')
    legacy = j(f"SELECT public.fn_check_heads_up_seat_invite('{table_of(solo)}', '{hold_token}')", friend)
    ok(legacy['allowed'] is True and q(
        f"SELECT count(*) FROM public.private_game_admissions WHERE tournament_id='{solo}' AND user_id='{friend}'") == '1',
       'an older page asking the old question admits its token holder, so it is not refused')
    ok(j(f"SELECT public.fn_take_seat_and_buy_in('{table_of(solo)}', 2)", friend)['ok'], 'and seats them')

    # ── 8. A non-entry write never reaches the rule ──────────────────────────
    p7, t7 = fresh_private()
    q(f"UPDATE public.tournament_players SET chips = 5 WHERE tournament_id='{p7}'", None, 'postgres')
    ok(True, 'chip and status writes inside a held game pass the guard untouched')

    # ── 9. The trigger is the cause: remove it and the stranger gets in ──────
    q("DROP TRIGGER trg_private_game_entry_guard ON public.tournament_players")
    ok(j(f"SELECT public.fn_take_seat_and_buy_in('{t7}', 2)", stranger)['ok'] is True,
       'RED WITHOUT THE FIX: with the trigger removed a stranger takes the held seat')
    print(f'ALL {passed} CHECKS PASSED', flush=True)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'], check=False)
    shutil.rmtree(cluster, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
