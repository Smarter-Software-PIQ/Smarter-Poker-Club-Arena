#!/usr/bin/env python3
"""Isolated PG17 proof for purely additive Chicago cash window functions:
  - public.ca_club_member_chicago_today_cash(uuid, uuid, timestamptz)
  - public.ca_club_member_chicago_cash(uuid, uuid, date, date)
  - public.ca_club_members_cash_window(uuid, uuid[], date, date)

Reproduces the live Butter (+5.00 Today Cash with 0 hands) attribution-lag
defect on the preimage functions, applies the candidate migration verbatim,
and proves exact raw-fact equivalence across normal, 23h/25h DST, single-day,
multi-day, empty/inverted, Overall, cutoff, attribution-lag, and ACL cases.
"""
import argparse, json, os, re, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / 'scripts/ci/fixtures/roster-cash-batch'
MIG = ROOT / 'supabase/migrations/20261119183700_chicago_cash_windows_add_partial_days_instead_of_subtracting.sql'


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', type=Path, default=Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin')))
    ap.add_argument('--scratch', type=Path, required=True)
    a = ap.parse_args()
    w = Path(tempfile.mkdtemp(prefix='ccash-', dir=a.scratch.resolve()))
    data = w / 'data'
    started = False
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(TMPDIR=str(w), TMP=str(w), TEMP=str(w), LC_ALL='C')
    ps = [a.pg_bin / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', w, '-U', 'postgres', '-d', 'postgres']

    def run(cmd, sql=None, error=None):
        r = subprocess.run(list(map(str, cmd)), input=sql, text=True, capture_output=True, env=env, timeout=180)
        if error:
            assert r.returncode != 0 and error in r.stderr, (r.returncode, r.stderr[-3000:])
        else:
            assert r.returncode == 0, (r.stdout[-2000:], r.stderr[-6000:])
        return r.stdout.strip()

    def q(sql, error=None):
        return run(ps, sql, error)

    def yes(sql):
        assert q(sql) == 't', sql

    club = "md5('club-a')::uuid"
    other_club = "md5('union-table-club')::uuid"
    u = "md5('butter')::uuid"

    try:
        assert ' 17.' in run([a.pg_bin / 'postgres', '--version'])
        run([a.pg_bin / 'initdb', '-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8'])
        with (data / 'postgresql.conf').open('a') as f:
            f.write(f"\nlisten_addresses=''\nunix_socket_directories='{w}'\ntimezone='UTC'\nshared_buffers='16MB'\n")
        run([a.pg_bin / 'pg_ctl', '-D', data, '-l', w / 'postgres.log', '-w', 'start'])
        started = True

        q((FIX / 'bootstrap.sql').read_text())
        authority = json.loads((FIX / 'ra-authority.json').read_text())
        cols = [c['name'] + ' ' + c['type'] + (' NOT NULL' if c['not_null'] else '') + (' DEFAULT ' + c['default'] if c['default'] else '') for c in authority['columns']]
        q('CREATE TABLE rake_attributions(' + ','.join(cols) + ');')
        for c in authority['constraints']:
            q('ALTER TABLE rake_attributions ADD CONSTRAINT ' + c['name'] + ' ' + c['definition'] + ';')
        for ix in authority['indexes']:
            name = re.search(r'INDEX (\w+)', ix).group(1)
            if q('SELECT to_regclass(' + lit(name) + ')IS NULL') == 't':
                q(ix + ';')
        q('CREATE VIEW public.ca_stats_member_record_daily_facts AS SELECT * FROM public.member_record_daily_facts;')

        # Install the exact preimage functions (subtractive formulas).
        fs = json.loads((FIX / 'functions-before.json').read_text())
        q('SET check_function_bodies=off;' + ''.join(f['definition'] + ';' for f in fs))
        helper_sql = (FIX / 'candidate-helper.sql').read_text().replace(
            'public.member_record_daily_facts f', 'public.ca_stats_member_record_daily_facts f'
        )
        q(helper_sql)

        # 1. Reproduce Butter's live attribution-lag bug on all 3 preimage functions:
        #    Hand played at 2026-11-19 02:48:29.857Z (= 2026-11-18 20:48:29 CST), net = -5.00.
        #    No buyin funding receipt on the moved Main union table; member_record_daily_facts
        #    incremented other_club, while post-commit rake_attributions resolved to club-a.
        q(f"""
          INSERT INTO profiles(id) VALUES ({u}) ON CONFLICT DO NOTHING;
          INSERT INTO ca_hand_facts(hand_id, user_id, club_id, table_id, tournament_id, played_at, game_variant, net, rake_paid)
          VALUES (md5('butter-lag-hand')::uuid, {u}, {other_club}, md5('union-main-tbl')::uuid, NULL,
                  '2026-11-19 02:48:29.857Z', 'plo6', -5.00, 0.50);
          INSERT INTO rake_attributions(id, hand_id, club_id, player_id, rake_amount, created_at)
          VALUES (md5('butter-lag-ra')::uuid, md5('butter-lag-hand')::uuid, {club}, {u}, 0.50, '2026-11-19 02:48:35Z');
          INSERT INTO member_record_daily_facts
          VALUES ({other_club}, {u}, '2026-11-19', 'plo6', false, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.50, -5.00, NULL);
        """)
        yes(f"SELECT public.ca_club_member_chicago_today_cash({club}, {u}, '2026-11-19 18:30:00Z') = 5.00")
        yes(f"SELECT public.ca_club_member_chicago_cash({club}, {u}, '2026-11-19', '2026-11-20') = 5.00")
        yes(f"SELECT cash_net = 5.00 FROM public.ca_club_members_cash_window({club}, ARRAY[{u}], '2026-11-19', '2026-11-20')")
        print('PASS preimage reproduces live Butter +5.00 phantom Today Cash bug across all 3 functions')

        # 2. Apply candidate migration verbatim (guard + definitions + REVOKE ALL + probes).
        q(MIG.read_text())
        print('PASS candidate migration applied cleanly with preimage guard and probes')

        # 3. Verify attribution-lag bug is completely eliminated across all 3 functions.
        yes(f"SELECT public.ca_club_member_chicago_today_cash({club}, {u}, '2026-11-19 18:30:00Z') = 0")
        yes(f"SELECT public.ca_club_member_chicago_cash({club}, {u}, '2026-11-19', '2026-11-20') = 0")
        yes(f"SELECT cash_net = 0 FROM public.ca_club_members_cash_window({club}, ARRAY[{u}], '2026-11-19', '2026-11-20')")
        # And on the actual Chicago day the hand was played (2026-11-18), all 3 report -5.00:
        yes(f"SELECT public.ca_club_member_chicago_today_cash({club}, {u}, '2026-11-18 23:00:00-06') = -5.00")
        yes(f"SELECT public.ca_club_member_chicago_cash({club}, {u}, '2026-11-18', '2026-11-19') = -5.00")
        yes(f"SELECT cash_net = -5.00 FROM public.ca_club_members_cash_window({club}, ARRAY[{u}], '2026-11-18', '2026-11-19')")
        print('PASS attribution-lag regression: 0.00 on 2026-11-19 and -5.00 on 2026-11-18 across all 3 functions')

        # 4. Full raw-fact equivalence across normal, 23h/25h DST, single-day, multi-day, empty, Overall.
        q("TRUNCATE ca_hand_facts, member_record_daily_facts, rake_attributions;")
        q(f"""
          WITH days(d) AS (VALUES ('2026-03-08'::date), ('2026-11-01'::date), ('2026-11-02'::date), ('2026-11-03'::date), ('2026-11-04'::date), ('2026-11-05'::date)),
          bounds AS (
            SELECT d, d::timestamp AT TIME ZONE 'America/Chicago' s, (d + 1)::timestamp AT TIME ZONE 'America/Chicago' e FROM days
          ), times AS (
            SELECT DISTINCT ts FROM bounds, LATERAL (
              SELECT s - interval '1 microsecond' AS ts UNION ALL
              SELECT s UNION ALL
              SELECT s + interval '3 hours' UNION ALL
              SELECT e - interval '1 microsecond' UNION ALL
              SELECT e
            ) t
          )
          INSERT INTO ca_hand_facts(hand_id, user_id, club_id, table_id, tournament_id, played_at, game_variant, net, rake_paid)
          SELECT md5(ts::text)::uuid, {u}, {club}, md5('tbl-1')::uuid, NULL, ts, 'nlh',
                 ((row_number() OVER (ORDER BY ts)) * 3 - 20)::numeric, 0.25
            FROM times;
          INSERT INTO member_record_daily_facts
          SELECT club_id, user_id, (played_at AT TIME ZONE 'UTC')::date, game_variant, false,
                 count(*), 0, 0, 0, 0, 0, 0, 0, 0, sum(rake_paid), sum(net), NULL
            FROM ca_hand_facts GROUP BY 1, 2, 3, 4;
        """)
        for s_day, e_day in [
            ('2026-03-08', '2026-03-09'),  # 23h spring-forward DST
            ('2026-11-01', '2026-11-02'),  # 25h fall-back DST
            ('2026-11-02', '2026-11-03'),  # 24h normal single day
            ('2026-11-01', '2026-11-06'),  # multi-day exercising interior UTC days + both partial edges
        ]:
            raw = (
                f"SELECT coalesce(sum(net), 0) FROM ca_hand_facts "
                f"WHERE user_id = {u} AND tournament_id IS NULL "
                f"AND played_at >= '{s_day}'::date::timestamp AT TIME ZONE 'America/Chicago' "
                f"AND played_at < '{e_day}'::date::timestamp AT TIME ZONE 'America/Chicago'"
            )
            yes(f"SELECT public.ca_club_member_chicago_cash({club}, {u}, '{s_day}', '{e_day}') = ({raw})")
            yes(f"SELECT cash_net = ({raw}) FROM public.ca_club_members_cash_window({club}, ARRAY[{u}], '{s_day}', '{e_day}')")
            if e_day == s_day[:8] + f"{int(s_day[8:])+1:02d}":
                yes(f"SELECT public.ca_club_member_chicago_today_cash({club}, {u}, '{s_day} 12:00:00-06') = ({raw})")
        # Empty / inverted range and Overall
        yes(f"SELECT public.ca_club_member_chicago_cash({club}, {u}, '2026-11-03', '2026-11-03') = 0")
        yes(f"SELECT public.ca_club_member_chicago_cash({club}, {u}, '2026-11-04', '2026-11-03') = 0")
        yes(f"SELECT cash_net = 0 FROM public.ca_club_members_cash_window({club}, ARRAY[{u}], '2026-11-04', '2026-11-03')")
        yes(f"SELECT cash_net = (SELECT coalesce(sum(net), 0) FROM ca_hand_facts) FROM public.ca_club_members_cash_window({club}, ARRAY[{u}], NULL, NULL)")
        print('PASS exact raw-fact equivalence across 23h/25h DST, single-day, multi-day, empty, and Overall')

        # 5. Verify REVOKE ALL grants are preserved.
        for role in ['anon', 'authenticated', 'service_role']:
            q(f"SET ROLE {role}; SELECT public.ca_club_member_chicago_today_cash({club}, {u});", 'permission denied')
            q(f"SET ROLE {role}; SELECT public.ca_club_member_chicago_cash({club}, {u}, '2026-11-19', '2026-11-20');", 'permission denied')
            q(f"SET ROLE {role}; SELECT * FROM public.ca_club_members_cash_window({club}, ARRAY[{u}], '2026-11-19', '2026-11-20');", 'permission denied')
        print('PASS REVOKE ALL preserved for anon, authenticated, service_role on all 3 functions')
    finally:
        if started:
            run([a.pg_bin / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])
        shutil.rmtree(w, ignore_errors=True)


if __name__ == '__main__':
    main()
