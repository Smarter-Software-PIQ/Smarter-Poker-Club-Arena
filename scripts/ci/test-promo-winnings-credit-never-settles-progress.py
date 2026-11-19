#!/usr/bin/env python3
"""A promo winnings credit never settles promo progress inside a payout (incident 075013fd, lane E3).

Native PostgreSQL 16/17 proof for migration
20261119053144_a_promo_winnings_credit_never_settles_promo_progress_inside_.sql.

Fixture: the production bodies (md5 pinned) of fn_ca_promo_profit_credit_owned,
fn_ca_promo_profit_settle, the hourly fee-state snapshot readers
(20261119002019, byte for byte), fn_ca_promo_profit_locked_at and
fn_ca_promo_profit_finish_entry_fee, on production's column shapes. Only the
live fee-history recomputation (fn_ca_promo_shared_fee_state_live) is a stub:
it answers from a truth table and sleeps a fixed cost per call, standing in
for production's 1.1 s mean.

Proves, on a disposable cluster:
  1. the restriction outcome of every holder state, before and after: gate
     released, overridden, zero credit, replay, locked below target with a
     current snapshot, locked above target with a stale-but-current snapshot,
     locked without a current snapshot below target: all identical. The two
     states production decided with a live recomputation (target met since
     the last hourly look) are held under the locked gate after, and the live
     cash-out settle then releases them, leaving no chip locked;
  2. payout time: 20 promo holders without a current snapshot cost 20 live
     recomputations before and none after;
  3. chips conserved: every credit is either restricted whole or free, the
     custody delta equals the restricted total, one receipt per credit, no
     fee phase is created where the old path would not have created one;
  4. the entry fee consumes exactly once and never settles, satellite seat
     or paid entry;
  5. the guard refuses a second apply, atomically, and the @live-proof pins
     the installed md5s.

Usage: PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/ci/test-promo-winnings-credit-never-settles-progress.py
"""
import os, re, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = next((ROOT / 'supabase/migrations').glob('20261119053144_*.sql'))
SNAPSHOT = next((ROOT / 'supabase/migrations').glob('20261119002019_*.sql'))
SATELLITE = next((ROOT / 'supabase/migrations').glob('20261119002717_*.sql'))
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
CREDIT = "public.fn_ca_promo_profit_credit_owned(text,uuid,uuid,uuid,uuid,text,uuid,numeric)"
ENTRY = "public.fn_ca_promo_profit_finish_entry_fee(uuid)"
PROD = {CREDIT: '194f2cc0e53d6735f1b3e9057f9200cb', ENTRY: '345276d56957bf1e181d713b1c2bf758',
        'public.fn_ca_promo_profit_settle(uuid,uuid)': 'e8c6818d01c912a47236cc61f0cb77d5'}
LIVE_COST = 0.25  # seconds per live recomputation in the fixture

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
CREATE UNIQUE INDEX ca_promo_profit_one_open_phase ON public.ca_promo_profit_fee_phases(grant_id) WHERE closed_at IS NULL;
CREATE TABLE public.ca_promo_profit_custody(grant_id uuid NOT NULL, club_id uuid NOT NULL, user_id uuid NOT NULL, kind text NOT NULL, entity_id uuid NOT NULL, amount numeric NOT NULL,
 PRIMARY KEY(grant_id,club_id,user_id,kind,entity_id));
CREATE TABLE public.ca_promo_profit_realization_receipts(source_kind text NOT NULL, source_id uuid NOT NULL, grant_id uuid NOT NULL, club_id uuid NOT NULL, user_id uuid NOT NULL,
 kind text NOT NULL, entity_id uuid NOT NULL, amount numeric NOT NULL, restricted numeric NOT NULL, phase_id uuid, recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
 PRIMARY KEY(source_kind,source_id,grant_id));
CREATE TABLE public.ca_promo_fee_state_cache(club_id uuid NOT NULL, user_id uuid NOT NULL, computed_at timestamptz NOT NULL, valid_until timestamptz NOT NULL,
 signature text NOT NULL, state jsonb NOT NULL, PRIMARY KEY(club_id,user_id));
CREATE TABLE public.ca_promo_profit_event_lots(grant_id uuid, charge_ledger_id uuid);
CREATE TABLE public.ca_promo_event_principal_lots(grant_id uuid, charge_ledger_id uuid);
CREATE TABLE public.ca_promo_event_fee_consumption_receipts(charge_ledger_id uuid, club_id uuid, player_id uuid);
CREATE TABLE public.tournament_refund_entitlements(source_ledger_id uuid, entitlement_kind text);
-- The fee history's answer per grant, and a meter of every live recomputation.
CREATE TABLE public.fx_truth(grant_id uuid PRIMARY KEY, profit_target numeric, profit_earned numeric);
CREATE TABLE public.fx_calls(fn text, a uuid, b uuid);
CREATE FUNCTION public.fn_ca_promo_shared_fee_state_live(p_club uuid, p_user uuid)
 RETURNS TABLE(grant_id uuid, fee_start numeric, fees numeric, principal_target numeric, profit_target numeric, principal_state text, profit_state text,
  consumed_prefix numeric, phase_id uuid, phase_kind text, profit_earned numeric)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $f$
BEGIN
 INSERT INTO public.fx_calls VALUES('live',p_club,p_user);
 PERFORM pg_sleep(%(cost)s);
 RETURN QUERY SELECT t.grant_id,0::numeric,t.profit_earned,0::numeric,t.profit_target,'closed'::text,
   CASE WHEN w.unlocked_at IS NOT NULL THEN 'met' WHEN t.profit_earned>=t.profit_target THEN 'met_pending' ELSE 'locked' END,
   0::numeric,p.id,p.source_kind,t.profit_earned
  FROM public.fx_truth t JOIN public.ca_promo_play_through_grants g ON g.id=t.grant_id
  JOIN public.ca_promo_profit_gates w ON w.grant_id=g.id
  LEFT JOIN public.ca_promo_profit_fee_phases p ON p.grant_id=g.id AND p.closed_at IS NULL
  WHERE g.club_id=p_club AND g.user_id=p_user;
END $f$;
CREATE FUNCTION public.fn_ca_promo_profit_consume_entry_fee(p_charge uuid) RETURNS boolean
 LANGUAGE sql AS $$ INSERT INTO public.fx_calls VALUES('consume', p_charge, NULL) RETURNING true $$;
""" % {'cost': LIVE_COST}

# Production body, byte for byte (pg_get_functiondef 2026-11-19 05:25 UTC).
CREDIT_BEFORE = r"""CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_credit_owned(p_source_kind text, p_source uuid, p_grant uuid, p_club uuid, p_user uuid, p_kind text, p_entity uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE g public.ca_promo_play_through_grants%ROWTYPE;prior public.ca_promo_profit_realization_receipts%ROWTYPE;
 phase uuid;restricted numeric:=0;
BEGIN
 IF p_source_kind NOT IN('cash_win','tournament_win','bbj','stake_refund') OR p_source IS NULL OR p_club IS NULL OR p_user IS NULL OR p_entity IS NULL
 OR p_kind NOT IN('player_wallet','agent_wallet','table_stack','pending_addon','event','ticket') OR p_amount IS NULL OR p_amount<0 OR p_amount<>round(p_amount,2)
 OR p_amount::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_original_winnings_realization';END IF;
 SELECT * INTO STRICT g FROM public.ca_promo_play_through_grants WHERE id=p_grant FOR UPDATE;
 IF g.user_id IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'original_winnings_recipient_mismatch';END IF;
 SELECT * INTO prior FROM public.ca_promo_profit_realization_receipts WHERE source_kind=p_source_kind AND source_id=p_source AND grant_id=p_grant;
 IF FOUND THEN
  IF ROW(prior.club_id,prior.user_id,prior.kind,prior.entity_id,prior.amount) IS DISTINCT FROM ROW(p_club,p_user,p_kind,p_entity,p_amount) THEN RAISE EXCEPTION 'original_winnings_realization_identity_reused';END IF;
  RETURN prior.restricted;
 END IF;
 PERFORM public.fn_ca_promo_profit_settle(g.club_id,g.user_id);
 IF p_amount>0 AND EXISTS(SELECT 1 FROM public.ca_promo_profit_gates w WHERE w.grant_id=p_grant AND w.unlocked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=p_grant) THEN
  -- Expiry ends an empty original potential-W phase; a later exact original
  -- asset activates only now, behind all intervening gift blocks.
  IF g.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=p_grant AND c.amount>0) THEN
   UPDATE public.ca_promo_profit_fee_phases SET closed_at=g.expires_at WHERE grant_id=p_grant AND source_kind='gift' AND closed_at IS NULL;
  END IF;
  SELECT f.id INTO phase FROM public.ca_promo_profit_fee_phases f WHERE f.grant_id=p_grant AND f.closed_at IS NULL;
  IF phase IS NULL THEN
   INSERT INTO public.ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES(p_grant,p_source_kind,p_source) RETURNING id INTO phase;
  END IF;
  restricted:=p_amount;
  INSERT INTO public.ca_promo_profit_custody VALUES(p_grant,p_club,p_user,p_kind,p_entity,p_amount)
  ON CONFLICT(grant_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_custody.amount+EXCLUDED.amount;
 END IF;
 INSERT INTO public.ca_promo_profit_realization_receipts(source_kind,source_id,grant_id,club_id,user_id,kind,entity_id,amount,restricted,phase_id)
 VALUES(p_source_kind,p_source,p_grant,p_club,p_user,p_kind,p_entity,p_amount,restricted,phase);
 RETURN restricted;
END $function$
"""

LOCKED_AT = r"""CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_locked_at(p_club uuid, p_user uuid, p_kind text, p_entity uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT COALESCE(sum(c.amount),0) FROM public.ca_promo_profit_custody c
 JOIN public.ca_promo_profit_gates g ON g.grant_id=c.grant_id AND g.unlocked_at IS NULL
 WHERE c.club_id=p_club AND c.user_id=p_user AND c.kind=p_kind AND c.entity_id=p_entity
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=c.grant_id);
$function$
"""

CLUB = '00000000-0000-0000-0000-00000000c1ab'
# state -> (gate unlocked, override, snapshot current, snapshot earned, live earned, amount)
TARGET = 100
STATES = {
    'released':              (True,  False, True,  150, 150, 40),
    'overridden':            (False, True,  True,   10,  10, 40),
    'zero_credit':           (False, False, True,   10,  10, 0),
    'locked_below_current':  (False, False, True,   10,  10, 40),
    'locked_stale_current':  (False, False, True,   10, 150, 40),  # fees paid after the hourly look
    'locked_below_no_snap':  (False, False, False, None, 10, 40),
    'met_no_snap':           (False, False, False, None, 150, 40),  # decided live before
    'met_snap_pending':      (False, False, True,  150, 150, 40),  # decided live before
}
LIVE_DECIDED = {'met_no_snap', 'met_snap_pending'}


def main():
    if not (PG / 'initdb').exists():
        sys.exit(f'PostgreSQL binaries not found at {PG}; set PG_BIN')
    tmp = Path(tempfile.mkdtemp(prefix='promo-credit-'))
    data, sock = tmp / 'data', tmp / 'sock'
    sock.mkdir()
    as_user = []
    if os.geteuid() == 0:
        as_user = ['runuser', '-u', 'postgres', '--']
        subprocess.run(['chown', '-R', 'postgres', str(tmp)], check=True)
    run = lambda *a: subprocess.run(as_user + [str(x) for x in a], check=True, capture_output=True, text=True)
    run(PG / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust')
    with open(data / 'postgresql.conf', 'a') as f:
        f.write(f"\nlisten_addresses=''\nunix_socket_directories='{sock}'\nport=55443\n")
    run(PG / 'pg_ctl', '-D', data, '-l', tmp / 'log', '-w', 'start')

    def psql(sql=None, file=None, ok=True):
        r = subprocess.run(as_user + [str(PG / 'psql'), '-h', str(sock), '-p', '55443', '-U', 'postgres', '-X', '-q', '-At',
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

    def world(tag, n=1):
        """One holder per state (n per state), each with one locked-or-not grant and an open gift phase."""
        psql("TRUNCATE ca_promo_play_through_grants,ca_promo_profit_gates,ca_promo_profit_overrides,ca_promo_profit_fee_phases,"
             "ca_promo_profit_custody,ca_promo_profit_realization_receipts,ca_promo_fee_state_cache,fx_truth,fx_calls")
        rows = []
        for state, (released, override, current, snap, live, amount) in STATES.items():
            for i in range(n):
                rows.append((state, i, released, override, current, snap, live, amount))
        sql = []
        for state, i, released, override, current, snap, live, amount in rows:
            u = f"md5('{tag}:{state}:{i}:u')::uuid"
            g = f"md5('{tag}:{state}:{i}:g')::uuid"
            sql.append(f"""INSERT INTO ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,cycle_started_at,expires_at)
               VALUES({g},'{CLUB}',{u},50,0,4,'club_promo','{tag}:{state}:{i}',now(),now()+interval '30 days');
              INSERT INTO ca_promo_profit_gates VALUES({g},{'clock_timestamp()' if released else 'NULL'});
              INSERT INTO ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES({g},'gift',{g});
              INSERT INTO fx_truth VALUES({g},{TARGET},{snap if snap is not None else live});""")
            if override:
                sql.append(f"INSERT INTO ca_promo_profit_overrides(grant_id,reviewed_by,reason) VALUES({g},{u},'fixture');")
        psql('\n'.join(sql))
        # The hourly look: snapshot every account that should have one, from the
        # fee history as it stood then.
        for state, i, released, override, current, snap, live, amount in rows:
            if current:
                psql(f"SELECT fn_ca_promo_fee_state_refresh('{CLUB}',md5('{tag}:{state}:{i}:u')::uuid)")
        # Fees paid since the hourly look.
        for state, i, released, override, current, snap, live, amount in rows:
            psql(f"UPDATE fx_truth SET profit_earned={live} WHERE grant_id=md5('{tag}:{state}:{i}:g')::uuid")
        psql('TRUNCATE fx_calls')
        return rows

    def payout(tag, rows):
        """One transaction: credit every holder, as a final table's payout does."""
        stmts = [f"SELECT '{s}:{i}', fn_ca_promo_profit_credit_owned('tournament_win',md5('{tag}:payout')::uuid,"
                 f"md5('{tag}:{s}:{i}:g')::uuid,'{CLUB}',md5('{tag}:{s}:{i}:u')::uuid,'player_wallet',md5('{tag}:{s}:{i}:u')::uuid,{amt});"
                 for s, i, _r, _o, _c, _sn, _l, amt in rows]
        t0 = time.monotonic()
        out = psql('BEGIN;' + ''.join(stmts) + 'COMMIT;').stdout.split()
        return dict(l.split('|') for l in out), time.monotonic() - t0

    def settles(charge):
        """Consumes and settles one entry-fee finish makes, counted by the function-call statistics."""
        r = psql(f"""BEGIN; SET LOCAL track_functions='all'; TRUNCATE fx_calls;
          SELECT fn_ca_promo_profit_finish_entry_fee('{charge}');
          SELECT 'consume:'||(SELECT count(*) FROM fx_calls WHERE fn='consume')||' settle:'||
           COALESCE(pg_stat_get_xact_function_calls('public.fn_ca_promo_profit_settle(uuid,uuid)'::regprocedure),0); COMMIT;""").stdout.split('\n')
        return [l for l in r if l.startswith('consume:')][0].strip()

    def ledger(tag):
        return one("SELECT (SELECT count(*) FROM ca_promo_profit_realization_receipts)||'|'||"
                   "(SELECT COALESCE(sum(amount),0) FROM ca_promo_profit_realization_receipts)||'|'||"
                   "(SELECT COALESCE(sum(restricted),0) FROM ca_promo_profit_realization_receipts)||'|'||"
                   "(SELECT COALESCE(sum(amount),0) FROM ca_promo_profit_custody)||'|'||"
                   "(SELECT count(*) FROM ca_promo_profit_fee_phases)||'|'||"
                   "(SELECT count(*) FROM ca_promo_profit_realization_receipts WHERE restricted NOT IN(0,amount))")

    try:
        psql(SCHEMA)
        snap = SNAPSHOT.read_text()
        psql(snap[snap.index('-- Everything the recomputation reads'):snap.index('-- A principal release is decided')])
        psql(CREDIT_BEFORE)
        psql(LOCKED_AT)
        sat = SATELLITE.read_text()
        psql(sat[sat.index('CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_finish_entry_fee'):sat.index('REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_finish_entry_fee')])
        for sig, want in PROD.items():
            check(f'fixture {sig} is the production body (md5 {want})', md5(sig) == want)

        # ---- before -------------------------------------------------------
        rows = world('b')
        before, t_before = payout('b', rows)
        calls_before = int(one("SELECT count(*) FROM fx_calls WHERE fn='live'"))
        led_before = ledger('b')
        replay_before = one(f"SELECT fn_ca_promo_profit_credit_owned('tournament_win',md5('b:payout')::uuid,md5('b:locked_below_current:0:g')::uuid,"
                            f"'{CLUB}',md5('b:locked_below_current:0:u')::uuid,'player_wallet',md5('b:locked_below_current:0:u')::uuid,40)")

        # ---- the entry fee, before ---------------------------------------
        psql("TRUNCATE fx_calls; INSERT INTO ca_promo_event_fee_consumption_receipts VALUES('00000000-0000-0000-0000-00000000c0de',"
             f"'{CLUB}',md5('b:locked_below_current:0:u')::uuid)")
        entry_before = settles('00000000-0000-0000-0000-00000000c0de')
        check(f'before: a paid entry fee is consumed once and settles its holder ({entry_before}; the settle 20261119002717 brought back)',
              entry_before == 'consume:1 settle:1')

        # ---- install ------------------------------------------------------
        psql(file=MIGRATION)
        new_credit, new_entry = md5(CREDIT), md5(ENTRY)
        text = MIGRATION.read_text()
        check(f'@live-proof pins the installed md5s (credit {new_credit}, entry {new_entry})', f"'{new_credit}'" in text and f"'{new_entry}'" in text)
        check('the credit body no longer reaches the settle',
              'fn_ca_promo_profit_settle' not in one(f"SELECT prosrc FROM pg_proc WHERE oid='{CREDIT}'::regprocedure"))
        acl = one(f"SELECT coalesce(proacl::text,'') FROM pg_proc WHERE oid='{ENTRY}'::regprocedure")
        check('the entry fee stays closed to browsers and service_role',
              not any(r + '=' in acl for r in ('anon', 'authenticated', 'service_role')) and '{=' not in acl)

        # ---- after --------------------------------------------------------
        rows = world('a')
        after, t_after = payout('a', rows)
        calls_after = int(one("SELECT count(*) FROM fx_calls WHERE fn='live'"))
        led_after = ledger('a')
        replay_after = one(f"SELECT fn_ca_promo_profit_credit_owned('tournament_win',md5('a:payout')::uuid,md5('a:locked_below_current:0:g')::uuid,"
                           f"'{CLUB}',md5('a:locked_below_current:0:u')::uuid,'player_wallet',md5('a:locked_below_current:0:u')::uuid,40)")

        for state in STATES:
            b, a = before[f'{state}:0'], after[f'{state}:0']
            if state in LIVE_DECIDED:
                check(f'{state}: before decided live and freed it ({b}); after it is held under the stored gate ({a})',
                      float(b) == 0 and float(a) == STATES[state][5])
            else:
                check(f'{state}: same restriction outcome before and after ({b} = {a})', b == a)
        check('a replayed credit returns its recorded answer, before and after', replay_before == replay_after == '40')
        check(f'payout: {calls_before} live recomputations before, {calls_after} after', calls_before >= 2 and calls_after == 0)

        # Conservation: receipts|amount|restricted|custody|phases|partial
        rb, ra = led_before.split('|'), led_after.split('|')
        check('one receipt per credit, same total credited, before and after', rb[0] == ra[0] == str(len(STATES)) and rb[1] == ra[1])
        check('custody equals the restricted total, before and after', rb[2] == rb[3] and ra[2] == ra[3])
        check('no credit is partly restricted', rb[5] == ra[5] == '0')
        check('no fee phase is created where the old path did not create one', rb[4] == ra[4])
        held = sum(STATES[s][5] for s in LIVE_DECIDED)
        check(f'the only difference is the {held} held for the two live-decided holders',
              float(ra[2]) - float(rb[2]) == held)

        # The live cash-out settle (fn_ca_promo_play_through_on_exit switches to
        # live, then settles) releases them: no chip stays locked.
        for state in LIVE_DECIDED:
            u = f"md5('a:{state}:0:u')::uuid"
            psql(f"BEGIN; SET LOCAL app.ca_promo_fee_state='live'; SELECT fn_ca_promo_profit_settle('{CLUB}',{u}); COMMIT;")
            check(f'{state}: the live cash-out settle releases the gate and nothing stays locked',
                  one(f"SELECT fn_ca_promo_profit_locked_at('{CLUB}',{u},'player_wallet',{u})") == '0')
        u = "md5('a:locked_below_current:0:u')::uuid"
        psql(f"BEGIN; SET LOCAL app.ca_promo_fee_state='live'; SELECT fn_ca_promo_profit_settle('{CLUB}',{u}); COMMIT;")
        check('below target the live settle keeps the credit locked',
              one(f"SELECT fn_ca_promo_profit_locked_at('{CLUB}',{u},'player_wallet',{u})") == '40')

        # ---- bounded payout with many holders -----------------------------
        many = [r for r in world('m', 20) if r[0] in ('met_no_snap', 'locked_below_no_snap')]
        _, t_many = payout('m', many)
        check(f'40 promo holders with no current snapshot are paid in {t_many*1000:.0f} ms with no live recomputation '
              f'(before: one {LIVE_COST*1000:.0f} ms recomputation each)',
              int(one("SELECT count(*) FROM fx_calls WHERE fn='live'")) == 0 and t_many < 2.0)

        # ---- the entry fee, after -----------------------------------------
        paid = settles('00000000-0000-0000-0000-00000000c0de')
        psql("INSERT INTO tournament_refund_entitlements VALUES('00000000-0000-0000-0000-0000000005ea','satellite_seat')")
        seat = settles('00000000-0000-0000-0000-0000000005ea')
        check(f'after: a paid entry ({paid}) and a satellite seat ({seat}) are each consumed once and never settle',
              paid == seat == 'consume:1 settle:0')

        again = psql(file=MIGRATION, ok=False)
        check('the guard refuses a second apply', again.returncode != 0 and 'revalidate before removing its settle' in again.stderr)
        check('and leaves the installed bodies as they were', md5(CREDIT) == new_credit and md5(ENTRY) == new_entry)
        print(f'PASS {asserts} assertions; payout before {t_before*1000:.0f} ms, after {t_after*1000:.0f} ms; '
              f'installed md5 credit {new_credit} entry {new_entry}')
    finally:
        subprocess.run(as_user + [str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
