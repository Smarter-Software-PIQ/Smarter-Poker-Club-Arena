#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261106010426 (a bounty only PKO ends with two players).

Owner rule (Dan, 2026-11-05): the event is over with two players left and both
keep the bounty on their own head. The EXACT migration runs over a minimal
schema whose payer, lane lock and engine-authority functions are recording
stand-ins with the production signatures, so this proves the authority's own
decisions:

  * the larger stack is first; equal stacks go to the larger head, then the
    earlier registration;
  * the second player is paid exactly his own head through the single payer
    (kind bounty_residual, named source), recorded eliminated in second place
    with his head at zero, and the pool paid moves by that head;
  * what is left of the pool is exactly the first player's own head, which the
    unchanged terminal residual pays him: conservation is exact;
  * a replay returns the stored receipt and pays nothing again;
  * nothing moves for a field that is not two, an unsettled bust, an empty
    stack, another format, a stopped event, or heads that do not match the
    open pool; only the engine may call it and only service_role may execute it;
  * under the real one-place-one-player guard, a provisional place 2 left by
    an earlier bust moves aside to the lowest free place instead of refusing
    the close (20261107134243, the 2026-11-07 Midnight Free Buy root cause).
"""
from pathlib import Path
import json, os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261106010426_bounty_only_pko_ends_with_two_players.sql'
MIG2 = ROOT / 'supabase/migrations/20261107134243_a_provisional_place_two_moves_aside_for_the_final_two_close.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='final-two-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(39000 + (os.getpid() + 29) % 9000)
started = False


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
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
        return
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


try:
    shutil.rmtree(work / 'data', ignore_errors=True)
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f'-k {sock} -p {port} -h 127.0.0.1', '-w', 'start'])
    started = True
    run([PG / 'createdb', '-h', sock, '-p', port, '-U', 'postgres', 'w'])
    q(SCHEMA)
    q(MIG.read_text())
    # Production parity: the one-place-one-player guard (20260828013501) that
    # refused the Midnight Free Buy close on 2026-11-07. Every scenario below
    # runs under it, exactly as production does.
    q(r"""
CREATE TABLE public.tournament_place_collisions(
  tournament_id uuid, place integer, user_id uuid, existing_user_id uuid,
  db_role text, application text, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.trg_tournament_place_collision() RETURNS trigger
LANGUAGE plpgsql AS $trg$
DECLARE v_existing uuid;
BEGIN
  IF NEW.position IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.position IS NOT DISTINCT FROM OLD.position THEN RETURN NEW; END IF;
  SELECT tp.user_id INTO v_existing FROM tournament_players tp
   WHERE tp.tournament_id = NEW.tournament_id AND tp.position = NEW.position
     AND tp.user_id <> NEW.user_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    INSERT INTO tournament_place_collisions(tournament_id, place, user_id, existing_user_id, db_role, application)
    VALUES (NEW.tournament_id, NEW.position, NEW.user_id, v_existing, current_user,
            current_setting('application_name', true));
    RAISE EXCEPTION
      'finishing place % in tournament % is already held by % - refusing to stamp % on it (a contested place is paid TWICE, the prize idempotency key includes the user id)',
      NEW.position, NEW.tournament_id, v_existing, NEW.user_id USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $trg$;
CREATE TRIGGER tournament_place_collision BEFORE INSERT OR UPDATE OF position
ON public.tournament_players FOR EACH ROW EXECUTE FUNCTION public.trg_tournament_place_collision();
""")
    q(MIG2.read_text())

    # The two live heads are the whole open pool (12.00 - 5.25 = 4.50 + 2.25).
    t1 = event(1, 12, 5.25, [(A, 'playing', 5000, 4.50, 3.50), (B, 'playing', 3000, 2.25, 1.25),
                             (C, 'eliminated', 0, 0, 0.50)])
    r = close(t1)
    assert r['ok'] and r['winner_user_id'] == A and r['runner_up_user_id'] == B, r
    assert float(r['runner_up_head']) == 2.25 and float(r['winner_head']) == 4.50, r
    assert row(t1, B) == 'eliminated|2|0.00|3.50', row(t1, B)
    assert row(t1, A) == 'playing||4.50|3.50', row(t1, A)
    credits = q(f"SELECT user_id||'|'||amount||'|'||kind||'|'||source FROM test_credits;").split()
    assert credits == [f'{B}|2.25|bounty_residual|fn_ca_bounty_only_pko_final_two'], credits
    left = q(f"SELECT bounty_pool - bounty_pool_paid FROM tournaments WHERE id='{t1}';").strip()
    assert left == '4.50', left  # exactly the first player's own head: the terminal residual
    again = close(t1)
    assert again.get('replayed') is True and again['runner_up_user_id'] == B, again
    assert q("SELECT count(*) FROM test_credits;").strip() == '1'
    assert q(f"SELECT count(*) FROM ca_bounty_only_final_two WHERE tournament_id='{t1}';").strip() == '1'

    # Equal stacks: the larger head is first.
    t2 = event(2, 10, 6.00, [(A, 'playing', 4000, 1.50, 0.50), (B, 'playing', 4000, 2.50, 1.50)])
    r = close(t2)
    assert r['winner_user_id'] == B and r['runner_up_user_id'] == A, r
    # Equal stacks and heads: the earlier registration is first.
    t3 = event(3, 10, 6.00, [(B, 'playing', 4000, 2.00, 1.00), (A, 'playing', 4000, 2.00, 1.00)])
    r = close(t3)
    assert r['winner_user_id'] == B and r['runner_up_user_id'] == A, r

    # A provisional place 2 from an earlier bust moves aside (2026-11-07,
    # Midnight Free Buy c1b3fa5a): the close relocates the holder to the
    # lowest free place at or above 3 instead of being refused by the
    # collision guard, and the receipt says so.
    t12 = event(12, 12, 5.25, [(A, 'playing', 5000, 4.50, 3.50), (B, 'playing', 3000, 2.25, 1.25),
                               (C, 'eliminated', 0, 0, 0.50)])
    q(f"UPDATE tournament_players SET position = 2 WHERE tournament_id='{t12}' AND user_id='{C}';")
    r = close(t12)
    assert r['ok'] and r['runner_up_user_id'] == B, r
    assert r['relocated_provisional_place_2'] == C and r['relocated_to'] == 3, r
    assert row(t12, B) == 'eliminated|2|0.00|3.50', row(t12, B)
    assert row(t12, C) == 'eliminated|3|0.00|0.50', row(t12, C)
    again12 = close(t12)
    assert again12.get('replayed') is True and again12['relocated_provisional_place_2'] == C, again12
    assert q(f"SELECT count(*) FROM tournament_place_collisions WHERE tournament_id='{t12}';").strip() == '0'

    # Refusals move nothing.
    paid_before = q("SELECT count(*) FROM test_credits;").strip()
    t4 = event(4, 9, 3.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1), (C, 'playing', 10, 2, 1)])
    assert close(t4) == {'ok': False, 'reason': 'field_is_not_two', 'live': 3}
    t5 = event(5, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)])
    q(f"INSERT INTO tournament_knockout_candidates VALUES ('{t5}','pending');")
    assert close(t5)['reason'] == 'busts_not_settled'
    t6 = event(6, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 0, 2, 1)])
    assert close(t6)['reason'] == 'a_live_stack_is_empty'
    t7 = event(7, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)], prize_pool='25')
    assert close(t7)['reason'] == 'not_a_bounty_only_pko'
    t8 = event(8, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)], is_mystery_bounty='true')
    assert close(t8)['reason'] == 'not_a_bounty_only_pko'
    t9 = event(9, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)], status="'COMPLETED'")
    assert close(t9)['reason'] == 'not_running_with_a_final_field'
    t10 = event(10, 6, 1.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)])
    assert close(t10)['reason'] == 'heads_do_not_match_the_open_pool'
    t11 = event(11, 6, 2.00, [(A, 'playing', 10, 2, 1), (B, 'playing', 10, 2, 1)], prize_pool_finalized='false')
    assert close(t11)['reason'] == 'not_running_with_a_final_field'
    assert q("SELECT count(*) FROM test_credits;").strip() == paid_before
    assert row(t5, B) == 'playing||2.00|1.00'

    must_fail(f"SET test.engine = '0'; SELECT public.fn_ca_bounty_only_pko_final_two('{t5}');", 'requires engine authority')
    grants = q("""SELECT has_function_privilege('authenticated','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('anon','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_function_privilege('service_role','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
                  ||'|'||has_table_privilege('authenticated','public.ca_bounty_only_final_two','select');""").strip()
    assert grants == 'false|false|true|false', grants
    must_fail(MIG.read_text(), 'already installed')
    print('bounty only PKO final two: 2 players close, own heads paid once, refusals move nothing - OK')
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
