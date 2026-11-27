#!/usr/bin/env python3
"""Native proof for 20261121011654_a_person_beating_the_plo_horses_reaches_production_alerts (PostgreSQL 17, never production).

The Production Alerts inbox and the owner page route are built exactly as the
three-am readiness proof builds them (scripts/ci/fixtures/engine-cutover-preimages.json,
then the installed migrations 20261109024836, 20261109182123 and 20261119234116), with
the owner page trigger on operational_alert_events. Hands are fixtures in the shapes of
public.hand_history, public.ca_hand_facts, public.profiles and public.lightning_hand:

  * the exact migration installs and its live proof holds; the warning maps to no owner
    page kind;
  * the per-hand split equals an independent Python computation of the rake-free
    pro-rata flow (real and EV) to the last digit, window by window;
  * a person above +2 SE (EV-adjusted) over a full 500-hand window raises ONE warning for
    the Production Alerts fleet (target_task_id) with windows and the leak breakdown, and
    pages nobody;
  * a person who wins real chips only by running above equity in all-in pots (EV flat) is
    not flagged; a person with fewer than 500 hands is never flagged;
  * Horse-only hands, tournaments, bomb pots and hands older than 60 days are not read;
  * a repeat run bumps the same row; a run that finds no window above +2 SE resolves it;
    the next episode raises a new row;
  * a dry run writes nothing; the run table keeps every run.
"""
import json
import math
import os
import random
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
CUTOVER = MIGRATIONS / '20261109024836_a_missed_engine_cutover_and_a_failing_lobby_close_page_the_o.sql'
INSTALL_WATCH = MIGRATIONS / '20261109182123_a_merged_migration_still_uninstalled_after_an_hour_pages_the.sql'
READINESS = MIGRATIONS / '20261119234116_the_3_am_check_says_whether_the_4_am_cutover_will_ship.sql'
MIGRATION = MIGRATIONS / '20261121011654_a_person_beating_the_plo_horses_reaches_production_alerts.sql'
# The hands helper as production runs it now: the same body through RETURN QUERY EXECUTE,
# so every call gets a custom plan for its own window. Every case below runs against it.
PLANNED = MIGRATIONS / '20261122094628_the_horse_exposure_hands_are_planned_for_their_own_window.sql'
# The watch as production runs it from 20261127043816: step 3 (the leak breakdown) reads one hand at a time.
# The dry run below is answered by both definitions and must be identical; every later case runs against it.
BOUNDED = MIGRATIONS / '20261127043816_three_monitors_read_their_windows_by_index_instead_of_per_ro.sql'
PREIMAGES = json.loads((ROOT / 'scripts/ci/fixtures/engine-cutover-preimages.json').read_text())
FLEET = '01a09b86-5ba8-7290-8657-1041f13dd3ca'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


CUTOVER_TEST = (ROOT / 'scripts/ci/test-a-missed-engine-cutover-is-paged.py').read_text()
SCHEMA = re.search(r'^SCHEMA = r"""(.*?)"""', CUTOVER_TEST, re.S | re.M).group(1) + r"""
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE FUNCTION cron.unschedule(j bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = j RETURNING true $$;
CREATE FUNCTION public.fn_ca_installed_migration_listing() RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp' AS $$
  SELECT coalesce(json_agg(json_build_array(m.version, m.name) ORDER BY m.version, m.name), '[]'::json)
    FROM supabase_migrations.schema_migrations m $$;
CREATE TABLE public.v_spin_unfilled_waits (tournament_id uuid, name text, longest_wait interval);
CREATE TABLE public.tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, status text, started_at timestamptz);
CREATE TABLE public.sp_settings (key text PRIMARY KEY, value numeric);
CREATE FUNCTION public.fn_sp_setting(k text, d numeric) RETURNS numeric LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT value FROM public.sp_settings WHERE key = k), d) $$;

-- The hand tables this watch reads (columns it uses, production types).
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean);
CREATE TABLE public.hand_history (id uuid PRIMARY KEY, created_at timestamptz NOT NULL, has_human boolean,
  game_variant text, tournament_id uuid, bomb_pot jsonb, actions jsonb, hand_number integer);
CREATE INDEX idx_hand_history_human_created ON public.hand_history USING btree (created_at) WHERE has_human;
CREATE TABLE public.ca_hand_facts (hand_id uuid NOT NULL, user_id uuid NOT NULL, seat smallint, game_variant text,
  tournament_id uuid, played_at timestamptz, net_bb numeric, ev_net_bb numeric, was_all_in boolean,
  went_to_showdown boolean, PRIMARY KEY (hand_id, user_id));
-- The reliability controller's class table and classifier, as production has them (columns and function text).
CREATE TABLE smarter_private.reliability_alert_classes (id serial PRIMARY KEY, priority integer NOT NULL,
  source_pattern text NOT NULL DEFAULT '%', alertname_pattern text NOT NULL DEFAULT '%', severity_pattern text NOT NULL DEFAULT '%',
  incident_class text NOT NULL, default_severity text NOT NULL DEFAULT 'warning', escalate_immediately boolean NOT NULL DEFAULT false,
  is_incident boolean NOT NULL DEFAULT true, note text, hold_down_seconds integer, hold_down_flaps integer,
  hold_down_flap_window_seconds integer, quiet_window_seconds integer NOT NULL DEFAULT 1800,
  UNIQUE (source_pattern, alertname_pattern, severity_pattern));
INSERT INTO smarter_private.reliability_alert_classes (priority, incident_class, default_severity, escalate_immediately, is_incident)
  VALUES (1000, 'unclassified', 'warning', true, true);
CREATE FUNCTION smarter_private.reliability_classify(p_source text, p_alertname text, p_severity text, p_resolved boolean)
 RETURNS smarter_private.reliability_alert_classes LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'smarter_private' AS $f$
  SELECT c FROM smarter_private.reliability_alert_classes c
   WHERE p_source ILIKE c.source_pattern AND p_alertname ILIKE c.alertname_pattern
     AND CASE WHEN p_resolved THEN c.is_incident ELSE lower(p_severity) ILIKE c.severity_pattern END
   ORDER BY c.priority, c.id LIMIT 1 $f$;
CREATE TABLE public.lightning_hand (hand_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hand_history_id uuid, hand_number integer);
CREATE UNIQUE INDEX lightning_hand_one_per_hand_number ON public.lightning_hand USING btree (hand_number) WHERE (hand_number IS NOT NULL);
"""

STAGES = ('preflop', 'flop', 'turn', 'river')


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='exposure-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    passed = []
    try:
        def psql(args, text=None):
            return subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                   '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args],
                                  input=text, capture_output=True, text=True)

        def sql(text):
            r = psql(['-c', text])
            assert r.returncode == 0, f'{text[:400]}\n{r.stderr}'
            return r.stdout.strip()

        def ok(name):
            passed.append(name)
            print(f'ok - {name}')

        sql(SCHEMA)
        for sig in ('fn_record_operational_alert(text,text,text,text,text,jsonb)', 'fn_ca_owner_page_kind(text,text,text)',
                    'fn_ca_a_real_alert_reaches_the_owner()', 'fn_sp_daily_digest(date,boolean)'):
            r = psql([], PREIMAGES[sig] + ';')
            assert r.returncode == 0, f'{sig}: {r.stderr}'
        sql("CREATE TRIGGER zz_a_real_alert_reaches_the_owner AFTER INSERT ON public.operational_alert_events "
            "FOR EACH ROW WHEN (NEW.status = 'firing') EXECUTE FUNCTION public.fn_ca_a_real_alert_reaches_the_owner()")
        for f in (CUTOVER, INSTALL_WATCH):
            r = psql(['-f', str(f)])
            assert r.returncode == 0, f'{f.name}: {r.stderr}'
        sql("ALTER TABLE smarter_private.ca_merged_migration_watch ADD COLUMN IF NOT EXISTS superseded_by text, "
            "ADD COLUMN IF NOT EXISTS modified_at timestamptz, ADD COLUMN IF NOT EXISTS modified_sha text")
        r = psql(['-f', str(READINESS)])
        assert r.returncode == 0, f'{READINESS.name}: {r.stderr}'
        ok('the owner page route is rebuilt as production has it (readiness migration installed)')

        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
        assert sql("SELECT count(*) FROM smarter_private.ca_horse_exposure_runs") == '0', 'the probe must leave nothing'
        ok('the exact migration installs, its probe leaves nothing, and its live proof holds')
        r = psql(['-f', str(PLANNED)])
        assert r.returncode == 0, f'{PLANNED.name}: {r.stderr}'
        planned_proof = re.search(r'^-- @live-proof: (.+)$', PLANNED.read_text(), re.M).group(1)
        assert sql(f'SELECT {planned_proof}') == 't', 'the planned helper live proof must hold after install'
        assert sql("SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang "
                   "WHERE p.oid = to_regprocedure('smarter_private.fn_ca_horse_exposure_hands(timestamptz, integer)')") == 'plpgsql'
        ok('the hands helper is replaced by its EXECUTE form, and every case below runs against it')
        assert sql("SELECT (c).incident_class || ' ' || (c).is_incident || ' ' || (c).escalate_immediately FROM (SELECT smarter_private.reliability_classify('horse-exposure-watch', 'PersonBeatsHorsesBeyondTwoSE', 'warning', false) c) z") == 'horse_exposure_analysis false false'
        assert sql("SELECT (c).incident_class FROM (SELECT smarter_private.reliability_classify('another-source', 'PersonBeatsHorsesBeyondTwoSE', 'warning', false) c) z") == 'unclassified'
        ok('the reliability controller classifies the warning as never an incident and never escalated; other sources are untouched')

        rnd = random.Random(20261120)
        horses = [str(uuid.UUID(int=rnd.getrandbits(128))) for _ in range(8)]
        persons = {k: str(uuid.UUID(int=rnd.getrandbits(128))) for k in ('winner', 'flat', 'lucky', 'short', 'later')}
        sql('INSERT INTO public.profiles VALUES ' + ','.join(f"('{h}', true)" for h in horses) + ','
            + ','.join(f"('{p}', false)" for p in persons.values()))

        pending = []

        def flush():
            if pending:
                r = psql([], 'BEGIN;\n' + ';\n'.join(pending) + ';\nCOMMIT;\n')
                assert r.returncode == 0, r.stderr[:2000]
                pending.clear()

        hands = []   # python model: (hand_id, created_at, game, seats[(uid, horse, net, ev, allin, sd, foldst)], counted, ltg, es)

        def add_hand(t, person, pnet, pev=None, game='plo5', ltg=False, horse_only=False, tournament=False, bomb=False,
                     es=2, fold_street=None, allin=False, sd=False):
            hid = str(uuid.UUID(int=rnd.getrandbits(128)))
            hs = rnd.sample(horses, 3)
            pev = pnet if pev is None else pev
            seats = []
            if not horse_only:
                seats.append((person, False, pnet, pev, allin, sd, None))
            # Horses absorb the person's result plus rake: two losers and one winner, or the reverse.
            rake = 0.05 * abs(pnet)
            if pnet >= 0:
                a = rnd.uniform(0.2, 0.8)
                seats.append((hs[0], True, -(pnet + rake) * a, -(pev + rake) * a, allin, sd, fold_street))
                seats.append((hs[1], True, -(pnet + rake) * (1 - a), -(pev + rake) * (1 - a), False, False, 1))
                seats.append((hs[2], True, 0.0, 0.0, False, False, 0))
            else:
                seats.append((hs[0], True, -pnet - rake, -pev - rake, allin, sd, None))
                seats.append((hs[1], True, 0.0, 0.0, False, False, 0))
                seats.append((hs[2], True, 0.0, 0.0, False, False, 0))
            if horse_only:
                seats = [(hs[0], True, 5.0, 5.0, False, False, None), (hs[1], True, -5.25, -5.25, False, False, 1)]
            acts = [{'seat': 1, 'stage': 'preflop', 'action': 'bb', 'origin': 'forced'}]
            for i, (uid, horse, net, ev, ai, s, fs) in enumerate(seats):
                acts.append({'seat': i + 1, 'stage': 'preflop', 'action': 'call', 'origin': 'player'})
                if fs is not None:
                    acts.append({'seat': i + 1, 'stage': STAGES[fs], 'action': 'fold', 'origin': 'horse_policy'})
            acts.append({'seat': 1, 'stage': STAGES[es], 'action': 'check', 'origin': 'player'})
            hn = 1000000 + len(hands)
            pending.append("INSERT INTO public.hand_history VALUES ('%s', '%s', %s, '%s', %s, %s, $j$%s$j$, %d)" % (
                hid, t, 'false' if horse_only else 'true', game, f"'{uuid.uuid4()}'" if tournament else 'NULL',
                "'{\"kind\":\"bomb\"}'" if bomb else 'NULL', json.dumps(acts), hn))
            pending.append('INSERT INTO public.ca_hand_facts VALUES ' + ','.join(
                "('%s','%s',%d,'%s',%s,'%s',%r,%r,%s,%s)" % (hid, uid, i + 1, game, f"'{uuid.uuid4()}'" if tournament else 'NULL', t,
                                                            round(net, 6), round(ev, 6), str(ai).lower(), str(s).lower())
                for i, (uid, horse, net, ev, ai, s, fs) in enumerate(seats)))
            if ltg:
                pending.append(f"INSERT INTO public.lightning_hand (hand_history_id, hand_number) VALUES ('{hid}', {hn})")
            hands.append((hid, t, game, seats, not (horse_only or tournament or bomb), ltg, es))
            return hid

        import datetime as dt
        base = dt.datetime(2026, 11, 10, tzinfo=dt.timezone.utc)

        def ts(i):
            return (base + dt.timedelta(minutes=i)).strftime('%Y-%m-%d %H:%M:%S+00')

        # winner: 600 hands, +8 bb a hand on average, noisy; channels vary.
        times = [ts(i) for i in range(0, 3000, 5)]
        for i, t in enumerate(times):
            ch = i % 5
            add_hand(t, persons['winner'], rnd.gauss(8, 30), ltg=(i % 3 == 0), es=(0 if ch == 0 else 2),
                     fold_street=(2 if ch == 1 else None), allin=(ch == 2), sd=(ch == 3))
            add_hand(t, persons['flat'], rnd.gauss(0, 30))
            if i < 400:
                add_hand(t, persons['short'], rnd.gauss(30, 10))
            # lucky: real +12 a hand only from all-in run-outs; EV is zero-mean.
            add_hand(t, persons['lucky'], rnd.gauss(12, 30), pev=rnd.gauss(0, 30), allin=True)
        # not read: Horse-only, tournament, bomb pot, and a huge win 61 days before the run.
        for t in times[:20]:
            add_hand(t, persons['flat'], 500, horse_only=True)
            add_hand(t, persons['flat'], 500, tournament=True)
            add_hand(t, persons['flat'], 500, bomb=True)
        add_hand('2026-09-01 00:00:00+00', persons['flat'], 5000)
        at = ts(3000)
        flush()

        # Independent Python model of the split.
        def flows(at_s, horizon_days=60):
            out = {}
            at_t = dt.datetime.fromisoformat(at_s.replace(' ', 'T').replace('+00', '+00:00'))
            for hid, t, game, seats, counted, ltg, es in hands:
                tt = dt.datetime.fromisoformat(t.replace(' ', 'T').replace('+00', '+00:00'))
                if not counted or tt > at_t or tt <= at_t - dt.timedelta(days=horizon_days):
                    continue
                for col in (2, 3):
                    L = sum(-s[col] for s in seats if s[col] < 0)
                    for s in seats:
                        if s[1]:
                            continue
                        x = 0.0
                        if L > 0:
                            for h in seats:
                                if not h[1]:
                                    continue
                                if s[col] > 0 and h[col] < 0:
                                    x += s[col] * -h[col] / L
                                if s[col] < 0 and h[col] > 0:
                                    x += s[col] * h[col] / L
                        out.setdefault((s[0], game), {}).setdefault(hid, [tt, 0.0, 0.0])[col - 1] = x
            return out

        model = flows(at)
        rows = json.loads(sql(f"SELECT json_agg(json_build_array(user_id, game, hand_id, x_real, x_ev)) FROM smarter_private.fn_ca_horse_exposure_hands('{at}', 2500)"))
        assert len(rows) == sum(len(v) for v in model.values()), (len(rows), sum(len(v) for v in model.values()))
        for uid, game, hid, xr, xe in rows:
            m = model[(uid, game)][hid]
            assert abs(float(xr) - m[1]) < 1e-6 and abs(float(xe) - m[2]) < 1e-6, (uid, hid, xr, xe, m)
        ok('the per-hand split equals the independent rake-free pro-rata model, real and EV, hand by hand')

        def windows(uid, game='plo5'):
            hs = sorted(model[(uid, game)].values(), key=lambda v: v[0], reverse=True)
            res = {}
            for n in (500, 1000, 2500, 'all'):
                if len(hs) < (500 if n == 'all' else n):
                    continue
                w = hs if n == 'all' else hs[:n]
                n = len(w) if n == 'all' else n
                for k, col in (('real', 1), ('ev', 2)):
                    xs = [v[col] for v in w]
                    mu = sum(xs) / n
                    se = math.sqrt(sum((x - mu) ** 2 for x in xs) / (n - 1) / n)
                    res[(n, k)] = (round(100 * mu, 1), round(100 * se, 1))
                res[(n, 'fires')] = res[(n, 'ev')][0] > 2 * res[(n, 'ev')][1]
            return res

        def alerts(status=None):
            q = "SELECT count(*) FROM public.operational_alert_events WHERE source = 'horse-exposure-watch'"
            return int(sql(q + (f" AND status = '{status}'" if status else '')))

        r = json.loads(sql(f"SELECT public.fn_ca_horse_exposure_watch('{at}', true)"))
        assert r['dry_run'] and alerts() == 0 and sql('SELECT count(*) FROM smarter_private.ca_horse_exposure_runs') == '0', r
        flagged = {f['user_id']: f for f in r['flagged']}
        assert set(flagged) == {persons['winner']}, sorted(flagged)
        ok('a dry run flags only the person above +2 SE EV-adjusted and writes nothing')

        bounded = BOUNDED.read_text()
        start = bounded.index('CREATE OR REPLACE FUNCTION public.fn_ca_horse_exposure_watch(')
        end = bounded.index('$function$;', start) + len('$function$;')
        rb = psql([], bounded[start:end] + '\n')
        assert rb.returncode == 0, f'{BOUNDED.name}: {rb.stderr}'
        assert 'ONE HAND AT A TIME' in sql("SELECT pg_get_functiondef('public.fn_ca_horse_exposure_watch(timestamptz, boolean)'::regprocedure)")
        r_bounded = json.loads(sql(f"SELECT public.fn_ca_horse_exposure_watch('{at}', true)"))
        assert r_bounded == r, (r_bounded, r)
        assert alerts() == 0 and sql('SELECT count(*) FROM smarter_private.ca_horse_exposure_runs') == '0'
        ok('the one-hand-at-a-time breakdown (20261127043816) answers the dry run exactly as the original; every case below runs against it')

        f = flagged[persons['winner']]
        want = windows(persons['winner'])
        got = {w['hands']: w for w in f['windows']}
        assert sorted(got) == [500, 600] and [w['window'] for w in f['windows']] == ['500', 'all_60_days'], f['windows']
        for n, w in got.items():
            assert (w['ev_bb100'], w['ev_se']) == want[(n, 'ev')] and (w['real_bb100'], w['real_se']) == want[(n, 'real')], (n, w, want)
            assert w['fires'] == want[(n, 'fires')], (n, w)
        assert f['fire_window'] == max(n for n in got if want[(n, 'fires')]), f
        ok('every window rate and SE equal the model; 1,000 and 2,500 are not read until full; the 60-day window is read from 500')

        b = f['breakdown']
        assert set(b) <= {'preflop', 'all_in', 'horse_fold_preflop', 'horse_fold_flop', 'horse_fold_turn', 'horse_fold_river',
                          'calls_to_showdown', 'horse_won_no_showdown'}, b
        for ch in ('preflop', 'all_in', 'horse_fold_turn', 'calls_to_showdown'):
            assert ch in b and b[ch]['hands'] > 0, (ch, b)
        tot = sum(v['real_bb'] for v in b.values())
        newest = sorted(model[(persons['winner'], 'plo5')].values(), key=lambda v: v[0], reverse=True)[:f['fire_window']]
        assert abs(tot - sum(v[1] for v in newest)) < 1.0, (tot, b)
        assert set(f['by_mode']) == {'table', 'lightning'}, f['by_mode']
        ok('the leak breakdown names each channel with hands and chips, sums to the window, and splits table / Lightning')

        r = json.loads(sql(f"SELECT public.fn_ca_horse_exposure_watch('{at}')"))
        assert r['raised'] == 1 and alerts('firing') == 1, r
        row = json.loads(sql("SELECT row_to_json(e) FROM public.operational_alert_events e WHERE source = 'horse-exposure-watch'"))
        assert row['alertname'] == 'PersonBeatsHorsesBeyondTwoSE' and row['severity'] == 'warning' and row['investigation_status'] == 'new', row
        p = row['payload']
        assert p['target_task_id'] == FLEET and p['user_id'] == persons['winner'] and p['game'] == 'plo5' and p['breakdown'], p
        assert 'Analysis only' in p['summary'] and p['fire_window'] == f['fire_window'], p
        assert sql('SELECT count(*) FROM public.notifications_sent') == '0', 'the warning must page nobody'
        ok('one PersonBeatsHorsesBeyondTwoSE warning reaches the Production Alerts fleet with the breakdown and pages nobody')

        r = json.loads(sql(f"SELECT public.fn_ca_horse_exposure_watch('{ts(3060)}')"))
        assert r['raised'] == 0 and alerts() == 1 and sql("SELECT delivery_count FROM public.operational_alert_events WHERE source = 'horse-exposure-watch'") == '2', r
        ok('a repeat run while it fires bumps the same row')

        # The winner now loses for 500 hands: no full window above +2 SE.
        for i in range(500):
            add_hand(ts(3100 + i), persons['winner'], rnd.gauss(-8, 30))
        at2 = ts(3700)
        flush()
        r = json.loads(sql(f"SELECT public.fn_ca_horse_exposure_watch('{at2}')"))
        assert r['resolved'] == 1 and alerts('firing') == 0 and alerts('resolved') == 1, r
        ok('a run that finds no window above +2 SE resolves the warning')

        for i in range(600):
            add_hand(ts(3800 + i), persons['winner'], rnd.gauss(12, 30))
        flush()
        r = json.loads(sql(f"SELECT public.fn_ca_horse_exposure_watch('{ts(4500)}')"))
        assert r['raised'] == 1 and alerts('firing') == 1 and alerts() == 2, r
        ok('the next episode raises a new row under a new key')

        assert sql('SELECT count(*) FROM smarter_private.ca_horse_exposure_runs') == '4'
        assert sql('SELECT count(*) FROM public.notifications_sent') == '0'
        ok('every run is kept, and nothing ever paged')

        r = json.loads(sql(f"SELECT public.fn_ca_horse_exposure_watch('2026-10-01 00:00:00+00', true)"))
        assert r['flagged'] == [] and r['checked'] == 1, r
        ok('a hand inside 60 days is read (it was out of the November runs), and one hand is never flagged')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)
    print(f'{len(passed)} passed')


if __name__ == '__main__':
    main()
