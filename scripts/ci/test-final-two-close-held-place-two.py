#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261107130652 (the final two close never dies on a held place two).

The close of a bounty only PKO (fn_ca_bounty_only_pko_final_two, 20261106010426)
stamps the runner-up into finishing place 2. tournament_players carries the live
trigger tournament_place_collision_watch, which raises SQLSTATE 23505 for any
stamp of a place another entrant already holds, and place 2 is held for a moment
by the bounty rebuy step's temporary position. The whole attempt therefore died
instead of answering, and the event played past two players - which cost the
runner-up the bounty on his own head (production: ca_bounty_only_final_two held
zero rows for all time; the one real attempt, c1b3fa5a at 2026-11-07 09:20:13Z,
failed exactly this way).

This runs the EXACT migrations over a minimal schema that carries a faithful
copy of the live collision trigger (public.trg_tournament_place_collision,
md5(prosrc) 5269c4504db2708b7f34efc8a99eb253, read 2026-11-07), and proves:

  * the authority's definition in 20261106010426 is byte for byte the one
    20261107130652 guards as its preimage;
  * BEFORE the fix, a held place 2 kills the close with 23505;
  * AFTER it, the same field is answered finishing_place_two_is_held, with the
    holder and the runner-up named, and NOTHING moves: no credit, no obligation,
    no pool change, no close row, and the runner-up is still playing;
  * once the transient place is cleared the same field closes normally - the
    runner-up is paid exactly his own head, once, and recorded in place 2, and
    what is left of the pool is exactly the winner's own head;
  * the refusal is returned BEFORE the payer runs (a typed RETURN commits, so a
    refusal after the head was paid would leave a paid runner-up still playing);
  * re-applying the migration refuses on its own preimage guard.

And of 20261108193616 (a provisional place 2 moves aside), run after it:

  * its guarded preimage is byte for byte the body 20261107130652 installs;
  * a place 2 that an EARLIER BUST still holds (the provisional ladder stamp
    that no retry clears - Midnight Free Buy 7f473b6a, 2026-11-08) no longer
    refuses: the holder moves to the lowest free place at 3 or above, the
    runner-up is paid exactly his own head once and recorded in place 2, the
    collision guard never fires, and the receipt names the relocation;
  * a replay pays nothing; every other refusal still moves nothing;
  * re-applying it refuses on its own preimage guard.

And of 20261108222325 (the final two close vacates the runner-up's seat), run
after it, with a byte-exact copy of the live deferred constraint trigger
tournament_roster_update_cannot_orphan_live_seat
(public.trg_assert_live_tournament_seat_has_roster, md5(prosrc)
b756632b7e50ef84a232a19afb0264dd, read 2026-11-08) and real seats:

  * its guarded preimage is byte for byte the body 20261108193616 installs;
  * BEFORE it, a runner-up who still holds his live chair makes the close die
    at COMMIT with TOURNAMENT_SEAT_ROSTER_REQUIRED and nothing is paid
    (production: Midday Free Buy 36fc2465, velvet9, 2026-11-08 20:48:14);
  * AFTER it, the same field closes: the runner-up is paid exactly his own head
    once, recorded in place 2, his chair is closed and its table's
    current_players drops, the winner's chair is untouched, and the receipt
    names the vacated seat;
  * a replay pays nothing; re-applying refuses on its own preimage guard.
"""
from pathlib import Path
import json, os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'supabase/migrations/20261106010426_bounty_only_pko_ends_with_two_players.sql'
FIX = ROOT / 'supabase/migrations/20261107130652_the_final_two_close_never_dies_on_a_held_place_two.sql'
MOVE = ROOT / 'supabase/migrations/20261108193616_a_provisional_place_two_moves_aside_for_the_final_two_close.sql'
PREIMAGE = '32ef0b2af5e91401d50068b520ceda55'
# The live body read on production 2026-11-08 19:40 UTC, which MOVE guards.
MOVE_PREIMAGE = '37f5f201b9c12d82e78e22203c4310a1'
SEAT = ROOT / 'supabase/migrations/20261108222325_the_final_two_close_vacates_the_runner_up_seat.sql'
# The live body read on production 2026-11-08 22:20 UTC, which SEAT guards.
SEAT_PREIMAGE = '480b20dc852d4c613dfd39b362ebb4ac'
ROSTER_TRIGGER_MD5 = 'b756632b7e50ef84a232a19afb0264dd'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='held-place-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(39000 + (os.getpid() + 71) % 9000)
started = False


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr + ((work / 'postgres.log').read_text() if 'pg_ctl' in str(args[0]) and (work / 'postgres.log').exists() else ''))
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'w'], sql)


def j(sql):
    return json.loads(q(sql).strip())


def must_fail(sql, needle):
    try:
        q(sql)
    except RuntimeError as error:
        assert needle in str(error), str(error)
        return str(error)
    raise AssertionError('expected a refusal containing %r' % needle)


SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY, name text, status text, is_pko boolean, is_mystery_bounty boolean,
  buy_in_amount numeric, guaranteed_prize numeric, prize_pool numeric,
  bounty_pool numeric(15,2), bounty_pool_paid numeric(15,2), prize_pool_finalized boolean);
CREATE TABLE public.tournament_players(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid,
  status text, chips numeric, current_bounty numeric(15,2), bounty_winnings numeric(15,2),
  position integer, eliminated_at timestamptz, registered_at timestamptz);
CREATE TABLE public.tournament_knockout_candidates(tournament_id uuid, state text);
CREATE TABLE public.tournament_obligations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, kind text, place integer,
  user_id uuid, amount_owed numeric(15,2), amount_paid numeric(15,2), source text);
CREATE TABLE public.ca_settle_sources(source text PRIMARY KEY, note text, added_at timestamptz DEFAULT now());
CREATE TABLE public.ca_money_rpc_registry(proname text PRIMARY KEY, status text NOT NULL, notes text);
CREATE TABLE public.test_credits(user_id uuid, amount numeric(15,2), kind text, source text, description text);
CREATE TABLE public.tournament_place_collisions(
  id bigserial PRIMARY KEY, tournament_id uuid, place integer, user_id uuid,
  existing_user_id uuid, db_role text, application text, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql
  AS $$ SELECT COALESCE(current_setting('test.engine', true), '1') = '1' $$;
CREATE FUNCTION public.fn_ca_lock_settlement_lane_global() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_tournament_has_unsettled_bounties(p uuid) RETURNS boolean LANGUAGE sql
  AS $$ SELECT EXISTS (SELECT 1 FROM public.tournament_obligations o
                        WHERE o.tournament_id = p AND o.kind = 'bounty' AND o.amount_paid < o.amount_owed) $$;
-- The single payer's contract: a cumulative user-keyed total; pays the difference.
CREATE FUNCTION public.fn_settle_tournament_obligation(
  p_tournament_id uuid, p_kind text, p_place integer, p_user_id uuid, p_amount numeric,
  p_source text, p_description text DEFAULT NULL, p_adjustment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_prior numeric := 0; v_pay numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ca_settle_sources s WHERE s.source = lower(p_source)) THEN
    RETURN jsonb_build_object('ok', false, 'paid', 0, 'refused_reason', 'unknown_source');
  END IF;
  SELECT amount_paid INTO v_prior FROM public.tournament_obligations
   WHERE tournament_id = p_tournament_id AND kind = p_kind AND place IS NULL AND user_id = p_user_id;
  v_prior := COALESCE(v_prior, 0);
  v_pay := round(p_amount - v_prior, 2);
  IF v_pay <= 0 THEN RETURN jsonb_build_object('ok', true, 'paid', 0); END IF;
  DELETE FROM public.tournament_obligations
   WHERE tournament_id = p_tournament_id AND kind = p_kind AND place IS NULL AND user_id = p_user_id;
  INSERT INTO public.tournament_obligations(tournament_id, kind, place, user_id, amount_owed, amount_paid, source)
  VALUES (p_tournament_id, p_kind, NULL, p_user_id, p_amount, p_amount, p_source);
  INSERT INTO public.test_credits VALUES (p_user_id, v_pay, p_kind, p_source, p_description);
  RETURN jsonb_build_object('ok', true, 'paid', v_pay);
END $$;
-- A faithful copy of the live place-collision trigger: this is the raise the
-- close used to die on, and the reason the fix has to answer instead.
CREATE FUNCTION public.trg_tournament_place_collision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_existing uuid;
BEGIN
  IF NEW.position IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.position IS NOT DISTINCT FROM OLD.position THEN
    RETURN NEW;
  END IF;

  SELECT tp.user_id INTO v_existing
    FROM tournament_players tp
   WHERE tp.tournament_id = NEW.tournament_id
     AND tp.position = NEW.position
     AND tp.user_id <> NEW.user_id
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    INSERT INTO tournament_place_collisions
      (tournament_id, place, user_id, existing_user_id, db_role, application)
    VALUES
      (NEW.tournament_id, NEW.position, NEW.user_id, v_existing,
       current_user, current_setting('application_name', true));

    RAISE EXCEPTION
      'finishing place % in tournament % is already held by % - refusing to stamp % on it (a contested place is paid TWICE, the prize idempotency key includes the user id)',
      NEW.position, NEW.tournament_id, v_existing, NEW.user_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER tournament_place_collision_watch BEFORE INSERT OR UPDATE OF "position"
  ON public.tournament_players FOR EACH ROW EXECUTE FUNCTION trg_tournament_place_collision();
"""

# A byte-exact copy of the live deferred roster-orphan guard. Its body is
# checked against production's md5(prosrc) before it is used.
ROSTER_BODY = "\nDECLARE\n  v_tournament_id uuid;\n  v_user_id uuid;\n  v_parent_status text;\nBEGIN\n  IF TG_TABLE_NAME = 'table_seats' THEN\n    IF TG_OP = 'DELETE' OR NEW.left_at IS NOT NULL OR NEW.user_id IS NULL THEN\n      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;\n    END IF;\n    SELECT t.tournament_id INTO v_tournament_id\n      FROM public.tables t\n     WHERE t.id = NEW.table_id;\n    v_user_id := NEW.user_id;\n  ELSE\n    IF TG_OP = 'INSERT' THEN\n      RETURN NEW;\n    END IF;\n    v_tournament_id := OLD.tournament_id;\n    v_user_id := OLD.user_id;\n  END IF;\n\n  IF v_tournament_id IS NOT NULL THEN\n    SELECT t.status::text INTO v_parent_status\n      FROM public.tournaments t\n     WHERE t.id = v_tournament_id;\n  END IF;\n\n  /* Terminal cleanup may intentionally close the roster and seats in\n     separate idempotent requests.  The invariant is strict while the event\n     is joinable or playable; finished/cancelled tables are separately barred\n     from acquiring new live seats and may drain without being wedged. */\n  IF v_tournament_id IS NOT NULL\n     AND upper(COALESCE(v_parent_status, '')) IN ('REGISTERING', 'RUNNING')\n     AND EXISTS (\n       SELECT 1\n         FROM public.table_seats s\n         JOIN public.tables t ON t.id = s.table_id\n        WHERE t.tournament_id = v_tournament_id\n          AND s.user_id = v_user_id\n          AND s.left_at IS NULL\n     )\n     AND NOT EXISTS (\n       SELECT 1\n         FROM public.tournament_players p\n        WHERE p.tournament_id = v_tournament_id\n          AND p.user_id = v_user_id\n          AND p.status IN ('registered', 'playing')\n     ) THEN\n    RAISE EXCEPTION\n      'TOURNAMENT_SEAT_ROSTER_REQUIRED: live seat user % has no active roster in tournament % at commit',\n      v_user_id, v_tournament_id\n      USING ERRCODE = '23514';\n  END IF;\n\n  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;\nEND;\n"
SEATS = r"""
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, current_players integer);
CREATE TABLE public.table_seats(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid, seat_number integer,
  stack numeric, joined_at timestamptz DEFAULT now(), left_at timestamptz);
"""

T = '7e000000-0000-0000-0000-0000000000%02d'
A, B, C = ('aa000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002',
           'cc000000-0000-0000-0000-000000000003')


def event(n, pool, paid, players, **over):
    t = T % n
    cols = dict(status="'RUNNING'", is_pko='true', is_mystery_bounty='false', buy_in_amount='0',
                guaranteed_prize='0', prize_pool='0', prize_pool_finalized='true')
    cols.update(over)
    q(f"""INSERT INTO tournaments(id,name,bounty_pool,bounty_pool_paid,{','.join(cols)})
          VALUES ('{t}','Free Buy {n}',{pool},{paid},{','.join(cols.values())});""")
    for i, (uid, status, chips, head, won) in enumerate(players):
        q(f"""INSERT INTO tournament_players(tournament_id,user_id,status,chips,current_bounty,bounty_winnings,registered_at)
              VALUES ('{t}','{uid}','{status}',{chips},{head},{won},'2026-11-05 20:00:00+00'::timestamptz + interval '{i} minutes');""")
    return t


def close(t):
    return j(f"SELECT public.fn_ca_bounty_only_pko_final_two('{t}')::text;")


def row(t, uid):
    return q(f"""SELECT status||'|'||COALESCE(position::text,'')||'|'||current_bounty||'|'||bounty_winnings
                   FROM tournament_players WHERE tournament_id='{t}' AND user_id='{uid}';""").strip()


def money(t):
    """Everything this close could have moved, as one comparable string."""
    return '|'.join(x.strip() for x in (
        q("SELECT count(*)::text FROM test_credits;"),
        q("SELECT count(*)::text FROM tournament_obligations;"),
        q(f"SELECT bounty_pool_paid::text FROM tournaments WHERE id='{t}';"),
        q(f"SELECT count(*)::text FROM ca_bounty_only_final_two WHERE tournament_id='{t}';")))


def held(t, uid, place):
    """Another entrant transiently holds a finishing place (the bounty rebuy step)."""
    q(f"UPDATE tournament_players SET position={place} WHERE tournament_id='{t}' AND user_id='{uid}';")


try:
    shutil.rmtree(work / 'data', ignore_errors=True)
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f'-k {sock} -p {port} -c listen_addresses=', '-w', 'start'])
    started = True
    run([PG / 'createdb', '-h', sock, '-p', port, '-U', 'postgres', 'w'])
    q(SCHEMA)
    q(BASE.read_text())

    # The file the fix guards is the definition the base migration installs.
    live = q("SELECT md5(pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure));").strip()
    assert live == PREIMAGE, 'preimage drifted: %s' % live

    # ── BEFORE THE FIX ───────────────────────────────────────────────────────
    # Three entrants, two live, and the third transiently holds place 2.
    t1 = event(1, 12, 5.25, [(A, 'playing', 5000, 4.50, 3.50), (B, 'playing', 3000, 2.25, 1.25),
                             (C, 'eliminated', 0, 0, 0.50)])
    held(t1, C, 2)
    before = money(t1)
    err = must_fail(f"SELECT public.fn_ca_bounty_only_pko_final_two('{t1}');", 'is already held by')
    assert '23505' in err or 'already held by' in err, err
    assert money(t1) == before, 'the dead attempt moved something'
    assert row(t1, B) == 'playing||2.25|1.25', row(t1, B)

    # ── AFTER THE FIX ────────────────────────────────────────────────────────
    q(FIX.read_text())
    r = close(t1)
    assert r == {'ok': False, 'reason': 'finishing_place_two_is_held',
                 'held_by': C, 'runner_up_user_id': B, 'live': 2}, r
    assert money(t1) == before, 'the refusal moved something'
    assert row(t1, B) == 'playing||2.25|1.25', row(t1, B)
    assert row(t1, C) == 'eliminated|2|0.00|0.50', row(t1, C)
    # The refusal comes before the payer, which a typed RETURN would commit.
    body = q("SELECT pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure);")
    assert 0 < body.index('finishing_place_two_is_held') < body.index('fn_settle_tournament_obligation(')

    # The money core clears the temporary place; the same field then closes.
    q(f"UPDATE tournament_players SET position=4 WHERE tournament_id='{t1}' AND user_id='{C}';")
    r = close(t1)
    assert r['ok'] and r['winner_user_id'] == A and r['runner_up_user_id'] == B, r
    assert float(r['runner_up_head']) == 2.25 and float(r['winner_head']) == 4.50, r
    assert row(t1, B) == 'eliminated|2|0.00|3.50', row(t1, B)
    assert row(t1, A) == 'playing||4.50|3.50', row(t1, A)
    credits = q("SELECT user_id||'|'||amount||'|'||kind||'|'||source FROM test_credits;").split()
    assert credits == [f'{B}|2.25|bounty_residual|fn_ca_bounty_only_pko_final_two'], credits
    left = q(f"SELECT bounty_pool - bounty_pool_paid FROM tournaments WHERE id='{t1}';").strip()
    assert left == '4.50', left  # exactly the winner's own head: the terminal residual
    again = close(t1)
    assert again.get('replayed') is True and again['runner_up_user_id'] == B, again
    assert q("SELECT count(*) FROM test_credits;").strip() == '1'

    # A place 2 the runner-up ALREADY holds is not a collision.
    t2 = event(2, 10, 6.00, [(A, 'playing', 4000, 2.50, 0.50), (B, 'playing', 3000, 1.50, 1.50)])
    held(t2, B, 2)
    r = close(t2)
    assert r['ok'] and r['runner_up_user_id'] == B, r
    assert row(t2, B) == 'eliminated|2|0.00|3.00', row(t2, B)

    # Every other refusal is unchanged, and still moves nothing.
    paid_before = q("SELECT count(*) FROM test_credits;").strip()
    t3 = event(3, 9, 3.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1), (C, 'playing', 10, 2, 1)])
    assert close(t3) == {'ok': False, 'reason': 'field_is_not_two', 'live': 3}
    t4 = event(4, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 0, 2, 1)])
    assert close(t4)['reason'] == 'a_live_stack_is_empty'
    t5 = event(5, 6, 1.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)])
    assert close(t5)['reason'] == 'heads_do_not_match_the_open_pool'
    t6 = event(6, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)], prize_pool='25')
    assert close(t6)['reason'] == 'not_a_bounty_only_pko'
    assert q("SELECT count(*) FROM test_credits;").strip() == paid_before

    # A held place 2 refuses before the engine authority check is weakened, and
    # the grants and ownership the base migration set are unchanged.
    must_fail(f"SET test.engine = '0'; SELECT public.fn_ca_bounty_only_pko_final_two('{t5}');", 'requires engine authority')
    grants = q("""SELECT has_function_privilege('authenticated','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('anon','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('service_role','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_table_privilege('authenticated','public.ca_bounty_only_final_two','select');""").strip()
    assert grants == 'false|false|true|false', grants

    # The fix refuses to run twice: its preimage is no longer the live body.
    must_fail(FIX.read_text(), 'FINAL_TWO_CLOSE_PREIMAGE_CHANGED')

    # ── A PROVISIONAL PLACE 2 MOVES ASIDE (20261108193616) ──────────────────
    live = q("SELECT md5(pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure));").strip()
    assert live == MOVE_PREIMAGE, 'the body 20261107130652 installs is not the production preimage: %s' % live
    q(MOVE.read_text())
    body = q("SELECT pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure);")
    assert "'finishing_place_two_is_held'" not in body, 'the unclearable refusal is still answered'
    # The relocation comes before the payer and before the runner-up stamp.
    assert 0 < body.index('A PROVISIONAL PLACE 2 MOVES ASIDE') < body.index('fn_settle_tournament_obligation(') < body.index('position = 2,')

    # Midnight Free Buy 7f473b6a: the true 3rd (C) was stamped place 2 at his
    # bust and keeps it; place 3 is also taken by the true 4th (D). The close
    # moves C to the lowest FREE place at 3 or above, which is 4, and closes.
    D = 'dd000000-0000-0000-0000-000000000004'
    t7 = event(7, 12, 5.25, [(A, 'playing', 5000, 4.50, 3.50), (B, 'playing', 3000, 2.25, 1.25),
                             (C, 'eliminated', 0, 0, 0.50), (D, 'eliminated', 0, 0, 0)])
    held(t7, C, 2)
    held(t7, D, 3)
    credits_before = int(q("SELECT count(*) FROM test_credits;").strip())
    collisions_before = q("SELECT count(*) FROM tournament_place_collisions;").strip()
    r = close(t7)
    assert r['ok'] and r['winner_user_id'] == A and r['runner_up_user_id'] == B, r
    assert r['relocated_provisional_place_2'] == C and r['relocated_to'] == 4, r
    assert float(r['runner_up_head']) == 2.25, r
    assert row(t7, B) == 'eliminated|2|0.00|3.50', row(t7, B)
    assert row(t7, C) == 'eliminated|4|0.00|0.50', row(t7, C)
    assert row(t7, D) == 'eliminated|3|0.00|0.00', row(t7, D)
    assert row(t7, A) == 'playing||4.50|3.50', row(t7, A)
    assert q("SELECT count(*) FROM tournament_place_collisions;").strip() == collisions_before, 'the guard fired'
    new_credits = q(f"SELECT user_id||'|'||amount||'|'||kind FROM test_credits OFFSET {credits_before};").split()
    assert new_credits == [f'{B}|2.25|bounty_residual'], new_credits
    left = q(f"SELECT bounty_pool - bounty_pool_paid FROM tournaments WHERE id='{t7}';").strip()
    assert left == '4.50', left
    again = close(t7)
    assert again.get('replayed') is True and again['relocated_provisional_place_2'] == C, again
    assert int(q("SELECT count(*) FROM test_credits;").strip()) == credits_before + 1

    # Every other refusal still moves nothing, and nothing is relocated by one.
    paid_before = q("SELECT count(*) FROM test_credits;").strip()
    t8 = event(8, 9, 3.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1), (C, 'playing', 10, 2, 1),
                            (D, 'eliminated', 0, 0, 0)])
    held(t8, D, 2)
    assert close(t8) == {'ok': False, 'reason': 'field_is_not_two', 'live': 3}
    assert row(t8, D) == 'eliminated|2|0.00|0.00', row(t8, D)
    t9 = event(9, 6, 1.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1), (C, 'eliminated', 0, 0, 0)])
    held(t9, C, 2)
    assert close(t9)['reason'] == 'heads_do_not_match_the_open_pool'
    assert row(t9, C) == 'eliminated|2|0.00|0.00', row(t9, C)
    assert q("SELECT count(*) FROM test_credits;").strip() == paid_before
    grants = q("""SELECT has_function_privilege('authenticated','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('anon','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('service_role','public.fn_ca_bounty_only_pko_final_two(uuid)','execute');""").strip()
    assert grants == 'false|false|true', grants
    must_fail(f"SET test.engine = '0'; SELECT public.fn_ca_bounty_only_pko_final_two('{t9}');", 'requires engine authority')
    must_fail(MOVE.read_text(), 'FINAL_TWO_PROVISIONAL_PLACE_PREIMAGE_CHANGED')

    # ── THE FINAL TWO CLOSE VACATES THE RUNNER-UP'S SEAT (20261108222325) ────
    q(SEATS)
    q("CREATE FUNCTION public.trg_assert_live_tournament_seat_has_roster() RETURNS trigger "
      "LANGUAGE plpgsql AS $roster$" + ROSTER_BODY + "$roster$;")
    assert q("SELECT md5(prosrc) FROM pg_proc WHERE proname='trg_assert_live_tournament_seat_has_roster';").strip() == ROSTER_TRIGGER_MD5
    q("""CREATE CONSTRAINT TRIGGER tournament_roster_update_cannot_orphan_live_seat
           AFTER UPDATE OF tournament_id, user_id, status ON public.tournament_players
           DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
           EXECUTE FUNCTION trg_assert_live_tournament_seat_has_roster();""")

    def seat_up(t, n):
        tb = 'ab000000-0000-0000-0000-0000000000%02d' % n
        q(f"INSERT INTO tables(id,tournament_id,current_players) VALUES ('{tb}','{t}',2);")
        q(f"""INSERT INTO table_seats(table_id,user_id,seat_number,stack) VALUES
              ('{tb}','{A}',8,5000),('{tb}','{B}',4,3000);""")
        return tb

    def live_seat(t, uid):
        return q(f"""SELECT count(*) FROM table_seats s JOIN tables tb ON tb.id=s.table_id
                      WHERE tb.tournament_id='{t}' AND s.user_id='{uid}' AND s.left_at IS NULL;""").strip()

    # Midday Free Buy 36fc2465: the true 3rd still holds place 2, and the
    # runner-up is still seated, as he is whenever the engine parks to close.
    live = q("SELECT md5(pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure));").strip()
    assert live == SEAT_PREIMAGE, 'the body 20261108193616 installs is not the production preimage: %s' % live
    t10 = event(10, 12, 5.25, [(A, 'playing', 5000, 4.50, 3.50), (B, 'playing', 3000, 2.25, 1.25),
                               (C, 'eliminated', 0, 0, 0.50)])
    held(t10, C, 2)
    tb10 = seat_up(t10, 10)
    before = money(t10)
    must_fail(f"SELECT public.fn_ca_bounty_only_pko_final_two('{t10}');", 'TOURNAMENT_SEAT_ROSTER_REQUIRED')
    assert money(t10) == before, 'the dead attempt moved something'
    assert row(t10, B) == 'playing||2.25|1.25', row(t10, B)
    assert row(t10, C) == 'eliminated|2|0.00|0.50', row(t10, C)
    assert live_seat(t10, B) == '1'

    q(SEAT.read_text())
    body = q("SELECT pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure);")
    # The chair closes after the payer and the roster write, inside the same body.
    assert 0 < body.index('fn_settle_tournament_obligation(') < body.index("status = 'eliminated',") \
        < body.index('THE RUNNER-UP LEAVES HIS CHAIR') < body.index('INSERT INTO public.ca_bounty_only_final_two')
    credits_before = int(q("SELECT count(*) FROM test_credits;").strip())
    r = close(t10)
    assert r['ok'] and r['winner_user_id'] == A and r['runner_up_user_id'] == B, r
    assert r['relocated_provisional_place_2'] == C and r['relocated_to'] == 3, r
    assert float(r['runner_up_head']) == 2.25, r
    assert len(r['runner_up_seats_vacated']) == 1, r
    assert row(t10, B) == 'eliminated|2|0.00|3.50', row(t10, B)
    assert row(t10, A) == 'playing||4.50|3.50', row(t10, A)
    assert live_seat(t10, B) == '0' and live_seat(t10, A) == '1'
    assert q(f"SELECT current_players FROM tables WHERE id='{tb10}';").strip() == '1'
    new_credits = q(f"SELECT user_id||'|'||amount||'|'||kind FROM test_credits OFFSET {credits_before};").split()
    assert new_credits == [f'{B}|2.25|bounty_residual'], new_credits
    left = q(f"SELECT bounty_pool - bounty_pool_paid FROM tournaments WHERE id='{t10}';").strip()
    assert left == '4.50', left
    again = close(t10)
    assert again.get('replayed') is True and again['runner_up_user_id'] == B, again
    assert int(q("SELECT count(*) FROM test_credits;").strip()) == credits_before + 1

    # A refusal still moves nothing, the runner-up's chair included.
    t11 = event(11, 6, 1.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)])
    seat_up(t11, 11)
    assert close(t11)['reason'] == 'heads_do_not_match_the_open_pool'
    assert live_seat(t11, B) == '1' and live_seat(t11, A) == '1'
    grants = q("""SELECT has_function_privilege('authenticated','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('anon','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('service_role','public.fn_ca_bounty_only_pko_final_two(uuid)','execute');""").strip()
    assert grants == 'false|false|true', grants
    must_fail(f"SET test.engine = '0'; SELECT public.fn_ca_bounty_only_pko_final_two('{t11}');", 'requires engine authority')
    must_fail(SEAT.read_text(), 'FINAL_TWO_SEAT_VACATE_PREIMAGE_CHANGED')
    print('final two close with the runner-up still seated: his chair closes with his finish, he is paid once - OK')
    print('final two close with a provisional place 2: the holder moves aside, the runner-up is paid once - OK')
    print('final two close with a held place 2: answered, not died; nothing moved; the cleared field closes once - OK')
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
