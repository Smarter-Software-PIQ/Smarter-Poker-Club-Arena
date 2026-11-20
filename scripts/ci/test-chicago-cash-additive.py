#!/usr/bin/env python3
"""Isolated PG17 regression proof for additive Chicago cash window functions.

Proves against exact production function preimages that:
1. All three preimage functions (ca_club_member_chicago_today_cash,
   ca_club_member_chicago_cash, ca_club_members_cash_window) reproduce the
   exact phantom +$5.00 bug when a hand in [00:00 UTC, 06:00 UTC) has
   post-commit rake_attributions lag.
2. Applying the additive migration passes all MD5 preimage guards, eliminates
   the phantom +$5.00 on 2026-11-19 (returning 0) while attributing -5.00 to
   2026-11-18, matches raw ca_hand_facts across 23h/25h DST, single-day,
   multi-day, overall, empty/reversed ranges and launch cutoffs, and preserves
   private ACLs.
No live database connection. Use --scratch on external SSD.
"""
import argparse, json, os, re, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / 'scripts/ci/fixtures/roster-cash-batch'
MIGRATION = ROOT / 'supabase/migrations/20261119180000_chicago_cash_windows_add_partial_days_instead_of_subtracting.sql'


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', type=Path, default=Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin')))
    ap.add_argument('--scratch', type=Path, required=True)
    args = ap.parse_args()
    assert args.scratch.is_dir(), f'scratch dir does not exist: {args.scratch}'

    w = Path(tempfile.mkdtemp(prefix='ccash-', dir=args.scratch.resolve()))
    assert len(str(w).encode()) < 95, f'socket path too long: {w}'
    data = w / 'data'
    started = False
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(TMPDIR=str(w), TMP=str(w), TEMP=str(w), LC_ALL='C')
    ps = [args.pg_bin / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', w, '-U', 'postgres', '-d', 'postgres']

    def run(cmd, sql=None, error=None):
        r = subprocess.run(list(map(str, cmd)), input=sql, text=True, capture_output=True, env=env, timeout=120)
        if error:
            assert r.returncode != 0 and error in r.stderr, (r.returncode, r.stdout[-2000:], r.stderr[-4000:])
        else:
            assert r.returncode == 0, (r.stdout[-2000:], r.stderr[-4000:])
        return r.stdout.strip()

    def q(sql, error=None):
        return run(ps, sql, error)

    def yes(sql):
        assert q(sql) == 't', f'assertion failed: {sql}'

    try:
        assert ' 17.' in run([args.pg_bin / 'postgres', '--version'])
        run([args.pg_bin / 'initdb', '-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8'])
        with (data / 'postgresql.conf').open('a') as f:
            f.write(f"\nlisten_addresses=''\nunix_socket_directories='{w}'\ntimezone='UTC'\nshared_buffers='16MB'\n")
        run([args.pg_bin / 'pg_ctl', '-D', data, '-l', w / 'postgres.log', '-w', 'start'])
        started = True

        q((FIX / 'bootstrap.sql').read_text())
        # Create ca_stats_member_record_daily_facts view matching production reader view.
        q('CREATE VIEW public.ca_stats_member_record_daily_facts AS SELECT * FROM public.member_record_daily_facts;')

        authority = json.loads((FIX / 'ra-authority.json').read_text())
        cols = [c['name'] + ' ' + c['type'] + (' NOT NULL' if c['not_null'] else '') + (' DEFAULT ' + c['default'] if c['default'] else '') for c in authority['columns']]
        q('CREATE TABLE rake_attributions(' + ','.join(cols) + ');')
        for c in authority['constraints']:
            q('ALTER TABLE rake_attributions ADD CONSTRAINT ' + c['name'] + ' ' + c['definition'] + ';')

        fs = json.loads((FIX / 'functions-before.json').read_text())
        q('SET check_function_bodies=off;' + ''.join(f['definition'] + ';' for f in fs))
        for f in fs:
            sig = f['signature']
            q('REVOKE ALL ON FUNCTION ' + sig + ' FROM PUBLIC,anon,authenticated,service_role;')
            for role in ['anon', 'authenticated', 'service_role']:
                if role + '=X/' in (f['acl'] or ''):
                    q('GRANT EXECUTE ON FUNCTION ' + sig + ' TO ' + role + ';')

        # Install exact production preimage of ca_club_members_cash_window (with ca_stats_member_record_daily_facts).
        helper_sql = (FIX / 'candidate-helper.sql').read_text().replace(
            'public.member_record_daily_facts', 'public.ca_stats_member_record_daily_facts'
        )
        q(helper_sql)

        # Verify all 3 exact production preimage MD5s before applying migration.
        assert q("SELECT md5(pg_get_functiondef('public.ca_club_member_chicago_today_cash(uuid,uuid,timestamp with time zone)'::regprocedure))") == '06a865d12318b40786f3279090a5004e'
        assert q("SELECT md5(pg_get_functiondef('public.ca_club_member_chicago_cash(uuid,uuid,date,date)'::regprocedure))") == '82abafd6136f114a449c2aae9dc1dae6'
        assert q("SELECT md5(pg_get_functiondef('public.ca_club_members_cash_window(uuid,uuid[],date,date)'::regprocedure))") == '8844cabc5f0de8bacba3dc0116988e0e'
        print('PASS exact production preimage MD5s verified', flush=True)

        kings = "'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid"
        union_club = "'fade0000-0000-0000-0000-000000000001'::uuid"
        butter = "'fa407ee1-5473-42ec-a9ac-a1eee50983fe'::uuid"
        table_id = "'eece8f7f-f58e-4a9c-936a-af0a7e548655'::uuid"
        hand_id = "'08c76337-89bb-42a5-ae98-a638285d902f'::uuid"

        # Reproduce exact Butter incident:
        # 1. Hand played at 2026-11-19 02:48:29.857Z (still Chicago 2026-11-18) with net = -5.00.
        # 2. At insert time, rake_attributions had not arrived yet, so member_record_daily_facts
        #    incremented union_club (NOT kings).
        # 3. 2.6s later, rake_attributions arrived pointing to kings.
        q(f"""
            INSERT INTO profiles(id, is_admin) VALUES ({butter}, false);
            INSERT INTO ca_hand_facts(hand_id, user_id, club_id, table_id, tournament_id, played_at, game_variant, net, rake_paid)
            VALUES ({hand_id}, {butter}, {union_club}, {table_id}, NULL, '2026-11-19 02:48:29.857Z', 'plo6', -5.00, 0.50);
            INSERT INTO member_record_daily_facts(club_id, user_id, played_on, game_variant, is_mtt, hands, wins, vpip_hands, pfr_hands, tb_hands, faced_tb, folded_tb, cb_hands, cb_opps, fees, net, accounting_cutoff)
            VALUES ({union_club}, {butter}, '2026-11-19', 'plo6', false, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0.50, -5.00, NULL);
            INSERT INTO rake_attributions(id, hand_id, club_id, player_id, table_id, rake_amount, created_at)
            VALUES (md5('ra-butter')::uuid, {hand_id}, {kings}, {butter}, {table_id}, 0.50, '2026-11-19 02:48:32.457Z');
        """)

        # Prove all 3 preimage functions reproduce the phantom +5.00 bug on Chicago 2026-11-19!
        yes(f"SELECT public.ca_club_member_chicago_today_cash({kings}, {butter}, '2026-11-19 17:00:00Z') = 5.00")
        yes(f"SELECT public.ca_club_member_chicago_cash({kings}, {butter}, '2026-11-19', '2026-11-20') = 5.00")
        yes(f"SELECT (SELECT cash_net FROM public.ca_club_members_cash_window({kings}, ARRAY[{butter}], '2026-11-19', '2026-11-20')) = 5.00")
        print('PASS preimages reproduce phantom +5.00 under post-commit attribution lag', flush=True)

        # Apply the candidate migration!
        q(MIGRATION.read_text())

        # Prove all 3 functions now return 0.00 on Chicago 2026-11-19 and -5.00 on Chicago 2026-11-18!
        yes(f"SELECT public.ca_club_member_chicago_today_cash({kings}, {butter}, '2026-11-19 17:00:00Z') = 0")
        yes(f"SELECT public.ca_club_member_chicago_cash({kings}, {butter}, '2026-11-19', '2026-11-20') = 0")
        yes(f"SELECT (SELECT cash_net FROM public.ca_club_members_cash_window({kings}, ARRAY[{butter}], '2026-11-19', '2026-11-20')) = 0")

        yes(f"SELECT public.ca_club_member_chicago_today_cash({kings}, {butter}, '2026-11-19 02:50:00Z') = -5.00")
        yes(f"SELECT public.ca_club_member_chicago_cash({kings}, {butter}, '2026-11-18', '2026-11-19') = -5.00")
        yes(f"SELECT (SELECT cash_net FROM public.ca_club_members_cash_window({kings}, ARRAY[{butter}], '2026-11-18', '2026-11-19')) = -5.00")
        print('PASS additive fix eliminates phantom +5.00 on 2026-11-19 and preserves -5.00 on 2026-11-18', flush=True)

        # Prove full raw equivalence across DST 23h, DST 25h, single-day, 2-day, multi-week, overall, empty/reversed, and cutoff.
        q('TRUNCATE ca_hand_facts, member_record_daily_facts, rake_attributions, cash_participant_funding_receipts, ca_launch_accounting_boundaries;')
        u2 = "md5('u2')::uuid"
        q(f"""
            WITH pts(ts, net) AS (VALUES
              -- DST spring forward 2026-03-08 (23h: 06:00Z .. 2026-03-09 05:00Z)
              ('2026-03-08 05:59:59.999999Z'::timestamptz, 100::numeric),
              ('2026-03-08 06:00:00Z'::timestamptz, 11::numeric),
              ('2026-03-08 23:59:59.999999Z'::timestamptz, 13::numeric),
              ('2026-03-09 00:00:00Z'::timestamptz, 17::numeric),
              ('2026-03-09 04:59:59.999999Z'::timestamptz, 19::numeric),
              ('2026-03-09 05:00:00Z'::timestamptz, 23::numeric),
              -- Interior full UTC days
              ('2026-03-10 12:00:00Z'::timestamptz, 29::numeric),
              ('2026-03-11 12:00:00Z'::timestamptz, 31::numeric),
              -- DST fall back 2026-11-01 (25h: 05:00Z .. 2026-11-02 06:00Z)
              ('2026-11-01 04:59:59.999999Z'::timestamptz, 200::numeric),
              ('2026-11-01 05:00:00Z'::timestamptz, 37::numeric),
              ('2026-11-02 05:59:59.999999Z'::timestamptz, 41::numeric),
              ('2026-11-02 06:00:00Z'::timestamptz, 43::numeric)
            )
            INSERT INTO ca_hand_facts(hand_id, user_id, club_id, table_id, tournament_id, played_at, game_variant, net, rake_paid)
            SELECT md5(ts::text)::uuid, {u2}, {kings}, md5('t2')::uuid, NULL, ts, 'nlh', net, 0
            FROM pts;
            INSERT INTO member_record_daily_facts(club_id, user_id, played_on, game_variant, is_mtt, hands, wins, vpip_hands, pfr_hands, tb_hands, faced_tb, folded_tb, cb_hands, cb_opps, fees, net, accounting_cutoff)
            SELECT club_id, user_id, (played_at AT TIME ZONE 'UTC')::date, game_variant, false, count(*), count(*) FILTER (WHERE net > 0), 0, 0, 0, 0, 0, 0, 0, 0, sum(net), NULL
            FROM ca_hand_facts GROUP BY 1, 2, 3, 4;
        """)

        windows = [
            ('2026-03-08', '2026-03-09'),  # 23h DST single day (0 interior UTC days)
            ('2026-03-08', '2026-03-10'),  # 2 days (1 interior UTC day)
            ('2026-03-08', '2026-03-12'),  # 4 days (3 interior UTC days)
            ('2026-11-01', '2026-11-02'),  # 25h DST single day
            ('2026-11-01', '2026-11-03'),  # 2 days across DST fall back
            ('2026-03-07', '2026-11-04'),  # multi-month window
        ]
        for s, e in windows:
            raw = f"""
                SELECT coalesce(sum(f.net), 0) FROM ca_hand_facts f
                WHERE f.user_id = {u2} AND f.tournament_id IS NULL
                  AND f.played_at >= '{s}'::date::timestamp AT TIME ZONE 'America/Chicago'
                  AND f.played_at < '{e}'::date::timestamp AT TIME ZONE 'America/Chicago'
            """
            yes(f"SELECT public.ca_club_member_chicago_cash({kings}, {u2}, '{s}', '{e}') = ({raw})")
            yes(f"SELECT (SELECT cash_net FROM public.ca_club_members_cash_window({kings}, ARRAY[{u2}], '{s}', '{e}')) = ({raw})")
        # Single-day today_cash on DST 23h and 25h days
        yes(f"SELECT public.ca_club_member_chicago_today_cash({kings}, {u2}, '2026-03-08 12:00:00Z') = 60")
        yes(f"SELECT public.ca_club_member_chicago_today_cash({kings}, {u2}, '2026-11-01 12:00:00Z') = 78")
        # Empty / reversed / NULL bounds
        yes(f"SELECT public.ca_club_member_chicago_cash({kings}, {u2}, '2026-03-08', '2026-03-08') = 0")
        yes(f"SELECT public.ca_club_member_chicago_cash({kings}, {u2}, '2026-03-09', '2026-03-08') = 0")
        yes(f"SELECT public.ca_club_member_chicago_cash({kings}, {u2}, NULL, '2026-03-09') = 0")
        yes(f"SELECT (SELECT cash_net FROM public.ca_club_members_cash_window({kings}, ARRAY[{u2}], '2026-03-08', '2026-03-08')) = 0")
        yes(f"SELECT (SELECT cash_net FROM public.ca_club_members_cash_window({kings}, ARRAY[{u2}], NULL, NULL)) = (SELECT sum(net) FROM ca_hand_facts WHERE user_id = {u2})")
        print('PASS DST 23h/25h, multi-day, overall, and empty/reversed ranges match raw facts', flush=True)

        # Verify ACLs preserved (private internal helpers only).
        for role in ['anon', 'authenticated', 'service_role']:
            q(f"SET ROLE {role}; SELECT public.ca_club_member_chicago_today_cash({kings}, {u2});", 'permission denied')
            q(f"SET ROLE {role}; SELECT public.ca_club_member_chicago_cash({kings}, {u2}, '2026-03-08', '2026-03-09');", 'permission denied')
            q(f"SET ROLE {role}; SELECT * FROM public.ca_club_members_cash_window({kings}, ARRAY[{u2}], '2026-03-08', '2026-03-09');", 'permission denied')
        print('PASS private ACLs preserved for all three functions', flush=True)

    finally:
        if started:
            run([args.pg_bin / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])
        shutil.rmtree(w, ignore_errors=True)


if __name__ == '__main__':
    main()
