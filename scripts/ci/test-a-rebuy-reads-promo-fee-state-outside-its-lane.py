#!/usr/bin/env python3
"""A rebuy reads promo fee state outside its event lane (incident 075013fd, lane E3).

Native PostgreSQL 16/17 proof for migration
20261119054539_a_rebuy_reads_promo_fee_state_outside_its_event_lane.sql.

Fixture: the production bodies, md5 pinned
(scripts/ci/fixtures/rebuy-promo-fee-state/preimages.json), of
fn_ca_promo_play_through_state and of process_tournament_rebuy as
20261119013430 (lane B7) leaves it (md5 c294af49). The hourly
snapshot readers and fn_ca_promo_play_through_settle come byte for byte from
20261119002019, and fn_ca_share_tournament_lane_for_rebuy from
20261118191946, all on production's column shapes. Only the live fee-history
recomputation (fn_ca_promo_shared_fee_state_live) is a stub. It answers from a
truth table and sleeps a fixed cost per call, standing in for the 1.4 s
production mean measured for rebuyers.

Proves, on a disposable cluster:
  1. the rebuy post-image is the pre-image plus one block placed before the
     event's rebuy key, and nothing else changes;
  2. that block, run as installed, brings an open-grant holder's stale
     snapshot current and costs a holder with no open grant nothing;
  3. after it, the in-lane settle reads no fee history and decides the same
     (a met grant still closes, a locked one stays open);
  4. with two purchases of one event, the second waits only for the first's
     in-lane work: the recomputation is no longer inside the lane;
  5. the guard refuses a second apply, atomically, and the @live-proof pins
     the installed md5.

Usage: PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/ci/test-a-rebuy-reads-promo-fee-state-outside-its-lane.py
"""
import json, os, subprocess, sys, tempfile, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = next((ROOT / 'supabase/migrations').glob('20261119054539_*.sql'))
SNAPSHOT = next((ROOT / 'supabase/migrations').glob('20261119002019_*.sql'))
LANE = next((ROOT / 'supabase/migrations').glob('20261118191946_*.sql'))
FIX = ROOT / 'scripts/ci/fixtures/rebuy-promo-fee-state/preimages.json'
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
REBUY = 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'
SNAP_MD5 = {'public.fn_ca_promo_play_through_settle(uuid,uuid)': '39bb787e0be5b465317dce3fc511b1aa',
            'public.fn_ca_promo_fee_state_ensure(uuid,uuid)': 'c1017fd0d5ead226265ed42b1ba8a632',
            'public.fn_ca_promo_fee_state_refresh(uuid,uuid)': 'c74900f930cac078c944a65e35c85505',
            'public.fn_ca_promo_fee_state_is_current(uuid,uuid)': '8362ccd15795205e0293e0078fba5248',
            'public.fn_ca_promo_shared_fee_state(uuid,uuid)': '4e33f152d2a62bef08be50af9e9ceeeb',
            'public.fn_ca_promo_fee_state_signature(uuid,uuid)': '40cede15843fee3cd83d1a69200602e0',
            'public.fn_ca_share_tournament_lane_for_rebuy(uuid,uuid)': '004125787ce2db12d8f3e8d68ab6da94'}
LIVE_COST = 0.4
IN_LANE_WORK = 0.1
CLUB = '00000000-0000-0000-0000-00000000c1ab'
EVENT = '00000000-0000-0000-0000-0000000e0e01'

SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.ca_promo_play_through_grants(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, club_id uuid NOT NULL, user_id uuid NOT NULL,
 amount numeric NOT NULL, remaining numeric NOT NULL, multiplier numeric NOT NULL, fee_target numeric GENERATED ALWAYS AS (round((amount*multiplier),4)) STORED,
 source_kind text NOT NULL, source_ref text NOT NULL UNIQUE, source_ledger_id uuid, funded_from_type text, funded_from_id uuid,
 cycle_started_at timestamptz NOT NULL, granted_at timestamptz DEFAULT now() NOT NULL, expires_at timestamptz, closed_at timestamptz,
 close_reason text, closed_by uuid, close_note text, created_at timestamptz DEFAULT now() NOT NULL);
CREATE TABLE public.ca_promo_profit_gates(grant_id uuid PRIMARY KEY, unlocked_at timestamptz);
CREATE TABLE public.ca_promo_profit_overrides(grant_id uuid PRIMARY KEY, reviewed_by uuid NOT NULL, reason text NOT NULL, overridden_at timestamptz DEFAULT clock_timestamp() NOT NULL);
CREATE TABLE public.ca_promo_profit_fee_phases(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, grant_id uuid NOT NULL, source_kind text NOT NULL, source_id uuid NOT NULL,
 activated_at timestamptz DEFAULT clock_timestamp() NOT NULL, closed_at timestamptz, UNIQUE(grant_id,source_kind,source_id));
CREATE TABLE public.ca_promo_profit_custody(grant_id uuid NOT NULL, club_id uuid NOT NULL, user_id uuid NOT NULL, kind text NOT NULL, entity_id uuid NOT NULL, amount numeric NOT NULL,
 PRIMARY KEY(grant_id,club_id,user_id,kind,entity_id));
CREATE TABLE public.ca_promo_fee_state_cache(club_id uuid NOT NULL, user_id uuid NOT NULL, computed_at timestamptz NOT NULL, valid_until timestamptz NOT NULL,
 signature text NOT NULL, state jsonb NOT NULL, PRIMARY KEY(club_id,user_id));
CREATE TABLE public.ca_promo_principal_custody(grant_id uuid NOT NULL, kind text NOT NULL, entity_id uuid NOT NULL, amount numeric NOT NULL CHECK (amount>=0),
 PRIMARY KEY(grant_id,kind,entity_id));
CREATE TABLE public.ca_promo_funding_custody_receipts(ledger_id uuid PRIMARY KEY, source_balance_before numeric NOT NULL, amount numeric NOT NULL,
 covered_amount numeric NOT NULL, wallet_funded_amount numeric, destination_kind text NOT NULL, destination_id uuid NOT NULL,
 principal_before numeric NOT NULL CHECK (principal_before>=0), principal_moved numeric NOT NULL CHECK (principal_moved>=0 AND principal_moved<=principal_before));
CREATE TABLE public.ca_promo_play_through_settings(id boolean PRIMARY KEY CHECK (id), multiplier numeric NOT NULL, expiry_days integer NOT NULL,
 enforced_from timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
INSERT INTO public.ca_promo_play_through_settings(id,multiplier,expiry_days,enforced_from) VALUES(true,4,30,now()-interval '1 day');
CREATE TABLE public.chip_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_type text, from_entity_id uuid, to_type text, to_entity_id uuid,
 amount numeric, club_id uuid, status text, category text, created_at timestamptz DEFAULT now());
CREATE TABLE public.club_members(club_id uuid, user_id uuid, chip_balance numeric DEFAULT 0, PRIMARY KEY(club_id,user_id));
-- Row types the rebuy body declares (it is installed, not executed).
CREATE TABLE public.tournaments(id uuid PRIMARY KEY);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid, club_id uuid);
CREATE TABLE public.tournament_knockout_candidates(id uuid PRIMARY KEY);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY);
CREATE TABLE public.fx_truth(grant_id uuid PRIMARY KEY, principal_state text);
CREATE TABLE public.fx_calls(fn text, a uuid, b uuid, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.fn_ca_promo_shared_fee_state_live(p_club uuid, p_user uuid)
 RETURNS TABLE(grant_id uuid, fee_start numeric, fees numeric, principal_target numeric, profit_target numeric, principal_state text, profit_state text,
  consumed_prefix numeric, phase_id uuid, phase_kind text, profit_earned numeric)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
BEGIN
 INSERT INTO public.fx_calls(fn,a,b) VALUES('live',p_club,p_user);
 PERFORM pg_sleep(%(cost)s);
 RETURN QUERY SELECT g.id,0::numeric,0::numeric,g.fee_target,g.amount*2,
   CASE WHEN g.close_reason='met' THEN 'met' WHEN g.closed_at IS NOT NULL THEN 'closed' ELSE t.principal_state END,
   'locked'::text,0::numeric,p.id,'gift'::text,0::numeric
  FROM public.ca_promo_play_through_grants g JOIN public.ca_promo_profit_fee_phases p ON p.grant_id=g.id
  LEFT JOIN public.fx_truth t ON t.grant_id=g.id
  WHERE g.club_id=p_club AND g.user_id=p_user ORDER BY p.activated_at,p.id;
END $f$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- What the migration's probe reaches on its way to an add-on receipt replay.
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.fn_caller_session_is_live() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.entry_purchase_idempotency_receipts(key_domain text NOT NULL, idempotency_key text NOT NULL, request jsonb NOT NULL,
 response jsonb, claimed_at timestamptz NOT NULL, completed_at timestamptz, PRIMARY KEY(key_domain,idempotency_key));
""" % {'cost': LIVE_COST}

# account shape -> list of (grant open?, principal_state, custody kind, custody amount)
SHAPES = {
    'closed_grant_only': [(False, 'closed', 'event', 0)],
    'open_grant_event_principal': [(True, 'locked', 'event', 30)],
    'met_open_grant': [(True, 'met_pending', 'event', 30)],
}


def main():
    if not (PG / 'initdb').exists():
        sys.exit(f'PostgreSQL binaries not found at {PG}; set PG_BIN')
    fix = {f['signature']: f for f in json.loads(FIX.read_text())['functions']}
    tmp = Path(tempfile.mkdtemp(prefix='rebuy-promo-'))
    data, sock = tmp / 'data', tmp / 'sock'
    sock.mkdir()
    as_user = []
    if os.geteuid() == 0:
        as_user = ['runuser', '-u', 'postgres', '--']
        subprocess.run(['chown', '-R', 'postgres', str(tmp)], check=True)
    run = lambda *a: subprocess.run(as_user + [str(x) for x in a], check=True, capture_output=True, text=True)
    run(PG / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust')
    with open(data / 'postgresql.conf', 'a') as f:
        f.write(f"\nlisten_addresses=''\nunix_socket_directories='{sock}'\nport=55444\n")
    run(PG / 'pg_ctl', '-D', data, '-l', tmp / 'log', '-w', 'start')

    def psql(sql=None, file=None, ok=True):
        r = subprocess.run(as_user + [str(PG / 'psql'), '-h', str(sock), '-p', '55444', '-U', 'postgres', '-X', '-q', '-At',
                           '-v', 'ON_ERROR_STOP=1'] + (['-f', str(file)] if file else ['-c', sql]),
                           capture_output=True, text=True)
        if ok and r.returncode != 0:
            raise AssertionError(f'psql failed: {r.stderr}\n{(sql or file)!s:.400}')
        return r

    one = lambda sql: psql(sql).stdout.strip()
    md5 = lambda sig: one(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))")
    asserts = 0

    def check(label, cond):
        nonlocal asserts
        if not cond:
            raise AssertionError(label)
        asserts += 1
        print('PASS', label, flush=True)

    def world(tag, shape, snapshot):
        u = f"md5('{tag}:{shape}:u')::uuid"
        sql = [f"INSERT INTO club_members VALUES('{CLUB}',{u},100) ON CONFLICT DO NOTHING;"]
        for i, (open_, state, kind, amount) in enumerate(SHAPES[shape]):
            g = f"md5('{tag}:{shape}:{i}:g')::uuid"
            sql.append(f"""INSERT INTO ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,cycle_started_at,expires_at,closed_at,close_reason)
              VALUES({g},'{CLUB}',{u},30,30,4,'club_promo','{tag}:{shape}:{i}',now(),now()+interval '30 days',
                     {'NULL' if open_ else 'now()'},{'NULL' if open_ else "'spent'"});
              INSERT INTO ca_promo_profit_gates VALUES({g},NULL);
              INSERT INTO ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES({g},'gift',{g});
              INSERT INTO fx_truth VALUES({g},'{state}');""")
            if amount:
                ent = u if kind == 'player_wallet' else f"'{EVENT}'"
                sql.append(f"INSERT INTO ca_promo_principal_custody VALUES({g},'{kind}',{ent},{amount});")
        psql('\n'.join(sql))
        if snapshot:
            psql(f"SELECT fn_ca_promo_fee_state_refresh('{CLUB}',{u})")
        return u

    try:
        psql(SCHEMA)
        snap = SNAPSHOT.read_text()
        psql(snap[snap.index('-- Everything the recomputation reads'):snap.index('-- A cash-out is always answered')])
        lane = LANE.read_text()
        start = lane.index('CREATE FUNCTION public.fn_ca_share_tournament_lane_for_rebuy')
        psql(lane[start:lane.index('$function$;', start) + len('$function$;')])
        psql(fix['public.fn_ca_promo_play_through_state(uuid,uuid)']['definition'])
        psql('SET check_function_bodies=off;\n' + fix[REBUY]['definition'])
        for sig, f in fix.items():
            check(f'fixture {sig.split("(")[0]} is its pinned body (md5 {f["md5"]})', md5(sig) == f['md5'])
        for sig, want in SNAP_MD5.items():
            check(f'{sig.split("(")[0]} from its migration is the production body (md5 {want})', md5(sig) == want)

        pre_src = one(f"SELECT prosrc FROM pg_proc WHERE oid='{REBUY}'::regprocedure")
        psql(file=MIGRATION)
        new_rebuy = md5(REBUY)
        check(f'@live-proof pins the installed md5 ({new_rebuy})', f"'{new_rebuy}'" in MIGRATION.read_text())

        # ---- the rebuy post-image -------------------------------------------
        body = one(f"SELECT prosrc FROM pg_proc WHERE oid='{REBUY}'::regprocedure")
        ensure_at = body.find('fn_ca_promo_fee_state_ensure(tp.club_id,p_user_id)')
        lane_at = body.find('PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);')
        check('the rebuy makes the snapshot current before it takes the event lane', 0 < ensure_at < lane_at)
        check('and only for an open-grant holder', 'g.closed_at IS NULL' in body[ensure_at:lane_at])
        # Run the inserted block exactly as installed.
        block = body[body.rfind('\n', 0, body.rfind('-- 20261119054539', 0, ensure_at)) + 1:body.rfind('\n', 0, lane_at) + 1]
        check('the rest of the rebuy is byte for byte the pre-image', body.replace(block, '', 1) == pre_src)
        block_sql = block.replace('p_tournament_id', f"'{EVENT}'::uuid").replace('p_user_id', '__USER__')

        def prefetch(u):
            return block_sql.replace('__USER__', u)

        holder = world('rb', 'open_grant_event_principal', False)
        plain = world('rb', 'closed_grant_only', False)
        psql(f"INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{EVENT}',{holder},'{CLUB}'),('{EVENT}',{plain},'{CLUB}')")
        psql('TRUNCATE fx_calls')
        psql(f"DO $x$BEGIN {prefetch(plain)} END$x$")
        check('a holder with no open grant pays nothing before the lane', one("SELECT count(*) FROM fx_calls") == '0')
        psql(f"DO $x$BEGIN {prefetch(holder)} END$x$")
        check('an open-grant holder with a stale snapshot is brought current before the lane',
              one("SELECT count(*) FROM fx_calls WHERE fn='live'") == '1'
              and one(f"SELECT fn_ca_promo_fee_state_is_current('{CLUB}',{holder})") == 't')

        # Inside the lane the settle now reads the snapshot, and decides the same.
        met = world('rb', 'met_open_grant', False)
        psql(f"INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{EVENT}',{met},'{CLUB}')")
        # A release is still decided on the live fee history (one read, as
        # before); a grant with nothing to release reads none in the lane.
        for u, want, live_in_lane in ((holder, 'open', '0'), (met, 'met', '1')):
            psql(f"DO $x$BEGIN {prefetch(u)} END$x$")
            r = psql(f"""BEGIN; SET LOCAL track_functions='all';
              SELECT 'closed:'||fn_ca_promo_play_through_settle('{CLUB}',{u});
              SELECT 'live:'||COALESCE(pg_stat_get_xact_function_calls('public.fn_ca_promo_shared_fee_state_live(uuid,uuid)'::regprocedure),0);
              COMMIT;""").stdout.split()
            got = dict(l.split(':', 1) for l in r if ':' in l)
            reason = one(f"SELECT coalesce(close_reason,'open') FROM ca_promo_play_through_grants WHERE user_id={u}")
            check(f'after the block the in-lane settle reads the fee history {live_in_lane} time(s) and the {want} grant ends {reason}',
                  got['live'] == live_in_lane and reason == want)

        # ---- two purchases of one event: what the second one waits for ------
        def purchase(u, order, out, key):
            inside = (f"PERFORM fn_ca_promo_play_through_settle('{CLUB}',{u}); PERFORM pg_sleep({IN_LANE_WORK});")
            lane_sql = f"PERFORM fn_ca_share_tournament_lane_for_rebuy('{EVENT}',{u});"
            body_sql = (prefetch(u) + lane_sql if order == 'after' else lane_sql) + inside
            t0 = time.monotonic()
            psql(f"BEGIN; DO $x$BEGIN {body_sql} INSERT INTO fx_calls(fn,a) VALUES('lane_at',{u}); END$x$; COMMIT;")
            out[key] = time.monotonic() - t0

        def race(order):
            psql("TRUNCATE ca_promo_fee_state_cache, fx_calls")
            a = world(f'race{order}', 'open_grant_event_principal', False)
            b = world(f'race{order}b', 'open_grant_event_principal', False)
            psql(f"INSERT INTO tournament_players(tournament_id,user_id,club_id) VALUES('{EVENT}',{a},'{CLUB}'),('{EVENT}',{b},'{CLUB}')")
            out = {}
            ta = threading.Thread(target=purchase, args=(a, order, out, 'a'))
            ta.start()
            time.sleep(0.05)
            tb = threading.Thread(target=purchase, args=(b, order, out, 'b'))
            tb.start()
            ta.join(); tb.join()
            return out
        old, new = race('before'), race('after')
        # Before, the second purchase queues behind the first's recomputation
        # and its own; after, both recomputations run outside the lane.
        check(f'two purchases of one event, recomputation inside the lane: the second took {old["b"]*1000:.0f} ms',
              old['b'] >= 2 * LIVE_COST + IN_LANE_WORK - 0.05)
        check(f'recomputation before the lane: the second took {new["b"]*1000:.0f} ms '
              f'(waits only for {IN_LANE_WORK*1000:.0f} ms of in-lane work)', new['b'] < old['b'] - LIVE_COST + 0.1)

        again = psql(file=MIGRATION, ok=False)
        check('the guard refuses a second apply', again.returncode != 0 and 'revalidate before moving its promo read' in again.stderr)
        check('and leaves the installed body as it was', md5(REBUY) == new_rebuy)
        print(f'PASS {asserts} assertions; second purchase of one event waited {old["b"]*1000:.0f} ms before, '
              f'{new["b"]*1000:.0f} ms after; installed md5 {new_rebuy}')
    finally:
        subprocess.run(as_user + [str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
