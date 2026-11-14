#!/usr/bin/env python3
"""Native proof for 20261114003037_the_daily_audit_reports_the_heads_up_league_cards.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production) with the minimal production shapes it reads, proves the assertions
FAIL against the pre-migration audit function (no heads-up line exists),
applies the migration, then proves: the audit function changed only by the
added lines, the heads-up cards are reported by name prefix with their hands,
bb100, stderr and status, the absent flag fires when no heads-up card
produced a row for the night (info inside seven days, warn beyond), the
section is read-only and cannot take the audit down, browser roles are
denied, a second apply refuses, and the edit is the same whether or not
20261110054654 has already wired its own lines after the shared anchor.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261114003037_the_daily_audit_reports_the_heads_up_league_cards.sql'

ANCHOR = 'v_findings := v_findings || fn_audit_horse_cash_rake_pace(p_day);'
WIRED = 'v_findings := v_findings || fn_audit_heads_up_league(p_day);'
DAY = '2026-11-12'  # the audited day; the league run for its night is dated the next day


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


ROLES = "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"


# horse_league_results carries the production columns this migration reads
# (20260822230000 plus status and refusal_reason from 20260927220437). The
# pre-migration fn_run_horse_daily_audit is production's trimmed to the parts
# this migration touches: the rake-pace anchor line the surgical edit keys
# on, and the horse_daily_audit upsert. `after_anchor` is the text production
# carries right after that anchor once 20261110054654 has installed.
def schema(after_anchor=''):
    return f"""
CREATE TABLE public.horse_league_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_date date NOT NULL, matchup text NOT NULL, hands integer NOT NULL DEFAULT 0,
  bb100 numeric NOT NULL DEFAULT 0, stderr numeric NOT NULL DEFAULT 0,
  illegal_actions integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'measured', refusal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT horse_league_results_once UNIQUE (run_date, matchup));
CREATE TABLE public.horse_daily_audit (day date PRIMARY KEY, generated_at timestamptz, stats jsonb, findings jsonb);
CREATE FUNCTION public.fn_audit_horse_cash_rake_pace(p_day date) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT '[]'::jsonb $$;
CREATE FUNCTION public.fn_audit_per_horse_brain_coverage(p_day date) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT jsonb_build_array(jsonb_build_object('severity','info','code','per_horse_brain_coverage')) $$;
CREATE FUNCTION public.fn_run_horse_daily_audit(p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET timezone TO 'UTC' AS $fn$
declare
  v_stats jsonb := '{{}}'::jsonb;
  v_findings jsonb := '[]'::jsonb;
begin
  {ANCHOR}{after_anchor}
  insert into horse_daily_audit as a (day, generated_at, stats, findings)
  values (p_day, now(), coalesce(v_stats,'{{}}'::jsonb), v_findings)
  on conflict (day) do update set generated_at = now(), stats = excluded.stats, findings = excluded.findings;
  return jsonb_build_object('day', p_day, 'findings', jsonb_array_length(v_findings));
end
$fn$;
"""


COVERAGE_WIRING = """
  -- 2026-11-10: brain telemetry is fleet-aggregate, so per-horse coverage
  v_findings := v_findings || fn_audit_per_horse_brain_coverage(p_day);"""


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    os.environ['PGTZ'] = 'UTC'
    scratch = Path(tempfile.mkdtemp(prefix='hu-league-audit-', dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir=os.environ.get('PG_SOCKET_ROOT') or scratch))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses='' -c timezone=UTC",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    try:
        def psql(db, *args):
            return subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', db,
                                   '-X', '-q', '-v', 'ON_ERROR_STOP=1', *args], capture_output=True, text=True)

        def run(text, db='postgres'):
            return psql(db, '-t', '-A', '-c', text)

        def sql(text, db='postgres'):
            r = run(text, db)
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        def audit_def(db='postgres'):
            return sql("SELECT pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure)", db)

        def findings(day=DAY, db='postgres'):
            sql(f"SELECT fn_run_horse_daily_audit('{day}')", db)
            return json.loads(sql(f"SELECT findings FROM horse_daily_audit WHERE day = '{day}'", db))

        def by_code(rows, code):
            return [f for f in rows if f.get('code') == code]

        def league(run_date, matchup, hands, bb100, stderr, status='measured', db='postgres'):
            sql("INSERT INTO horse_league_results (run_date, matchup, hands, bb100, stderr, status) "
                f"VALUES ('{run_date}', '{matchup}', {hands}, {bb100}, {stderr}, '{status}')", db)

        sql(ROLES)
        sql(schema())

        # 1. FAIL-BEFORE: the pre-migration audit runs and says nothing about
        #    heads-up, with heads-up league rows already on the table.
        league('2026-11-13', 'hu_mind_layer', 12000, 1.25, 0.9)
        before_def = audit_def()
        before = findings()
        assert before == [], before
        assert not by_code(before, 'league_heads_up_summary'), 'no heads-up line may exist before the migration'
        assert sql("SELECT to_regprocedure('public.fn_audit_heads_up_league(date)') IS NULL") == 't'
        failing = run(f"SELECT fn_audit_heads_up_league('{DAY}')")
        assert failing.returncode != 0, 'the heads-up section must not exist before the migration'
        sql("DELETE FROM horse_league_results")

        # 2. The migration applies cleanly and its live proof holds.
        r = psql('postgres', '-f', str(MIGRATION))
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'

        # 3. ADDITIVE ONLY: the audit function is the old one plus the added
        #    lines after the anchor. Removing exactly those lines gives the
        #    pre-migration definition back, byte for byte.
        after_def = audit_def()
        assert after_def != before_def
        start = after_def.index(ANCHOR) + len(ANCHOR)
        end = after_def.index(WIRED) + len(WIRED)
        added = after_def[start:end]
        assert after_def[:start] + after_def[end:] == before_def, 'the edit must only add lines'
        added_lines = [ln.strip() for ln in added.strip('\n').split('\n')]
        assert added_lines[-1] == WIRED and all(ln.startswith('--') for ln in added_lines[:-1]), added_lines
        assert after_def.count(ANCHOR) == 1 and after_def.count(WIRED) == 1

        # 4. No league row at all: the absent flag, warn (nothing in seven
        #    days), and no summary.
        f = findings()
        assert not by_code(f, 'league_heads_up_summary')
        absent = by_code(f, 'league_heads_up_absent')
        assert len(absent) == 1 and absent[0]['severity'] == 'warn', absent
        assert absent[0]['evidence']['newest_league_run'] is None
        assert absent[0]['evidence']['last_heads_up_run_date'] is None

        # 5. The night's run holds three heads-up cards among others. Exactly
        #    the names that START with hu_ or human_hu_ are reported, with
        #    their own numbers; look-alikes are not.
        league('2026-11-13', 'hu_mind_layer', 12000, 1.25, 0.9)
        league('2026-11-13', 'human_hu_bb_defends_to_price', 8000, -3.5, 1.1)
        league('2026-11-13', 'hu_v16_overlay', 0, 0, 0, 'refused')
        league('2026-11-13', 'v16_hu_overlay_6max', 6000, 0.4, 0.8)
        league('2026-11-13', 'human_field_six_max', 6000, 2.0, 0.7)
        league('2026-11-13', 'hub_layer', 6000, 2.0, 0.7)
        league('2026-11-13', 'humanhu_typo', 6000, 2.0, 0.7)
        league('2026-11-14', 'hu_future_run_ignored', 6000, 9.0, 0.7)  # after p_day + 1: not this audit's run
        rows_before = sql("SELECT count(*)||'|'||coalesce(max(id),0) FROM horse_league_results")
        f = findings()
        assert not by_code(f, 'league_heads_up_absent'), f
        summary = by_code(f, 'league_heads_up_summary')
        assert len(summary) == 1 and summary[0]['severity'] == 'info', summary
        ev = summary[0]['evidence']
        assert ev['run_date'] == '2026-11-13' and ev['run_is_for_the_audited_night'] is True
        assert ev['league_rows_on_run'] == 7 and ev['heads_up_cards'] == 3
        assert ev['cards'] == [
            {'name': 'hu_mind_layer', 'hands': 12000, 'bb100': 1.25, 'stderr': 0.9, 'status': 'measured'},
            {'name': 'hu_v16_overlay', 'hands': 0, 'bb100': 0, 'stderr': 0, 'status': 'refused'},
            {'name': 'human_hu_bb_defends_to_price', 'hands': 8000, 'bb100': -3.5, 'stderr': 1.1, 'status': 'measured'},
        ], ev['cards']
        assert summary[0]['title'] == 'Heads-up league: 3 cards reported on the 2026-11-13 run'

        # 6. READ-ONLY: the section wrote nothing to the league table, is
        #    declared STABLE, and running it twice gives the same findings.
        assert sql("SELECT count(*)||'|'||coalesce(max(id),0) FROM horse_league_results") == rows_before
        assert sql("SELECT provolatile FROM pg_proc WHERE oid = 'public.fn_audit_heads_up_league(date)'::regprocedure") == 's'
        assert findings() == f
        assert sql("SELECT count(*) FROM horse_daily_audit WHERE day = '" + DAY + "'") == '1'

        # 7. A night whose run holds no heads-up card: the absent flag, info
        #    while the last heads-up row is inside seven days, warn beyond.
        league('2026-11-15', 'human_field_six_max', 6000, 2.0, 0.7)
        f = findings('2026-11-14')
        assert not by_code(f, 'league_heads_up_summary')
        absent = by_code(f, 'league_heads_up_absent')
        assert len(absent) == 1 and absent[0]['severity'] == 'info', absent
        assert absent[0]['evidence']['newest_league_run'] == '2026-11-15'
        assert absent[0]['evidence']['heads_up_cards_on_newest_run'] == 0
        assert absent[0]['evidence']['last_heads_up_run_date'] == '2026-11-14'
        assert absent[0]['evidence']['days_since_last_heads_up_row'] == 1
        league('2026-11-25', 'human_field_six_max', 6000, 2.0, 0.7)
        absent = by_code(findings('2026-11-24'), 'league_heads_up_absent')
        assert len(absent) == 1 and absent[0]['severity'] == 'warn', absent
        assert absent[0]['evidence']['days_since_last_heads_up_row'] == 11

        # 7b. A REFUSED ROW IS NOT A CARD THAT RAN. A retired card
        #     (hu_break_even_bluff) writes a refused, zero-hand row every
        #     night; with only that row the card is still listed and the
        #     absent flag still fires, on the age of the last MEASURED row.
        league('2026-11-27', 'hu_break_even_bluff', 0, 0, 0, 'refused')
        league('2026-11-27', 'human_field_six_max', 6000, 2.0, 0.7)
        f = findings('2026-11-26')
        summary = by_code(f, 'league_heads_up_summary')
        assert len(summary) == 1 and summary[0]['evidence']['heads_up_cards'] == 1, summary
        absent = by_code(f, 'league_heads_up_absent')
        assert len(absent) == 1 and absent[0]['severity'] == 'warn', absent
        assert absent[0]['evidence']['heads_up_cards_on_newest_run'] == 1
        assert absent[0]['evidence']['measured_heads_up_cards_on_newest_run'] == 0
        assert absent[0]['evidence']['last_heads_up_run_date'] == '2026-11-14'

        # 8. The league did not run for the night at all: the newest run is
        #    reported as what it is (not the audited night) AND the absent
        #    flag fires.
        sql("DELETE FROM horse_league_results WHERE run_date > '2026-11-13'")
        f = findings('2026-11-16')
        summary = by_code(f, 'league_heads_up_summary')
        assert len(summary) == 1 and summary[0]['evidence']['run_date'] == '2026-11-13'
        assert summary[0]['evidence']['run_is_for_the_audited_night'] is False
        absent = by_code(f, 'league_heads_up_absent')
        assert len(absent) == 1 and absent[0]['severity'] == 'info', absent
        assert absent[0]['evidence']['heads_up_cards_on_newest_run'] == 3

        # 9. Browser roles cannot call the section; service_role can.
        for role in ('anon', 'authenticated'):
            assert sql(f"SELECT has_function_privilege('{role}', 'public.fn_audit_heads_up_league(date)', 'EXECUTE')") == 'f'
        assert sql("SELECT has_function_privilege('service_role', 'public.fn_audit_heads_up_league(date)', 'EXECUTE')") == 't'

        # 10. A SECOND APPLY REFUSES and leaves the audit function as it is.
        r = psql('postgres', '-f', str(MIGRATION))
        assert r.returncode != 0, 'a second apply must refuse'
        assert audit_def() == after_def

        # 11. THE SECTION CANNOT TAKE THE AUDIT DOWN: with the table it reads
        #     broken, the audit still writes its day row and carries one warn
        #     finding that says so.
        sql("ALTER TABLE horse_league_results RENAME COLUMN bb100 TO bb100_gone")
        f = findings('2026-11-17')
        failed = by_code(f, 'league_heads_up_section_failed')
        assert len(failed) == 1 and failed[0]['severity'] == 'warn', f
        assert 'bb100' in failed[0]['evidence']['message']
        sql("ALTER TABLE horse_league_results RENAME COLUMN bb100_gone TO bb100")

        # 12. ORDER INDEPENDENCE: production may already carry the
        #     20261110054654 wiring right after the same anchor. The edit is
        #     still additive there, both sections report, and the anchor
        #     20261110054654 keys on is still present exactly once.
        sql('CREATE DATABASE wired')
        sql(schema(COVERAGE_WIRING), 'wired')
        before2 = audit_def('wired')
        r = psql('wired', '-f', str(MIGRATION))
        assert r.returncode == 0, r.stderr
        after2 = audit_def('wired')
        s2 = after2.index(ANCHOR) + len(ANCHOR)
        e2 = after2.index(WIRED) + len(WIRED)
        assert after2[:s2] + after2[e2:] == before2, 'the edit must only add lines on the wired shape too'
        assert after2.count(ANCHOR) == 1
        league('2026-11-13', 'hu_mind_layer', 12000, 1.25, 0.9, db='wired')
        f = findings(db='wired')
        assert [x['code'] for x in f] == ['league_heads_up_summary', 'per_horse_brain_coverage'], f

        print('daily audit heads-up league lines: all assertions passed')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == '__main__':
    main()
