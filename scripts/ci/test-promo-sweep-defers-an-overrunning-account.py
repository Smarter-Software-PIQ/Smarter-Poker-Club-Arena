#!/usr/bin/env python3
"""Native PG17 proof for 20261124170034 (promo sweep defers an account that
outruns its budget).

Builds two databases on one real PostgreSQL 17 cluster from the same stubs and
the live sweep definition (installed by 20261123073141, whose body is the live
one): `before` stops there, `after` also applies 20261124170034. Then proves:

Mechanism (why the fix has this shape):
  M1. A statement_timeout set inside a procedure (SET LOCAL / set_config,
      before or after an in-procedure COMMIT) never fires.
  M2. "SET ...; CALL committing_procedure()" fails with "invalid transaction
      termination" (pg_cron sends the command as one string).
  M3. The CALL's own (role-level) statement_timeout does span the procedure's
      COMMITs and is trappable as query_canceled.

Defect, before the fix (fails before):
  B1. A run whose statement_timeout fires inside one account's LOOK fails.
  B2. That account sorts first next run, fails it again, and an account behind
      it is never swept (starvation).

Fix, after the migration:
  A1. The same run succeeds; accounts before the slow one are swept; the slow
      account's refresh is rolled back (cache row and computed_at watermark
      unchanged, last_swept_at unchanged) and it is marked
      'deferred: run budget'; the run stops there.
  A2. The next run sweeps the starved account FIRST and the deferred one last.
  A3. Once the account is fast again it is swept and the mark is cleared.
  A4. A never-swept account that is deferred gets last_swept_at -infinity and
      is still a candidate.
  A5. LOOK waits at most ~1 s on a row lock ('busy', no state write) where the
      old definition waited for the whole lock.
  A6. Equivalence: with no timer pressure, the eight idle/active/floor/
      signature/out-of-band/ACT scenarios of 20261123073141 give identical
      refreshes, grant closures, gate unlocks and sweep-state errors in both
      databases, and a second tick sweeps nothing in either.
  A7. Idempotent re-apply; @live-proof holds; anchors refuse a foreign body.
No production endpoint or credentials are accepted.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRIOR = ROOT / 'supabase/migrations/20261123073141_promo_fee_sweep_skips_idle_accounts_and_avoids_minute_forty_.sql'
MIGRATION = ROOT / 'supabase/migrations/20261124170034_promo_sweep_defers_an_account_that_outruns_its_budget.sql'
# Production, 2026-11-24 (read-only): md5(pg_get_functiondef(...)) of the live
# sweep, and of the definition this migration produced when its DO block was
# run against production inside a transaction that was then rolled back.
LIVE_DEF_MD5 = '6a84a40026700d792f2bec9ba41970cd'
LIVE_AFTER_DEF_MD5 = '0e091543e181e4031b2dea388d50a27f'


def _live_fee_events_sql():
    # The exact live fn_ca_promo_fee_events that 20261123073141 rewrites; kept
    # in one place (the 20261123073141 proof) so both proofs install the same.
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'promo_sweep_idle_proof', Path(__file__).with_name('test-promo-sweep-idle-and-lateral-clock.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.LIVE_FEE_EVENTS_SQL


def uid(label):
    return str(uuid.UUID(hashlib.md5(label.encode()).hexdigest()))


STUBS = r"""
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cron.job j SET schedule = COALESCE(alter_job.schedule, j.schedule), command = COALESCE(alter_job.command, j.command)
   WHERE j.jobid = alter_job.job_id;
END $$;
INSERT INTO cron.job(jobid, jobname, schedule, command) VALUES
  (570, 'ca-promo-profit-hourly-sweep', '*/2 * * * *', 'CALL public.sp_ca_promo_profit_hourly_sweep(15)'),
  (275, 'tourney_payout_sweep_detect_daily', '31 2 * * *', 'SELECT (public.fn_tournament_payout_sweep(30, false, 150000) ->> ''ok'') = ''true'';');
CREATE TABLE ca_promo_play_through_settings(id boolean PRIMARY KEY, enforced_from timestamptz);
INSERT INTO ca_promo_play_through_settings VALUES(true, clock_timestamp() - interval '10 days');
CREATE TABLE rake_attributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hand_id uuid, player_id uuid, club_id uuid, rake_amount numeric, created_at timestamptz DEFAULT clock_timestamp());
CREATE INDEX idx_rake_attributions_player_id ON rake_attributions(player_id, created_at DESC);
CREATE TABLE ca_promo_cash_hand_clocks(hand_id uuid PRIMARY KEY, accepted_at timestamptz);
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, committed_at timestamptz);
CREATE TABLE accounting_tournament_fee_sources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rake_record_id uuid, tournament_id uuid, club_id uuid, player_id uuid, charged_at timestamptz, rake_credit numeric, source_charge_ledger_id uuid);
CREATE TABLE ca_promo_event_fee_consumption_receipts(charge_ledger_id uuid PRIMARY KEY, club_id uuid, player_id uuid, earned_at timestamptz);
CREATE TABLE ca_promo_play_through_grants(id uuid PRIMARY KEY, club_id uuid, user_id uuid, granted_at timestamptz DEFAULT clock_timestamp(), closed_at timestamptz, close_reason text, remaining numeric DEFAULT 10);
CREATE TABLE ca_promo_profit_gates(grant_id uuid PRIMARY KEY REFERENCES ca_promo_play_through_grants(id), unlocked_at timestamptz);
CREATE TABLE ca_promo_profit_overrides(grant_id uuid PRIMARY KEY);
CREATE TABLE ca_promo_profit_sweep_state(club_id uuid, user_id uuid, last_swept_at timestamptz NOT NULL, last_ms integer, last_error text, PRIMARY KEY(club_id, user_id));
CREATE TABLE ca_promo_fee_state_cache(club_id uuid, user_id uuid, computed_at timestamptz, valid_until timestamptz, signature text, state jsonb, PRIMARY KEY(club_id, user_id));
CREATE TABLE refresh_log(club_id uuid, user_id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE slow_accounts(user_id uuid PRIMARY KEY, seconds numeric);
CREATE FUNCTION public.fn_ca_promo_cash_fee_clock_missing(p_hand uuid) RETURNS numeric LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'cash_fee_clock_missing:%', p_hand; END $$;
CREATE FUNCTION public.fn_ca_promo_original_entry_fee_events(p_club uuid, p_user uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(earned_at timestamptz, fee_credit numeric) LANGUAGE sql STABLE AS $$ SELECT NULL::timestamptz, NULL::numeric WHERE false $$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_promo_fee_state_signature(p_club uuid, p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(COALESCE(string_agg(g.id::text || ':' || COALESCE(g.closed_at::text,'open') || ':' || COALESCE(w.unlocked_at::text,'locked'), ',' ORDER BY g.id), ''))
    FROM public.ca_promo_play_through_grants g LEFT JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
   WHERE g.club_id = p_club AND g.user_id = p_user;
$$;
-- Same contract as production: writes the cache row (upsert), returns true.
-- An account listed in slow_accounts spends that long after logging, so a
-- timer that fires there rolls the log row and the cache write back.
CREATE FUNCTION public.fn_ca_promo_fee_state_refresh(p_club uuid, p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_sig text; v_state jsonb;
BEGIN
  INSERT INTO public.refresh_log(club_id, user_id) VALUES (p_club, p_user);
  PERFORM pg_sleep(s.seconds) FROM public.slow_accounts s WHERE s.user_id = p_user;
  v_sig := public.fn_ca_promo_fee_state_signature(p_club, p_user);
  SELECT COALESCE(state, '[]'::jsonb) INTO v_state FROM public.ca_promo_fee_state_cache WHERE club_id=p_club AND user_id=p_user;
  INSERT INTO public.ca_promo_fee_state_cache(club_id, user_id, computed_at, valid_until, signature, state)
  VALUES (p_club, p_user, clock_timestamp(), clock_timestamp() + interval '30 days', v_sig, COALESCE(v_state, '[]'::jsonb))
  ON CONFLICT (club_id, user_id) DO UPDATE
    SET computed_at = EXCLUDED.computed_at, valid_until = EXCLUDED.valid_until, signature = EXCLUDED.signature;
  RETURN true;
END $$;
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', type=Path, required=True)
    a = ap.parse_args()
    if os.environ.get('DATABASE_URL'):
        raise SystemExit('remote database forbidden')
    pg = a.pg_bin.resolve()
    scratch = Path(tempfile.mkdtemp(prefix='psdo-'))
    sock = Path(tempfile.mkdtemp(prefix='psdo-', dir='/tmp'))  # unix socket paths are short
    port = '54445'
    PSQL_ENV = dict(os.environ, PGTZ='UTC')
    started = False
    results = []

    def run(sql, db='postgres', timeout=90):
        return subprocess.run(
            [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
             '-h', str(sock), '-p', port, '-U', 'postgres', '-d', db],
            input=sql, text=True, capture_output=True, timeout=timeout, env=PSQL_ENV,
        )

    def ok(sql, db='postgres'):
        p = run(sql, db)
        if p.returncode:
            raise RuntimeError(p.stderr + '\n' + sql[:600])
        return p.stdout.strip()

    def one(sql, db):
        """Send exactly one query string, as pg_cron does (psql -c)."""
        return subprocess.run(
            [str(pg / 'psql'), '-X', '-qAt', '-h', str(sock), '-p', port, '-U', 'postgres', '-d', db, '-c', sql],
            text=True, capture_output=True, timeout=90, env=PSQL_ENV,
        )

    def check(label, good):
        results.append({'check': label, 'ok': bool(good)})
        print(('PASS ' if good else 'FAIL ') + label, flush=True)
        return good

    try:
        env = dict(os.environ, LC_ALL=os.environ.get('LC_ALL', 'C'))
        subprocess.run([pg / 'initdb', '-D', scratch / 'data', '-U', 'postgres', '-A', 'trust'],
                       check=True, capture_output=True, env=env)
        subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-w',
                        '-o', f"-p {port} -k {sock} -c listen_addresses=''",
                        '-l', scratch / 'server.log', 'start'],
                       check=True, capture_output=True, env=env)
        started = True
        good = True

        # ---------------------------------------------------------------- M1-M3
        ok("""
CREATE TABLE m(i int);
CREATE PROCEDURE m_arm(mode text) LANGUAGE plpgsql AS $$
BEGIN
  IF mode = 'local' THEN PERFORM set_config('statement_timeout', '700ms', true);
  ELSIF mode = 'session' THEN PERFORM set_config('statement_timeout', '700ms', false);
  ELSE PERFORM set_config('statement_timeout', '700ms', false); COMMIT; END IF;
  BEGIN PERFORM pg_sleep(1.6); INSERT INTO m VALUES (1);
  EXCEPTION WHEN query_canceled THEN INSERT INTO m VALUES (-1); END;
END $$;
CREATE PROCEDURE m_loop() LANGUAGE plpgsql AS $$
BEGIN
  FOR k IN 1..6 LOOP
    BEGIN INSERT INTO m VALUES (k); PERFORM pg_sleep(0.5);
    EXCEPTION WHEN query_canceled THEN INSERT INTO m VALUES (-k); COMMIT; RETURN; END;
    COMMIT;
  END LOOP;
END $$;
""")
        for mode in ('local', 'session', 'commit'):
            ok(f"TRUNCATE m; CALL m_arm('{mode}');")
            good &= check(f'M1 statement_timeout armed inside a procedure ({mode}) never fires',
                          ok('SELECT array_agg(i) FROM m') == '{1}')
        ok('TRUNCATE m;')
        p = one("SET statement_timeout = '1200ms'; CALL m_loop()", 'postgres')
        good &= check('M2 "SET ...; CALL" in one string fails: invalid transaction termination',
                      p.returncode != 0 and 'invalid transaction termination' in p.stderr)
        ok("TRUNCATE m; ALTER ROLE postgres SET statement_timeout = '1200ms';")
        p = one('CALL m_loop()', 'postgres')
        ok('ALTER ROLE postgres RESET statement_timeout;')
        rows = ok('SELECT array_agg(i ORDER BY i) FROM m')
        good &= check('M3 the CALL\'s own timer spans in-procedure COMMITs and is trapped as query_canceled',
                      p.returncode == 0 and rows in ('{-3,1,2}', '{-4,1,2,3}'))

        # ---------------------------------------------------------------- setup
        for db in ('before', 'after'):
            ok(f'CREATE DATABASE {db};')
            ok(STUBS, db)
            ok(_live_fee_events_sql(), db)
            ok(PRIOR.read_text(), db)
        defmd5 = "SELECT md5(pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure))"
        good &= check('fixture installs exactly the live sweep definition (production md5)', ok(defmd5, 'before') == LIVE_DEF_MD5)
        ok(MIGRATION.read_text(), 'after')
        good &= check('migration produces exactly the definition it produced on production (rolled-back probe md5)',
                      ok(defmd5, 'after') == LIVE_AFTER_DEF_MD5)

        club = uid('club')

        def sorted_users(tags):
            # The sweep orders never-swept accounts by (club_id, user_id).
            return sorted(tags, key=lambda t: uid('u:' + t))

        def add_grant(db, tag):
            u, g = uid('u:' + tag), uid('g:' + tag)
            ok(f"INSERT INTO ca_promo_play_through_grants(id, club_id, user_id) VALUES ('{g}', '{club}', '{u}');"
               f"INSERT INTO ca_promo_profit_gates(grant_id) VALUES ('{g}');", db)
            return u

        def refreshes(db, tag):
            return int(ok(f"SELECT count(*) FROM refresh_log WHERE user_id='{uid('u:' + tag)}'", db))

        def state(db, tag):
            return ok(f"SELECT coalesce(last_swept_at::text,'') || '|' || coalesce(last_error,'') FROM ca_promo_profit_sweep_state WHERE user_id='{uid('u:' + tag)}'", db)

        def cache(db, tag):
            return ok(f"SELECT coalesce(computed_at::text,'') FROM ca_promo_fee_state_cache WHERE user_id='{uid('u:' + tag)}'", db)

        def role_timeout(db, value):
            ok(f"ALTER ROLE postgres IN DATABASE {db} SET statement_timeout = '{value}';")

        def role_timeout_reset(db):
            ok(f"ALTER ROLE postgres IN DATABASE {db} RESET statement_timeout;")

        # Three never-swept accounts in sweep order: first, slow, starved.
        tags = sorted_users(['p', 'q', 'r'])
        first, slow, starved = tags
        # A fourth account with a cache row and an old sweep row, made slow, to
        # prove the watermark of an already-cached account is not touched.
        for db in ('before', 'after'):
            for t in tags:
                add_grant(db, t)
            ok(f"INSERT INTO slow_accounts VALUES ('{uid('u:' + slow)}', 6);", db)
            role_timeout(db, '2500ms')

        # ---------------------------------------------------------------- B1-B2
        p1 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', 'before')
        good &= check('B1 before: the run fails when the timer fires inside one account',
                      p1.returncode != 0 and 'statement timeout' in p1.stderr)
        p2 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', 'before')
        good &= check('B2 before: the same account sorts first, fails the next run too, and the account behind it is never swept',
                      p2.returncode != 0 and refreshes('before', starved) == 0 and state('before', slow) == '')

        # ---------------------------------------------------------------- A1-A4
        t0 = time.monotonic()
        a1 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', 'after')
        dt = time.monotonic() - t0
        good &= check('A1 after: the run succeeds and stops at the timer', a1.returncode == 0 and dt < 5)
        good &= check('A1 after: the account before the slow one is swept', refreshes('after', first) == 1 and state('after', first).endswith('|'))
        good &= check('A1 after: the slow account\'s look is rolled back (no refresh row, no cache row)',
                      refreshes('after', slow) == 0 and cache('after', slow) == '')
        good &= check('A4 after: a never-swept deferred account is marked with last_swept_at -infinity',
                      state('after', slow) == '-infinity|deferred: run budget')
        good &= check('A1 after: the run stops at the deferral (the next account waits)', refreshes('after', starved) == 0)

        a2 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', 'after')
        good &= check('A2 after: the next run sweeps the starved account before the deferred one',
                      a2.returncode == 0 and refreshes('after', starved) == 1 and state('after', slow) == '-infinity|deferred: run budget')

        ok(f"DELETE FROM slow_accounts;", 'after')
        a3 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', 'after')
        st = state('after', slow)
        good &= check('A3 after: once fast, the deferred account is swept and the mark is cleared',
                      a3.returncode == 0 and refreshes('after', slow) == 1 and st.endswith('|') and not st.startswith('-infinity'))

        # Watermark of an already-cached, already-swept account.
        w = 'w'
        uw = add_grant('after', w)
        sig = ok(f"SELECT fn_ca_promo_fee_state_signature('{club}','{uw}')", 'after')
        ok(f"""INSERT INTO ca_promo_fee_state_cache VALUES ('{club}','{uw}', '2026-01-01 00:00:00+00', clock_timestamp() + interval '1 day', 'stale-{sig}', '[]');
INSERT INTO ca_promo_profit_sweep_state VALUES ('{club}','{uw}', '2026-01-01 00:10:00+00', 40, NULL);
INSERT INTO slow_accounts VALUES ('{uw}', 6);""", 'after')
        a5 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', 'after')
        good &= check('A1 after: a cached account deferred mid-look keeps computed_at and last_swept_at exactly',
                      a5.returncode == 0 and cache('after', w) == '2026-01-01 00:00:00+00'
                      and state('after', w) == '2026-01-01 00:10:00+00|deferred: run budget')
        ok('DELETE FROM slow_accounts;', 'after')
        for db in ('before', 'after'):
            role_timeout_reset(db)

        # ---------------------------------------------------------------- A5
        lw = 'lockwait'
        for db in ('before', 'after'):
            ulw = add_grant(db, lw)
            ok(f"INSERT INTO ca_promo_fee_state_cache VALUES ('{club}','{ulw}', clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 day', 'stale', '[]');"
               f"INSERT INTO ca_promo_profit_sweep_state VALUES ('{club}','{ulw}', clock_timestamp() - interval '1 day', 40, NULL);", db)
        waits = {}
        for db in ('before', 'after'):
            holder = subprocess.Popen(
                [str(pg / 'psql'), '-X', '-qAt', '-h', str(sock), '-p', port, '-U', 'postgres', '-d', db, '-c',
                 f"BEGIN; SELECT 1 FROM ca_promo_fee_state_cache WHERE user_id='{uid('u:' + lw)}' FOR UPDATE; SELECT pg_sleep(4); COMMIT;"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(0.8)
            t0 = time.monotonic()
            r = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', db)
            waits[db] = (time.monotonic() - t0, r.returncode)
            holder.wait(timeout=30)
        good &= check('A5 before: LOOK waits for the whole row lock', waits['before'][1] == 0 and waits['before'][0] > 2.5)
        good &= check('A5 after: LOOK gives up within ~1 s and the run completes',
                      waits['after'][1] == 0 and waits['after'][0] < 2.0)
        good &= check('A5 after: a lock-busy look writes no sweep state (retried next run)',
                      state('after', lw).endswith('|') and not state('after', lw).startswith('-infinity'))

        # ---------------------------------------------------------------- A6
        def scenario(db):
            ok('TRUNCATE refresh_log;', db)
            def seed(tag, swept_ago, computed_ago, *, bad_sig=False, met=False):
                u = add_grant(db, 'e:' + tag)
                g = uid('g:e:' + tag)
                s = 'bad' if bad_sig else ok(f"SELECT fn_ca_promo_fee_state_signature('{club}','{u}')", db)
                st = json.dumps([{'grant_id': g, 'profit_target': 10, 'profit_earned': 10, 'phase_kind': 'gift', 'principal_state': 'met_pending'}]) if met else '[]'
                ok(f"INSERT INTO ca_promo_profit_sweep_state VALUES ('{club}','{u}', clock_timestamp() - interval '{swept_ago}', 50, NULL);"
                   f"INSERT INTO ca_promo_fee_state_cache VALUES ('{club}','{u}', clock_timestamp() - interval '{computed_ago}', clock_timestamp() + interval '30 days', '{s}', '{st}'::jsonb);", db)
                return u
            seed('idle', '2 hours', '2 hours')
            u = seed('rake', '2 hours', '2 hours')
            ok(f"INSERT INTO rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES ('{uid('h:rake')}', '{u}', '{club}', 1, clock_timestamp() - interval '30 minutes');", db)
            u = seed('tourn', '2 hours', '2 hours')
            ok(f"INSERT INTO accounting_tournament_fee_sources(club_id, player_id, charged_at, rake_credit) VALUES ('{club}', '{u}', clock_timestamp() - interval '20 minutes', 2);", db)
            u = seed('entry', '2 hours', '2 hours')
            ok(f"INSERT INTO ca_promo_event_fee_consumption_receipts VALUES ('{uid('cr:' + db)}', '{club}', '{u}', clock_timestamp() - interval '15 minutes');", db)
            seed('floor', '2 hours', '7 hours')
            seed('sig', '10 minutes', '10 minutes', bad_sig=True)
            seed('oob', '2 hours', '1 minute')
            u = seed('act', '2 hours', '2 hours', met=True)
            ok(f"INSERT INTO rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES ('{uid('h:act')}', '{u}', '{club}', 1, clock_timestamp() - interval '10 minutes');", db)
            g2 = uid('g:e:act2:' + db)
            ok(f"INSERT INTO ca_promo_play_through_grants(id, club_id, user_id) VALUES ('{g2}', '{club}', '{u}'); INSERT INTO ca_promo_profit_gates(grant_id) VALUES ('{g2}');", db)
            ok(f"UPDATE ca_promo_fee_state_cache SET signature = fn_ca_promo_fee_state_signature('{club}','{u}') WHERE user_id='{u}';", db)
            r1 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', db)
            users = ','.join(f"'{uid('u:e:' + t)}'" for t in ('idle', 'rake', 'tourn', 'entry', 'floor', 'sig', 'oob', 'act'))
            out1 = ok(f"""SELECT string_agg(x, ';' ORDER BY x) FROM (
  SELECT 'refresh:' || g.user_id || ':' || (SELECT count(*) FROM refresh_log l WHERE l.user_id = g.user_id) x
    FROM (SELECT DISTINCT user_id FROM ca_promo_play_through_grants WHERE user_id IN ({users})) g
  UNION ALL SELECT 'closed:' || id || ':' || coalesce(close_reason,'-') FROM ca_promo_play_through_grants WHERE user_id IN ({users})
  UNION ALL SELECT 'gate:' || w.grant_id || ':' || (w.unlocked_at IS NOT NULL) FROM ca_promo_profit_gates w JOIN ca_promo_play_through_grants g ON g.id = w.grant_id WHERE g.user_id IN ({users})
  UNION ALL SELECT 'err:' || user_id || ':' || coalesce(last_error,'-') FROM ca_promo_profit_sweep_state WHERE user_id IN ({users})) z""", db)
            ok('TRUNCATE refresh_log;', db)
            r2 = one('CALL public.sp_ca_promo_profit_hourly_sweep(15)', db)
            out2 = ok('SELECT count(*) FROM refresh_log', db)
            return r1.returncode, ';'.join(sorted(out1.replace(g2, 'G2').split(';'))), r2.returncode, out2

        b = scenario('before')
        a = scenario('after')
        if b[1] != a[1] or b[0] or a[0]:
            print('A6 before:', b, '\nA6 after: ', a, flush=True)
        good &= check('A6 equivalence: identical refreshes, closures, unlocks and errors with no timer pressure',
                      b[0] == 0 and a[0] == 0 and b[1] == a[1] and 'closed:' + uid('g:e:act') + ':met' in a[1])
        good &= check('A6 equivalence: a second immediate tick sweeps nothing in either', b[2] == a[2] == 0 and b[3] == a[3] == '0')

        # ---------------------------------------------------------------- A7
        h1 = ok("SELECT md5(pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure))", 'after')
        ok(MIGRATION.read_text(), 'after')
        h2 = ok("SELECT md5(pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure))", 'after')
        good &= check('A7 migration is idempotent', h1 == h2)
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        good &= check('A7 @live-proof holds after, and does not hold before',
                      ok(f'SELECT {proof}', 'after') == 't' and ok(f'SELECT {proof}', 'before') == 'f')
        ok('CREATE DATABASE foreign_body;')
        ok(STUBS, 'foreign_body')
        ok(_live_fee_events_sql(), 'foreign_body')
        ok("CREATE PROCEDURE public.sp_ca_promo_profit_hourly_sweep(p_budget_seconds integer DEFAULT 15) LANGUAGE plpgsql AS $p$ BEGIN NULL; END $p$;", 'foreign_body')
        pf = run(MIGRATION.read_text(), 'foreign_body')
        good &= check('A7 anchors refuse a body that is not the live one', pf.returncode != 0 and 'anchor 1 is not present exactly once' in pf.stderr)

        print(json.dumps({'status': 'passed' if good else 'failed', 'checks': len(results),
                          'failed': [r['check'] for r in results if not r['ok']]}))
        if not good:
            sys.exit(1)
    finally:
        if started:
            subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == '__main__':
    main()
