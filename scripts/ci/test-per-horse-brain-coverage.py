#!/usr/bin/env python3
"""Native proof for 20261110054654_every_horse_s_brain_day_is_on_the_record.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production) with the minimal production shapes it reads and writes, proves the
assertions FAIL against the pre-migration audit function (per-horse coverage
does not exist), applies the migration, then proves the trigger-fed rollup and
the per-horse daily coverage upsert behave: one row per roster horse including
an idle zero row, counts that match the fixture actions, idempotent re-runs,
the dead-writer and backfill findings, and browser roles denied.
"""
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261110054654_every_horse_s_brain_day_is_on_the_record.sql'

H1 = '11111111-1111-4111-8111-111111111111'  # busy roster horse, both lanes
H2 = '22222222-2222-4222-8222-222222222222'  # cash-only roster horse
H3 = '33333333-3333-4333-8333-333333333333'  # idle roster horse: the point
H4 = '44444444-4444-4444-8444-444444444444'  # retired: acts, not in coverage
H5 = '55555555-5555-4555-8555-555555555555'  # deleted: acts, not in coverage
U1 = '99999999-9999-4999-8999-999999999999'  # human at the table


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


# Column types match production (hand_history.actions is jsonb with per-action
# userId/origin/stage, read back from live rows 2026-11-10; profiles.id and
# ca_horse_fleet_register.horse_id are uuid). The pre-migration
# fn_run_horse_daily_audit here is production's trimmed to the parts this
# migration touches: the same rake-pace anchor line the surgical edit keys on,
# and the same horse_daily_audit upsert, so the fail-before run is the real
# pre-migration behaviour of the section under proof.
SCHEMA = f"""
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean NOT NULL DEFAULT false, status text,
  alias text, display_name text, username text);
CREATE TABLE public.ca_horse_fleet_register (horse_id uuid PRIMARY KEY, registered_at timestamptz DEFAULT now(),
  retired_at timestamptz);
CREATE TABLE public.hand_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(), table_id uuid, tournament_id uuid, hand_number integer,
  game_variant text, pot_size numeric, big_blind numeric, actions jsonb, has_human boolean);
CREATE TABLE public.horse_hand_reviews (id bigserial PRIMARY KEY, horse_user_id uuid, played_at timestamptz,
  game_variant text, format text, is_win boolean, net_bb numeric, leak_tags text[] DEFAULT '{{}}');
CREATE TABLE public.horse_brain_telemetry (day date, feature text, fires bigint, PRIMARY KEY (day, feature));
CREATE TABLE public.horse_daily_audit (day date PRIMARY KEY, generated_at timestamptz, stats jsonb, findings jsonb);
CREATE FUNCTION public.fn_audit_horse_cash_rake_pace(p_day date) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT '[]'::jsonb $$;
CREATE FUNCTION public.fn_run_horse_daily_audit(p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare
  v_stats jsonb := '{{}}'::jsonb;
  v_findings jsonb := '[]'::jsonb;
begin
  select jsonb_build_object('flagged_hands', count(*)) into v_stats
    from horse_hand_reviews where played_at >= p_day and played_at < p_day + 1;
  v_findings := v_findings || fn_audit_horse_cash_rake_pace(p_day);
  insert into horse_daily_audit as a (day, generated_at, stats, findings)
  values (p_day, now(), coalesce(v_stats,'{{}}'::jsonb), v_findings)
  on conflict (day) do update set generated_at = now(), stats = excluded.stats, findings = excluded.findings;
  return jsonb_build_object('day', p_day, 'findings', jsonb_array_length(v_findings));
end
$fn$;
INSERT INTO public.profiles (id, is_horse, status) VALUES
  ('{H1}', true, 'active'), ('{H2}', true, NULL), ('{H3}', true, 'active'),
  ('{H4}', true, 'active'), ('{H5}', true, 'deleted'), ('{U1}', false, 'active');
INSERT INTO public.ca_horse_fleet_register (horse_id, retired_at) VALUES
  ('{H1}', NULL), ('{H2}', NULL), ('{H3}', NULL), ('{H4}', now() - interval '2 days'), ('{H5}', NULL);
"""


def act(user, origin, action='fold', stage='preflop'):
    return f'{{"userId":"{user}","origin":"{origin}","stage":"{stage}","action":"{action}"}}'


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    os.environ['PGTZ'] = 'UTC'  # the audit slices days in UTC; pin the harness to the same clock
    scratch = Path(tempfile.mkdtemp(prefix='horse-coverage-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir=os.environ.get('PG_SOCKET_ROOT') or scratch))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses='' -c timezone=UTC",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    try:
        def run(text):
            return subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                   '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', text],
                                  capture_output=True, text=True)

        def sql(text):
            r = run(text)
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        def hand(variant, tournament, actions):
            tid = 'gen_random_uuid()' if tournament else 'NULL'
            sql("INSERT INTO hand_history (created_at, tournament_id, game_variant, actions) "
                f"VALUES (now(), {tid}, '{variant}', '[{', '.join(actions)}]'::jsonb)")

        def coverage(horse, field):
            return sql(f"SELECT {field} FROM horse_daily_brain_coverage "
                       f"WHERE day = current_date AND horse_id = '{horse}'")

        sql(SCHEMA)
        sql("INSERT INTO horse_brain_telemetry VALUES (current_date, 'decide', 7)")

        # 1. FAIL-BEFORE: the pre-migration audit runs, writes its day row, and
        #    the per-horse assertions FAIL because nothing per-horse exists.
        assert sql("SELECT fn_run_horse_daily_audit(current_date)->>'day'") != ''
        assert sql("SELECT count(*) FROM horse_daily_audit") == '1'
        assert sql("SELECT to_regclass('public.horse_daily_brain_coverage') IS NULL") == 't'
        assert sql("SELECT to_regclass('public.horse_brain_activity_rollup') IS NULL") == 't'
        failing = run("SELECT count(*) FROM horse_daily_brain_coverage WHERE day = current_date")
        assert failing.returncode != 0, 'per-horse coverage must not exist before the migration'

        # 2. The migration applies cleanly and its live proof holds.
        r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                            '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(MIGRATION)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'

        # 3. The fixture day's hands. H1 decides in two cash NLH hands and one
        #    tournament PLO hand; H2 in one cash NLH hand; H3 never acts.
        #    Retired H4, deleted H5 and human U1 act so the roster filter is
        #    proven against real traffic, and forced/null origins are ignored.
        hand('nlh', False, [act(U1, 'forced', 'sb'), act(H1, 'horse_policy', 'raise'),
                            act(H2, 'horse_policy'), act(H1, 'horse_policy', 'bet', 'flop'),
                            act(H1, 'horse_fallback', 'fold', 'turn'), f'{{"userId":"{U1}","stage":"turn","action":"call"}}'])
        hand('nlh', False, [act(H1, 'horse_policy', 'call'), act(H5, 'horse_fallback')])
        hand('plo', True, [act(H1, 'horse_policy', 'check'), act(H4, 'horse_policy')])

        # 4. The trigger counted exactly the fixture's horse-origin actions.
        assert sql(f"SELECT decided_hands||'|'||policy_actions||'|'||fallback_actions FROM horse_brain_activity_rollup "
                   f"WHERE day = current_date AND horse_user_id = '{H1}' AND game_variant = 'nlh' AND lane = 'cash'") == '2|3|1'
        assert sql(f"SELECT decided_hands||'|'||policy_actions||'|'||fallback_actions FROM horse_brain_activity_rollup "
                   f"WHERE day = current_date AND horse_user_id = '{H1}' AND game_variant = 'plo' AND lane = 'tournament'") == '1|1|0'
        assert sql("SELECT count(*) FROM horse_brain_activity_rollup WHERE day = current_date") == '5', 'H1 cash, H1 tournament, H2, H4, H5'
        assert sql(f"SELECT count(*) FROM horse_brain_activity_rollup WHERE horse_user_id = '{U1}'") == '0'

        # 5. Malformed traffic neither blocks the hand nor corrupts the counts:
        #    a non-uuid userId, an object where the array belongs, and no
        #    actions at all after a dropped connection.
        hand('nlh', False, ['{"userId":"not-a-uuid","origin":"horse_policy","action":"fold"}'])
        sql("INSERT INTO hand_history (game_variant, actions) VALUES ('nlh', '{\"orphaned\": true}'::jsonb)")
        sql("INSERT INTO hand_history (game_variant) VALUES ('nlh')")
        assert sql("SELECT count(*) FROM hand_history") == '6'
        assert sql("SELECT count(*) FROM horse_brain_activity_rollup WHERE day = current_date") == '5'

        # 6. The audited day: one coverage row per roster horse, zero row
        #    included, counts matching the fixture, variant mix and lane right.
        assert sql("SELECT fn_run_horse_daily_audit(current_date) IS NOT NULL") == 't'
        assert sql("SELECT count(*) FROM horse_daily_brain_coverage WHERE day = current_date") == '3'
        assert coverage(H1, "decided_hands||'|'||policy_actions||'|'||fallback_actions") == '3|4|1'
        assert coverage(H1, "variant_mix->>'nlh'") == '2' and coverage(H1, "variant_mix->>'plo'") == '1'
        assert coverage(H1, 'lane') == 'mixed'
        assert coverage(H2, "decided_hands||'|'||policy_actions||'|'||fallback_actions||'|'||lane") == '1|1|0|cash'
        assert coverage(H2, "variant_mix::text") == '{"nlh": 1}'
        assert coverage(H3, "decided_hands||'|'||policy_actions||'|'||fallback_actions||'|'||lane") == '0|0|0|none'
        assert coverage(H3, "variant_mix::text") == '{}'
        assert sql(f"SELECT count(*) FROM horse_daily_brain_coverage WHERE horse_id IN ('{H4}','{H5}','{U1}')") == '0'

        # 7. The audit row carries the summary finding with the fleet numbers.
        summary = sql("SELECT f->'evidence' FROM horse_daily_audit, jsonb_array_elements(findings) f "
                      "WHERE day = current_date AND f->>'code' = 'per_horse_brain_coverage'")
        for fragment in ('"roster": 3', '"active_horses": 2', '"idle_horses": 1', '"decided_hands": 4',
                         '"policy_actions": 5', '"fallback_actions": 1', '"fallback_share": 0.1667',
                         '"fleet_decides_telemetry": 7'):
            assert fragment in summary, f'{fragment} not in {summary}'

        # 8. Re-running the audited day is idempotent: same rows, same counts.
        before = sql("SELECT string_agg(horse_id||':'||decided_hands||':'||policy_actions||':'||fallback_actions||':'||lane||':'||variant_mix::text, ',' ORDER BY horse_id) FROM horse_daily_brain_coverage WHERE day = current_date")
        sql("SELECT fn_run_horse_daily_audit(current_date)")
        assert sql("SELECT count(*) FROM horse_daily_brain_coverage WHERE day = current_date") == '3'
        after = sql("SELECT string_agg(horse_id||':'||decided_hands||':'||policy_actions||':'||fallback_actions||':'||lane||':'||variant_mix::text, ',' ORDER BY horse_id) FROM horse_daily_brain_coverage WHERE day = current_date")
        assert before == after and before != ''

        # 9. A day with telemetry decides and no rollup rows, while the rollup
        #    holds an earlier day: the writer died, and that is critical.
        sql("INSERT INTO horse_brain_telemetry VALUES (current_date + 1, 'decide', 5)")
        sql("SELECT fn_run_horse_daily_audit(current_date + 1)")
        assert sql("SELECT count(*) FROM horse_daily_brain_coverage WHERE day = current_date + 1 AND decided_hands = 0") == '3'
        assert sql("SELECT f->>'severity' FROM horse_daily_audit, jsonb_array_elements(findings) f "
                   "WHERE day = current_date + 1 AND f->>'code' = 'per_horse_coverage_absent'") == 'critical'

        # 10. A backfilled day from before the rollup existed is info, never a
        #     false page.
        sql("INSERT INTO horse_brain_telemetry VALUES (current_date - 30, 'decide', 9)")
        sql("SELECT fn_run_horse_daily_audit(current_date - 30)")
        assert sql("SELECT f->>'severity' FROM horse_daily_audit, jsonb_array_elements(findings) f "
                   "WHERE day = current_date - 30 AND f->>'code' = 'per_horse_coverage_absent'") == 'info'

        # 11. Browser roles are denied; service_role reads.
        for role in ('anon', 'authenticated'):
            for rel in ('horse_daily_brain_coverage', 'horse_brain_activity_rollup'):
                assert sql(f"SELECT has_table_privilege('{role}', 'public.{rel}', 'SELECT')") == 'f'
            for fn in ('fn_horse_daily_brain_coverage_upsert(date)', 'fn_audit_per_horse_brain_coverage(date)'):
                assert sql(f"SELECT has_function_privilege('{role}', 'public.{fn}', 'EXECUTE')") == 'f'
        denied = run("SET ROLE anon; SELECT count(*) FROM public.horse_daily_brain_coverage")
        assert denied.returncode != 0 and 'permission denied' in denied.stderr
        assert sql("SELECT has_table_privilege('service_role', 'public.horse_daily_brain_coverage', 'SELECT')") == 't'

        # 12. Applying the migration twice is refused loudly, never double-wired.
        r = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                            '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(MIGRATION)], capture_output=True, text=True)
        assert r.returncode != 0
        assert sql("SELECT (length(d) - length(replace(d, 'fn_audit_per_horse_brain_coverage(p_day)', ''))) / length('fn_audit_per_horse_brain_coverage(p_day)') "
                   "FROM pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure) d") == '1'

        print('every horse brain day is on the record: 12/12 behaviours proven')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    main()
