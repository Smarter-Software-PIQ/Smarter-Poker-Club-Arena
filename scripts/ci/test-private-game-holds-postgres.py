#!/usr/bin/env python3
"""A held seat is refused to anyone but its invited holder, on a real cluster.

Installs, UNCHANGED from supabase/migrations, the Heads Up hold migration
(20261122025900), the private game hold rule (20261123013126), the window
migration that attaches its entry guard (20261123013136) and the Sit & Go
door (20261123071654), over the stand-in doors in
scripts/ci/fixtures/private-game-holds/bootstrap.sql. Then, as real
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
  * a six or nine seat Sit & Go (20261123071654): the inviter is registered
    through the normal registration door and up to seats - 1 seats are held
    in place; horses fill only the unheld seats, the field stays short until
    the friends register, a stranger and a horse are refused a held seat, the
    hold ends on expiry, Cancel or the inviter unregistering (normal refund)
    and the board fills as usual; no room, another inviter's hold, the daily
    close and an unknown format are refused before any money moves;
  * two-session concurrency races on real PostgreSQL connections prove lock
    order (no deadlock with exclusive entry boundary 530090 -> tournaments
    FOR NO KEY UPDATE), simultaneous unregistered inviters (exactly one wins,
    loser rolls back with zero charge), inviter-vs-stranger on the last two
    seats, and registered inviter-vs-horse seat conservation;
  * before 20261123071654 a Sit & Go invite was refused: that file is the cause;
  * removing the trigger lets the stranger in: the trigger is the cause, for a
    seat-first game and for a Sit & Go alike.

Usage: python3 scripts/ci/test-private-game-holds-postgres.py [--pg-bin DIR]
"""
import json, os, shutil, subprocess, sys, tempfile, time, uuid
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
SIT_AND_GO = MIG / '20261123071654_a_sit_and_go_holds_seats_for_invited_friends.sql'
BOOT = ROOT / 'scripts/ci/fixtures/private-game-holds/bootstrap.sql'
CLUB = '00000000-0000-4000-8000-0000000000c1'
TARGET = '00000000-0000-4000-8000-0000000000a7'

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

    # RED WITHOUT THE SIT & GO DOOR: before 20261123071654 a Sit & Go is refused.
    def sit_and_go(seats, fmt="'sng-v1'"):
        tid = str(uuid.uuid4())
        q(f"""INSERT INTO public.tournaments (id, club_id, union_id, name, game_type, variant, tournament_type, buy_in_amount,
                buy_in_fee, guaranteed_prize, starting_chips, max_players, min_players, table_size, current_players, status,
                blind_structure, payout_structure, start_time, late_reg_levels, late_reg_mins, satellite_target_id,
                satellite_seats, format_contract)
              VALUES ('{tid}', '{CLUB}', '{CLUB}', 'Satellite Into Nightly {seats}-Max SNG Satellite', 'nlh', 'sng', 'SNG', 9, 1,
                0, 10000, {seats}, {seats}, {seats}, 0, 'REGISTERING', '[]', '[]', now() + interval '2 minutes', 0, 0,
                '{TARGET}', 2, {fmt});""")
        return tid

    early = person()
    pre = j(f"SELECT public.fn_invite_to_private_game('{sit_and_go(6)}', 2)", early)
    ok(pre['ok'] is False and pre['reason'] == 'format_not_supported' and balance(early) == 100.0,
       'RED WITHOUT THE FIX: before 20261123071654 Invite To Game refuses a six seat Sit & Go')
    q(SIT_AND_GO.read_text())
    ok(q("SELECT strpos(pg_get_functiondef('public.fn_invite_to_private_game(uuid,integer)'::regprocedure),"
         " 'fn_register_for_tournament_request') > 0") == 't',
       'the Sit & Go door installs unchanged over the three')

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

    # ── 10. A Sit & Go holds seats for invited friends (20261123071654) ──────
    def entries(tid):
        return int(q(f"SELECT count(*) FROM public.tournament_players WHERE tournament_id='{tid}'"
                     " AND status IN ('registered', 'playing')"))

    def register_sql(tid):
        return f"SELECT public.fn_register_for_tournament_request('{tid}', gen_random_uuid())"

    def register(tid, uid):
        return j(register_sql(tid), uid)

    def horse_entry(tid, horse):
        return f"SELECT public.fn_register_horse_for_tournament('{tid}', '{horse}');"

    def horse_in(tid, horse):
        return psql(horse_entry(tid, horse), None, 'postgres', check=False).returncode == 0

    def view(tid):
        return j(f"SELECT public.fn_private_game_hold_view('{tid}')", None, 'postgres')

    herd = [person(horse=True) for _ in range(30)]

    def horses(n):
        out = herd[:n]
        del herd[:n]
        return out

    # 10a. Six seats, the inviter outside it, two friends.
    six = sit_and_go(6)
    inv, fa, fb, fc, strn = person(), person(), person(), person(), person()
    res = j(f"SELECT public.fn_invite_to_private_game('{six}', 2)", inv)
    ok(res['ok'] and res.get('sit_and_go') and res.get('registered') and res['created'] is False
       and res['tournament_id'] == six and res['exclusive'] is False and res['seats_held'] == 2 and res['live'],
       'a six seat Sit & Go: the inviter is registered and two seats are held in this same game')
    ok(balance(inv) == 90.0 and entries(six) == 1,
       'the inviter is charged exactly one buy-in, through the normal registration door')
    tok6 = res['invite_token']
    first = horses(4)
    ok(all(horse_in(six, h) for h in first[:3]) and entries(six) == 4,
       'horses fill the three unheld seats around the inviter')
    ok(refused(horse_entry(six, first[3]), None, 'postgres'),
       'a fourth horse is refused: a held seat is never given to a horse')
    ok(refused(register_sql(six), strn) and balance(strn) == 100.0,
       'a stranger is refused the held seat by the same line, and charged nothing')
    ok(entries(six) == 4 and view(six)['held_open'] == 2,
       'so the field stays at four of six: the game cannot start without the friends')
    deny6 = j(f"SELECT public.fn_accept_private_game_invite('{six}', NULL)", strn)
    ok(deny6['allowed'] is False and deny6['reason'] == 'private_game_seat_held',
       'a stranger asking first is answered with the rule before any money moves')
    a1 = j(f"SELECT public.fn_accept_private_game_invite('{six}', '{tok6}')", fa)
    ok(a1['allowed'] and a1['admitted'] and register(six, fa)['ok'] and balance(fa) == 90.0,
       'the first friend is admitted by the token and registers through the normal door, once')
    ok(view(six)['held_open'] == 1 and view(six)['live'] is True, 'one seat is still held for the second friend')
    j(f"SELECT public.fn_accept_private_game_invite('{six}', '{tok6}')", fb)
    ok(register(six, fb)['ok'] and entries(six) == 6 and view(six)['outcome'] == 'fulfilled',
       'the second friend takes the last held seat: every seat is taken, friends included, and the hold is over')
    full6 = j(f"SELECT public.fn_accept_private_game_invite('{six}', '{tok6}')", fc)
    ok(full6['allowed'] is True and full6['reserved'] is False and register(six, fc)['ok'] is False,
       'after that the game is an ordinary full board: a third token holder meets the full field, not the hold')

    # 10b. Nine seats, the inviter registered alone: up to eight friends.
    nine = sit_and_go(9)
    inv9 = person()
    ok(register(nine, inv9)['ok'], 'an inviter can register first, as anyone does')
    r9 = j(f"SELECT public.fn_invite_to_private_game('{nine}', 12)", inv9)
    ok(r9['ok'] and r9['seats_held'] == 8 and r9.get('registered') is False and balance(inv9) == 90.0,
       'a nine seat Sit & Go holds at most seats - 1 = 8, and nothing more is bought')
    h9 = horses(2)
    ok(refused(horse_entry(nine, h9[0]), None, 'postgres') and refused(register_sql(nine), strn),
       'with every other seat held, a horse and a stranger are both refused')
    c9 = j(f"SELECT public.fn_cancel_private_game_hold('{nine}')", inv9)
    ok(c9['ok'] and view(nine)['outcome'] == 'cancelled', 'Cancel releases a Sit & Go hold')
    ok(horse_in(nine, h9[0]) and horse_in(nine, h9[1]),
       'and the board fills as usual again: horses take the seats that were held')

    # 10c. Nine seats, a partial field: the hold is bounded by the open seats.
    part = sit_and_go(9)
    invp = person()
    register(part, invp)
    hp = horses(6)
    ok(horse_in(part, hp[0]) and horse_in(part, hp[1]), 'two horses are already in')
    rp = j(f"SELECT public.fn_invite_to_private_game('{part}', 5)", invp)
    ok(rp['ok'] and rp['seats_held'] == 5, 'five friends are held beside them')
    ok(horse_in(part, hp[2]) and refused(horse_entry(part, hp[3]), None, 'postgres') and entries(part) == 4,
       'the one unheld seat fills; the five held seats do not')
    age_hold(part, 12)
    q(f"INSERT INTO public.engine_maintenance_thaws VALUES (now() - interval '6 minutes', 300)")
    ok(view(part)['live'] is True and refused(horse_entry(part, hp[3]), None, 'postgres'),
       'a cutover inside the hold is given back: the held seats are still kept')
    q("DELETE FROM public.engine_maintenance_thaws")
    ok(view(part)['outcome'] == 'expired', 'without the frozen time the ten minutes have run out')
    ok(all(horse_in(part, h) for h in hp[3:6]) and entries(part) == 7,
       'an expired hold falls back to the ordinary fill: horses take the seats that were held')

    # 10d. The inviter unregisters: the normal refund, and the hold is gone.
    six_u = sit_and_go(6)
    invu = person()
    j(f"SELECT public.fn_invite_to_private_game('{six_u}', 1)", invu)
    un = j(f"SELECT public.fn_unregister_from_tournament('{six_u}')", invu)
    ok(un['ok'] and balance(invu) == 100.0, 'the inviter can unregister and is refunded in full, once')
    ok(view(six_u)['outcome'] == 'creator_left' and horse_in(six_u, horses(1)[0]),
       'the hold ends with them and the game is an ordinary board again')

    # 10e. Refused before any money moves.
    crowded = sit_and_go(6)
    for h in horses(5):
        q(horse_entry(crowded, h), None, 'postgres')
    out = person()
    rc = j(f"SELECT public.fn_invite_to_private_game('{crowded}', 1)", out)
    ok(rc['ok'] is False and rc['reason'] == 'no_open_seat' and balance(out) == 100.0
       and entries(crowded) == 5 and q(f"SELECT count(*) FROM public.private_game_holds WHERE tournament_id='{crowded}'") == '0',
       'a Sit & Go with no room for the inviter and a friend is refused, with no entry, no hold and no charge')
    room = sit_and_go(6)
    for h in horses(3):
        q(horse_entry(room, h), None, 'postgres')
    invr = person()
    rr = j(f"SELECT public.fn_invite_to_private_game('{room}', 5)", invr)
    ok(rr['ok'] and rr['seats_held'] == 2 and entries(room) == 4,
       'from outside, the friends held are bounded by the room left after the inviter')
    other = person()
    ro = j(f"SELECT public.fn_invite_to_private_game('{room}', 1)", other)
    ok(ro['ok'] is False and ro['reason'] == 'another_invite_is_holding' and balance(other) == 100.0,
       'a second inviter is told another player is holding seats, before paying')
    q("INSERT INTO public.fixture_knobs VALUES ('window', 'spin_sng_closed_until_reopen')")
    rw = j(f"SELECT public.fn_invite_to_private_game('{sit_and_go(6)}', 1)", other)
    ok(rw['ok'] is False and rw['reason'] == 'spin_sng_closed_until_reopen' and balance(other) == 100.0,
       'no Sit & Go is entered through the invite inside the daily Spin and Sit & Go close')
    q("DELETE FROM public.fixture_knobs")
    for odd in (sit_and_go(10), sit_and_go(6, 'NULL')):
        r = j(f"SELECT public.fn_invite_to_private_game('{odd}', 1)", other)
        ok(r['ok'] is False and r['reason'] == 'format_not_supported' and balance(other) == 100.0,
           'a field outside four to nine seats, or with no persisted sng-v1 format, is not offered')

    # 10f. Two-session real-PostgreSQL concurrency races (lock order, double-invite,
    # inviter-vs-stranger on last two seats, and registered inviter-vs-horse).
    def spawn_psql(sql, actor=None, role='authenticated'):
        pre = "SET lock_timeout = '10s';\nSET statement_timeout = '15s';\n"
        if actor:
            pre += (f"SET request.jwt.claim.sub='{actor}';\nSET request.jwt.claim.role='{role}';\n"
                    f"SET ROLE {role};\n")
        p = subprocess.Popen(
            [str(PG / 'psql'), '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-U', 'postgres', '-d', 'postgres'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
        )
        assert p.stdin is not None
        p.stdin.write(pre + sql)
        p.stdin.flush()
        p.stdin.close()
        return p

    def open_barrier(lock_sql):
        """Hold a real transaction lock until release(proc) commits it."""
        p = subprocess.Popen(
            [str(PG / 'psql'), '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', str(sock), '-U', 'postgres', '-d', 'postgres'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
        )
        assert p.stdin is not None and p.stdout is not None
        p.stdin.write(f"BEGIN;\n{lock_sql}\nSELECT 'LOCKED';\n")
        p.stdin.flush()
        while True:
            raw = p.stdout.readline()
            if not raw:
                out, err = p.communicate(timeout=10)
                raise RuntimeError(f'barrier failed: {out} {err}')
            if raw.strip() == 'LOCKED':
                break
        return p

    def wait_waiting_locks(min_waiters, timeout=8.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            cnt = int(q("SELECT count(*) FROM pg_locks WHERE NOT granted"))
            if cnt >= min_waiters:
                return True
            time.sleep(0.05)
        return False

    def release_barrier(p, extra_sql=''):
        assert p.stdin is not None
        p.stdin.write(f"{extra_sql}\nCOMMIT;\n")
        p.stdin.flush()
        p.stdin.close()
        out, err = p.communicate(timeout=15)
        if p.returncode != 0:
            raise RuntimeError(f'barrier commit failed: {out} {err}')

    # Race 1: lock-order proof — exclusive entry boundary (530090, 1) THEN event row
    # must NEVER deadlock with an unregistered Sit & Go invite.
    race_lock = sit_and_go(6)
    inv_lock = person()
    b1 = open_barrier("SELECT pg_advisory_xact_lock(530090, 1);")
    p_inv_lock = spawn_psql(f"SELECT public.fn_invite_to_private_game('{race_lock}', 2);", inv_lock)
    ok(wait_waiting_locks(1),
       'concurrency lock-order: unregistered Sit & Go invite waits on entry boundary (530090, 1) without locking tournaments first')
    # Acquire the event row while still holding (530090, 1): would deadlock (40P01)
    # if fn_invite_to_private_game locked tournaments before calling the door.
    release_barrier(b1, f"SELECT 1 FROM public.tournaments WHERE id = '{race_lock}' FOR NO KEY UPDATE;")
    out1, err1 = p_inv_lock.communicate(timeout=15)
    r_lock = json.loads(out1.strip().splitlines()[-1]) if p_inv_lock.returncode == 0 else {}
    ok(p_inv_lock.returncode == 0 and 'deadlock' not in err1.lower() and r_lock.get('ok') is True
       and r_lock.get('seats_held') == 2 and balance(inv_lock) == 90.0 and entries(race_lock) == 1,
       'concurrency lock-order: entry boundary -> event row finishes with zero deadlock and one clean hold')

    # Race 2: two unregistered inviters pass the early pre-check and collide on (530090, 1).
    race_two = sit_and_go(6)
    inv_a, inv_b = person(), person()
    b2 = open_barrier("SELECT pg_advisory_xact_lock(530090, 1);")
    pa = spawn_psql(f"SELECT public.fn_invite_to_private_game('{race_two}', 5);", inv_a)
    pb = spawn_psql(f"SELECT public.fn_invite_to_private_game('{race_two}', 5);", inv_b)
    ok(wait_waiting_locks(2),
       'concurrency two-inviters: both unregistered inviters pass early reads and queue on (530090, 1)')
    release_barrier(b2)
    oa, ea = pa.communicate(timeout=15)
    ob, eb = pb.communicate(timeout=15)
    ra = json.loads(oa.strip().splitlines()[-1]) if pa.returncode == 0 and oa.strip() else {'ok': False, 'err': ea}
    rb = json.loads(ob.strip().splitlines()[-1]) if pb.returncode == 0 and ob.strip() else {'ok': False, 'err': eb}
    ok('deadlock' not in (ea + eb).lower() and pa.returncode == 0 and pb.returncode == 0,
       'concurrency two-inviters: zero deadlock and both calls return cleanly')
    winners = [r for r in (ra, rb) if r.get('ok') is True]
    losers = [r for r in (ra, rb) if r.get('ok') is False]
    ok(len(winners) == 1 and len(losers) == 1
       and losers[0].get('reason') in ('another_invite_is_holding', 'private_game_seat_held')
       and entries(race_two) == 1
       and q(f"SELECT count(*) FROM public.private_game_holds WHERE tournament_id='{race_two}'") == '1'
       and sorted([balance(inv_a), balance(inv_b)]) == [90.0, 100.0],
       'concurrency two-inviters: exactly one wins the hold, the loser rolls back with zero charge')

    # Race 3: unregistered inviter vs stranger on a 6-seat Sit & Go with 4 entries seated (2 open seats).
    race_str = sit_and_go(6)
    for h in horses(4):
        q(horse_entry(race_str, h), None, 'postgres')
    inv_s, str_s = person(), person()
    b3 = open_barrier("SELECT pg_advisory_xact_lock(530090, 1);")
    p_is = spawn_psql(f"SELECT public.fn_invite_to_private_game('{race_str}', 1);", inv_s)
    p_ss = spawn_psql(register_sql(race_str), str_s)
    ok(wait_waiting_locks(2),
       'concurrency inviter-vs-stranger: both queue on (530090, 1) with two open seats left')
    release_barrier(b3)
    ois, eis = p_is.communicate(timeout=15)
    oss, ess = p_ss.communicate(timeout=15)
    ok('deadlock' not in (eis + ess).lower() and p_is.returncode == 0,
       'concurrency inviter-vs-stranger: zero deadlock')
    ris = json.loads(ois.strip().splitlines()[-1])
    if ris.get('ok') is True:
        # Inviter won seat 5 + held seat 6 -> stranger must be refused by guard with zero charge.
        ok(p_ss.returncode != 0 and 'PRIVATE_GAME_SEAT_HELD' in (ess + oss)
           and balance(inv_s) == 90.0 and balance(str_s) == 100.0
           and entries(race_str) == 5 and view(race_str)['held_open'] == 1,
           'concurrency inviter-vs-stranger: inviter won and held seat 6; stranger refused with zero charge')
    else:
        # Stranger won seat 5 -> inviter rolled back seat 6 with no_open_seat and zero charge.
        rss = json.loads(oss.strip().splitlines()[-1])
        ok(p_ss.returncode == 0 and rss.get('ok') is True
           and ris.get('reason') == 'no_open_seat'
           and balance(str_s) == 90.0 and balance(inv_s) == 100.0
           and entries(race_str) == 5
           and q(f"SELECT count(*) FROM public.private_game_holds WHERE tournament_id='{race_str}'") == '0',
           'concurrency inviter-vs-stranger: stranger won seat 5; inviter rolled back cleanly with zero charge')

    # Race 4: already-registered inviter holding 5 seats vs horse registering concurrently.
    race_h = sit_and_go(6)
    inv_h = person()
    horse_h = person(horse=True)
    ok(register(race_h, inv_h)['ok'], 'concurrency registered-inviter-vs-horse: inviter registers first')
    b4 = open_barrier(f"SELECT 1 FROM public.tournaments WHERE id = '{race_h}' FOR NO KEY UPDATE;")
    p_ih = spawn_psql(f"SELECT public.fn_invite_to_private_game('{race_h}', 5);", inv_h)
    p_hh = spawn_psql(horse_entry(race_h, horse_h), None, 'postgres')
    ok(wait_waiting_locks(2),
       'concurrency registered-inviter-vs-horse: both queue on the tournaments event lock')
    release_barrier(b4)
    oih, eih = p_ih.communicate(timeout=15)
    ohh, ehh = p_hh.communicate(timeout=15)
    ok('deadlock' not in (eih + ehh).lower() and p_ih.returncode == 0,
       'concurrency registered-inviter-vs-horse: zero deadlock')
    rih = json.loads(oih.strip().splitlines()[-1])
    v_rh = view(race_h)
    ok(rih.get('ok') is True and entries(race_h) + v_rh['held_open'] == 6
       and ((entries(race_h) == 1 and v_rh['held_open'] == 5 and p_hh.returncode != 0 and 'PRIVATE_GAME_SEAT_HELD' in (ehh + ohh) and balance(horse_h) == 100.0)
            or (entries(race_h) == 2 and v_rh['held_open'] == 4 and p_hh.returncode == 0 and balance(horse_h) == 90.0)),
       'concurrency registered-inviter-vs-horse: exact seat conservation with zero oversubscription')

    # A held Sit & Go seat for the red case below: every unheld seat taken.
    red = sit_and_go(6)
    invx = person()
    register(red, invx)
    j(f"SELECT public.fn_invite_to_private_game('{red}', 5)", invx)
    ok(refused(register_sql(red), strn), 'with the trigger attached a stranger cannot register into a held Sit & Go seat')

    # ── 9. The trigger is the cause: remove it and the stranger gets in ──────
    q("DROP TRIGGER trg_private_game_entry_guard ON public.tournament_players")
    ok(j(f"SELECT public.fn_take_seat_and_buy_in('{t7}', 2)", stranger)['ok'] is True,
       'RED WITHOUT THE FIX: with the trigger removed a stranger takes the held seat')
    ok(register(red, strn)['ok'] is True and horse_in(red, horses(1)[0]),
       'RED WITHOUT THE FIX: and a stranger and a horse take held Sit & Go seats')
    print(f'ALL {passed} CHECKS PASSED', flush=True)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'], check=False)
    shutil.rmtree(cluster, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
