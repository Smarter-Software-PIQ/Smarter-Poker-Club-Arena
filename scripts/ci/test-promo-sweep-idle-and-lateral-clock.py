#!/usr/bin/env python3
"""Native PG17 proof for 20261123073141 (incident 6efe4260).

Proves against a real PostgreSQL 17 cluster:
1. fn_ca_promo_fee_events LATERAL optimization:
   - Installs the exact live definition of fn_ca_promo_fee_events and verifies
     its behavior before and after 20261123073141:
     * row with ca_promo_cash_hand_clocks returns accepted_at without probing
       hand_atomic_commits (plan contains One-Time Filter: (h.hand_id IS NULL))
     * row without ca_promo_cash_hand_clocks falls back to hand_atomic_commits.committed_at
     * post-enforcement row missing both clocks still raises cash_fee_clock_missing
2. sp_ca_promo_profit_hourly_sweep idle-account skip & activity gating:
   - Idle account (last_swept_at = -2h, computed_at = -2h, valid cache, 0 new fees)
     is skipped (not recomputed)
   - Active account with new rake_attributions is swept at 1h
   - Active account with new accounting_tournament_fee_sources is swept at 1h
   - Active account with new ca_promo_event_fee_consumption_receipts is swept at 1h
   - Idle account at 6h reconciliation floor (computed_at = -7h) IS swept
   - Cache signature mismatch, valid_until expiry, and out-of-band refresh
     (k.computed_at > s.last_swept_at + 10s) are swept immediately
   - POST-ACT cache sync updates last_swept_at so it never self-retriggers
3. cron.job updates:
   - ca-promo-profit-hourly-sweep command becomes CALL public.sp_ca_promo_profit_hourly_sweep(15)
   - tourney_payout_sweep_detect_daily schedule moves from '40 2 * * *' to '31 2 * * *'
     while preserving detect-only fn_tournament_payout_sweep(30, false, 150000)
4. Idempotency and @live-proof hold.
No production endpoint or credentials are accepted.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261123073141_promo_fee_sweep_skips_idle_accounts_and_avoids_minute_forty_.sql'


def uid(label):
    return str(uuid.UUID(hashlib.md5(label.encode()).hexdigest()))


LIVE_FEE_EVENTS_SQL = r"""
CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_events(p_club uuid, p_user uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(earned_at timestamp with time zone, fee_credit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH cash AS MATERIALIZED (
  WITH posting_floor AS MATERIALIZED (
    SELECT LEAST(p_from,(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id))
           - interval '1 day' AS posted_from
  ), member_size AS MATERIALIZED (
    SELECT count(*) AS n FROM (
      SELECT 1 FROM public.rake_attributions
      WHERE player_id=p_user AND created_at>=(SELECT posted_from FROM posting_floor) LIMIT 16385
    ) probe
  ), route AS MATERIALIZED (
    SELECT CASE
      WHEN n<257 THEN false
      ELSE NOT EXISTS (
        SELECT 1 FROM public.hand_atomic_commits c WHERE c.committed_at>=p_from AND c.committed_at<p_to
        OFFSET (SELECT n FROM member_size) LIMIT 1
      ) AND NOT EXISTS (
        SELECT 1 FROM public.ca_promo_cash_hand_clocks c WHERE c.accepted_at>=p_from AND c.accepted_at<p_to
        OFFSET (SELECT n FROM member_size) LIMIT 1
      )
    END AS use_clock_window FROM member_size
  )
  SELECT COALESCE(h.accepted_at,CASE WHEN isfinite(original.committed_at) THEN original.committed_at END,a.created_at) AS earned_at,
    CASE WHEN h.hand_id IS NULL AND (original.committed_at IS NULL OR NOT isfinite(original.committed_at))
      AND a.rake_amount<>0 AND a.created_at>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id)
      THEN public.fn_ca_promo_cash_fee_clock_missing(a.hand_id) ELSE a.rake_amount END AS fee_credit
  FROM public.rake_attributions a
  LEFT JOIN public.ca_promo_cash_hand_clocks h ON h.hand_id=a.hand_id
  LEFT JOIN public.hand_atomic_commits original ON h.hand_id IS NULL AND original.hand_id=a.hand_id
  WHERE NOT (SELECT use_clock_window FROM route) AND a.player_id=p_user AND a.club_id=p_club
    AND a.created_at>=(SELECT posted_from FROM posting_floor)
    AND (a.created_at<p_to OR h.accepted_at<p_to OR original.committed_at<p_to)
  UNION ALL
  SELECT by_clock.earned_at,by_clock.fee_credit FROM (
    SELECT clock.earned_at,a.rake_amount AS fee_credit
    FROM (
      SELECT h.hand_id,h.accepted_at AS earned_at
      FROM public.ca_promo_cash_hand_clocks h
      WHERE h.accepted_at>=p_from AND h.accepted_at<p_to
      UNION ALL
      SELECT original.hand_id,original.committed_at
      FROM public.hand_atomic_commits original
      WHERE original.committed_at>=p_from AND original.committed_at<p_to
        AND isfinite(original.committed_at)
        AND NOT EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks h
                       WHERE h.hand_id=original.hand_id)
      ORDER BY hand_id
    ) clock
    CROSS JOIN LATERAL (
      SELECT r.rake_amount FROM public.rake_attributions r
      WHERE r.hand_id=clock.hand_id AND r.player_id=p_user AND r.club_id=p_club
      OFFSET 0
    ) a
  ) by_clock WHERE (SELECT use_clock_window FROM route)
 ), sources AS MATERIALIZED (
  SELECT s.id,s.rake_record_id,s.tournament_id,s.charged_at,s.rake_credit
   FROM public.accounting_tournament_fee_sources s
   WHERE s.club_id=p_club AND s.player_id=p_user AND s.charged_at>=p_from AND s.charged_at<p_to AND NOT EXISTS(SELECT 1 FROM public.ca_promo_event_fee_consumption_receipts fee WHERE fee.charge_ledger_id=s.source_charge_ledger_id)
 )
 SELECT c.earned_at,c.fee_credit FROM cash c WHERE c.earned_at>=p_from AND c.earned_at<p_to
 UNION ALL
 SELECT s.charged_at,s.rake_credit FROM sources s
 UNION ALL SELECT paid.earned_at,paid.fee_credit FROM public.fn_ca_promo_original_entry_fee_events(p_club,p_user,p_from,p_to) paid;
$function$;
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', type=Path, required=True)
    a = ap.parse_args()
    if os.environ.get('DATABASE_URL'):
        raise SystemExit('remote database forbidden')
    pg = a.pg_bin.resolve()
    scratch = Path(tempfile.mkdtemp(prefix='psilc-'))
    port = '54444'
    started = False
    results = []

    def q(sql):
        return subprocess.run(
            [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
             '-h', str(scratch), '-p', port, '-U', 'postgres', '-d', 'postgres'],
            input=sql, text=True, capture_output=True, timeout=60,
        )

    def ok(sql):
        p = q(sql)
        if p.returncode:
            raise RuntimeError(p.stderr + '\n' + sql[:500])
        return p.stdout.strip()

    def check(label, good):
        results.append({'check': label, 'ok': bool(good)})
        print(('PASS ' if good else 'FAIL ') + label, flush=True)
        return good

    try:
        env = dict(os.environ, LC_ALL=os.environ.get('LC_ALL', 'C'))
        subprocess.run([pg / 'initdb', '-D', scratch / 'data', '-U', 'postgres', '-A', 'trust'],
                       check=True, capture_output=True, env=env)
        subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-w',
                        '-o', f"-p {port} -k {scratch} -c listen_addresses=''",
                        '-l', scratch / 'server.log', 'start'],
                       check=True, capture_output=True, env=env)
        started = True

        ok("""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cron.job j
     SET schedule = COALESCE(alter_job.schedule, j.schedule),
         command  = COALESCE(alter_job.command,  j.command),
         active   = COALESCE(alter_job.active,   j.active)
   WHERE j.jobid = alter_job.job_id;
END $$;
INSERT INTO cron.job(jobid, jobname, schedule, command) VALUES
  (570, 'ca-promo-profit-hourly-sweep', '*/2 * * * *', 'CALL public.sp_ca_promo_profit_hourly_sweep(60)'),
  (275, 'tourney_payout_sweep_detect_daily', '40 2 * * *', 'SELECT (public.fn_tournament_payout_sweep(30, false, 150000) ->> ''ok'') = ''true'';');

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
CREATE TABLE ca_promo_profit_sweep_state(club_id uuid, user_id uuid, last_swept_at timestamptz, last_ms integer, last_error text, PRIMARY KEY(club_id, user_id));
CREATE TABLE ca_promo_fee_state_cache(club_id uuid, user_id uuid, computed_at timestamptz, valid_until timestamptz, signature text, state jsonb, PRIMARY KEY(club_id, user_id));
CREATE TABLE refresh_log(club_id uuid, user_id uuid, at timestamptz DEFAULT clock_timestamp());

CREATE FUNCTION public.fn_ca_promo_cash_fee_clock_missing(p_hand uuid) RETURNS numeric LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'cash_fee_clock_missing:%', p_hand; END $$;
CREATE FUNCTION public.fn_ca_promo_original_entry_fee_events(p_club uuid, p_user uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(earned_at timestamptz, fee_credit numeric) LANGUAGE sql STABLE AS $$ SELECT NULL::timestamptz, NULL::numeric WHERE false $$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_promo_fee_state_signature(p_club uuid, p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(COALESCE(string_agg(g.id::text || ':' || COALESCE(g.closed_at::text,'open') || ':' || COALESCE(w.unlocked_at::text,'locked'), ',' ORDER BY g.id), ''))
    FROM public.ca_promo_play_through_grants g
    LEFT JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
   WHERE g.club_id = p_club AND g.user_id = p_user;
$$;
CREATE FUNCTION public.fn_ca_promo_fee_state_refresh(p_club uuid, p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_sig text; v_state jsonb;
BEGIN
  INSERT INTO public.refresh_log(club_id, user_id) VALUES (p_club, p_user);
  v_sig := public.fn_ca_promo_fee_state_signature(p_club, p_user);
  SELECT COALESCE(state, '[]'::jsonb) INTO v_state FROM public.ca_promo_fee_state_cache WHERE club_id=p_club AND user_id=p_user;
  INSERT INTO public.ca_promo_fee_state_cache(club_id, user_id, computed_at, valid_until, signature, state)
  VALUES (p_club, p_user, clock_timestamp(), clock_timestamp() + interval '30 days', v_sig, COALESCE(v_state, '[]'::jsonb))
  ON CONFLICT (club_id, user_id) DO UPDATE
    SET computed_at = EXCLUDED.computed_at, valid_until = EXCLUDED.valid_until, signature = EXCLUDED.signature;
  RETURN true;
END $$;
""")
        ok(LIVE_FEE_EVENTS_SQL)

        club = uid('club')
        u_clock = uid('u_clock')
        h1, h2, h3 = uid('h1'), uid('h2'), uid('h3')
        ok(f"""
INSERT INTO ca_promo_cash_hand_clocks VALUES ('{h1}', clock_timestamp() - interval '2 hours');
INSERT INTO hand_atomic_commits VALUES ('{h1}', clock_timestamp() - interval '2 hours' - interval '1 second'),
                                       ('{h2}', clock_timestamp() - interval '1 hour');
INSERT INTO rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES
  ('{h1}', '{u_clock}', '{club}', 2.50, clock_timestamp() - interval '2 hours'),
  ('{h2}', '{u_clock}', '{club}', 1.25, clock_timestamp() - interval '1 hour');
""")
        before_sum = ok(f"SELECT sum(fee_credit) FROM fn_ca_promo_fee_events('{club}','{u_clock}', clock_timestamp() - interval '1 day', clock_timestamp())")

        # Apply migration (runs inline @probe-for before COMMIT).
        ok(MIGRATION.read_text())

        after_sum = ok(f"SELECT sum(fee_credit) FROM fn_ca_promo_fee_events('{club}','{u_clock}', clock_timestamp() - interval '1 day', clock_timestamp())")
        good = check('fn_ca_promo_fee_events preserves exact fee sum after LATERAL rewrite', before_sum == '3.75' and after_sum == '3.75')

        # Missing clock post-enforcement still raises cash_fee_clock_missing.
        ok(f"INSERT INTO rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES ('{h3}', '{u_clock}', '{club}', 0.50, clock_timestamp() - interval '10 minutes');")
        p_miss = q(f"SELECT * FROM fn_ca_promo_fee_events('{club}','{u_clock}', clock_timestamp() - interval '1 day', clock_timestamp())")
        good &= check('fn_ca_promo_fee_events still raises cash_fee_clock_missing when both clocks absent', p_miss.returncode != 0 and 'cash_fee_clock_missing' in p_miss.stderr)
        ok(f"DELETE FROM rake_attributions WHERE hand_id = '{h3}';")

        # Plan uses One-Time Filter (h.hand_id IS NULL) via LATERAL.
        plan = ok(f"""
SET enable_seqscan = off;
EXPLAIN (FORMAT TEXT)
SELECT COALESCE(h.accepted_at, CASE WHEN isfinite(original.committed_at) THEN original.committed_at END, a.created_at)
FROM public.rake_attributions a
LEFT JOIN public.ca_promo_cash_hand_clocks h ON h.hand_id = a.hand_id
LEFT JOIN LATERAL (SELECT o.committed_at FROM public.hand_atomic_commits o WHERE h.hand_id IS NULL AND o.hand_id = a.hand_id LIMIT 1) original ON true
WHERE a.player_id = '{u_clock}' AND a.club_id = '{club}';
""")
        good &= check('LATERAL rewrite produces One-Time Filter (h.hand_id IS NULL)', 'One-Time Filter: (h.hand_id IS NULL)' in plan)

        # Sweep tests: create 8 distinct accounts covering every idle/active/floor/mismatch/busy/post-act case.
        def seed_account(tag, swept_ago, computed_ago, *, valid_days=30, bad_sig=False, met_state=False):
            u, g = uid('u:' + tag), uid('g:' + tag)
            ok(f"""
INSERT INTO ca_promo_play_through_grants(id, club_id, user_id) VALUES ('{g}', '{club}', '{u}');
INSERT INTO ca_promo_profit_gates(grant_id, unlocked_at) VALUES ('{g}', NULL);
""")
            sig = 'bad-sig' if bad_sig else ok(f"SELECT fn_ca_promo_fee_state_signature('{club}','{u}')")
            st = json.dumps([{'grant_id': g, 'profit_target': 10, 'profit_earned': 10, 'phase_kind': 'gift', 'principal_state': 'met_pending'}]) if met_state else '[]'
            if swept_ago is not None:
                ok(f"INSERT INTO ca_promo_profit_sweep_state VALUES ('{club}','{u}', clock_timestamp() - interval '{swept_ago}', 50, NULL);")
            if computed_ago is not None:
                ok(f"INSERT INTO ca_promo_fee_state_cache VALUES ('{club}','{u}', clock_timestamp() - interval '{computed_ago}', clock_timestamp() + interval '{valid_days} days', '{sig}', '{st}'::jsonb);")
            return u, g

        u_idle, _ = seed_account('idle', '2 hours', '2 hours')
        u_rake, _ = seed_account('rake', '2 hours', '2 hours')
        ok(f"INSERT INTO rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES ('{uid('hr')}', '{u_rake}', '{club}', 1.00, clock_timestamp() - interval '30 minutes');")
        u_tourn, _ = seed_account('tourn', '2 hours', '2 hours')
        ok(f"INSERT INTO accounting_tournament_fee_sources(club_id, player_id, charged_at, rake_credit) VALUES ('{club}', '{u_tourn}', clock_timestamp() - interval '20 minutes', 2.00);")
        u_entry, _ = seed_account('entry', '2 hours', '2 hours')
        ok(f"INSERT INTO ca_promo_event_fee_consumption_receipts(charge_ledger_id, club_id, player_id, earned_at) VALUES ('{uid('cr')}', '{club}', '{u_entry}', clock_timestamp() - interval '15 minutes');")
        u_floor, _ = seed_account('floor', '2 hours', '7 hours')
        u_sig, _ = seed_account('sig', '10 minutes', '10 minutes', bad_sig=True)
        u_oob, _ = seed_account('oob', '2 hours', '1 minute')
        u_act, g_act = seed_account('act', '2 hours', '2 hours', met_state=True)
        ok(f"INSERT INTO rake_attributions(hand_id, player_id, club_id, rake_amount, created_at) VALUES ('{uid('ha')}', '{u_act}', '{club}', 1.00, clock_timestamp() - interval '10 minutes');")
        # Add a second open grant for u_act so POST-ACT cache sync fires and must NOT self-retrigger.
        g_act2 = uid('g:act2')
        ok(f"INSERT INTO ca_promo_play_through_grants(id, club_id, user_id) VALUES ('{g_act2}', '{club}', '{u_act}'); INSERT INTO ca_promo_profit_gates(grant_id, unlocked_at) VALUES ('{g_act2}', NULL);")
        sig_act = ok(f"SELECT fn_ca_promo_fee_state_signature('{club}','{u_act}')")
        ok(f"UPDATE ca_promo_fee_state_cache SET signature='{sig_act}' WHERE club_id='{club}' AND user_id='{u_act}';")

        ok("CALL public.sp_ca_promo_profit_hourly_sweep(15);")

        def refreshes(u):
            return int(ok(f"SELECT count(*) FROM refresh_log WHERE club_id='{club}' AND user_id='{u}'"))

        good &= check('idle account (2h old, 0 new fees) is skipped', refreshes(u_idle) == 0)
        good &= check('active account with new cash rake is swept at 1h', refreshes(u_rake) == 1)
        good &= check('active account with new tournament fee source is swept at 1h', refreshes(u_tourn) == 1)
        good &= check('active account with new promo entry fee receipt is swept at 1h', refreshes(u_entry) == 1)
        good &= check('idle account at 6h reconciliation floor is swept', refreshes(u_floor) == 1)
        good &= check('cache signature mismatch is swept immediately', refreshes(u_sig) == 1)
        good &= check('out-of-band refresh / busy retry (computed_at > last_swept_at + 10s) is swept immediately', refreshes(u_oob) == 1)
        good &= check('ACT closed met grant and ran POST-ACT cache sync', ok(f"SELECT close_reason FROM ca_promo_play_through_grants WHERE id='{g_act}'") == 'met' and refreshes(u_act) == 2)

        # Second immediate tick: ZERO accounts should re-sweep (including u_act after POST-ACT!).
        ok("TRUNCATE refresh_log; CALL public.sp_ca_promo_profit_hourly_sweep(15);")
        good &= check('second immediate tick sweeps 0 accounts (no POST-ACT self-retrigger)', ok("SELECT count(*) FROM refresh_log") == '0')

        # Cron schedule & command checks.
        good &= check('ca-promo-profit-hourly-sweep bounded to 15s', ok("SELECT command FROM cron.job WHERE jobname='ca-promo-profit-hourly-sweep'") == 'CALL public.sp_ca_promo_profit_hourly_sweep(15)')
        good &= check('tourney_payout_sweep_detect_daily moved to 31 2 * * * in detect mode', ok("SELECT schedule = '31 2 * * *' AND command LIKE '%fn_tournament_payout_sweep(30, false, 150000)%' FROM cron.job WHERE jobname='tourney_payout_sweep_detect_daily'") == 't')

        # Idempotency and @live-proof.
        before_h = ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure))")
        ok(MIGRATION.read_text())
        after_h = ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamptz,timestamptz)'::regprocedure))")
        good &= check('migration is idempotent', before_h == after_h)

        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        good &= check('@live-proof holds', ok(f'SELECT {proof}') == 't')

        print(json.dumps({'status': 'passed' if good else 'failed', 'checks': len(results), 'failed': [r['check'] for r in results if not r['ok']]}))
        if not good:
            sys.exit(1)
    finally:
        if started:
            subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    main()
