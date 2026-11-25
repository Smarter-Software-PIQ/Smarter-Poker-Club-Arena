#!/usr/bin/env python3
"""A PROMO PLAYER'S LIGHTNING HAND SETTLES (20261124162105), proved on a disposable PostgreSQL.

Owner report 2026-11-24 (GRANDmasterFLUSH, PLO4 0.50/1 Lightning): after the
first hand, every hand the player was dealt was played to its end and never
settled. fn_lightning_settle_hand raised
'original_winnings_sources_exceed_accepted_stack' from
fn_ca_promo_profit_capture_cash on every attempt, the engine left each hand to
the reaper and it was voided ten minutes later. Lightning is fast-fold: a hand
is dealt from the pool stack (48), which already lacks the chips still
committed to the player's earlier, unsettled hand (2), while the promo custody
at the anchor seat only falls when that hand settles (50).

Production's installed bodies (scripts/ci/fixtures/lightning-promo-stack-before-preimages.sql,
md5-pinned by the migration) are loaded on stub tables. Every scenario runs on
the installed bodies, where the defect must reproduce (red), and after the
migration, where it must not (green). The physical-table refusal (custody above
the stack with no Lightning hand in flight) must stay a refusal. No production
connection is made.
"""
import os, pathlib, shutil, subprocess, tempfile

P = pathlib.Path
ROOT = P(__file__).resolve().parents[2]
CANDIDATE = next((ROOT / 'supabase/migrations').glob('20261124162105_*.sql'))
PREIMAGES = ROOT / 'scripts/ci/fixtures/lightning-promo-stack-before-preimages.sql'
if os.environ.get('PG_BIN'):
    PG = P(os.environ['PG_BIN'])
elif os.uname().sysname == 'Darwin':
    PG = P('/opt/homebrew/opt/postgresql@17/bin')
else:
    installed = sorted(P('/usr/lib/postgresql').glob('*/bin'),
                       key=lambda p: int(p.parent.name) if p.parent.name.isdigit() else -1, reverse=True)
    PG = next((p for p in [P('/usr/lib/postgresql/17/bin'), *installed] if (p / 'initdb').is_file()), None)
    if PG is None:
        raise SystemExit('PostgreSQL server binaries unavailable; provide PG_BIN')
parent = P(os.environ.get('TMPDIR', str(ROOT / 'work')))
parent.mkdir(exist_ok=True)
w = P(tempfile.mkdtemp(prefix='promo-lightning-', dir=parent))
sock = w / 's'
sock.mkdir()
env = {'PATH': str(PG) + ':/usr/bin:/bin', 'LC_ALL': 'C', 'LANG': 'C'}
passed = []

USER = '11111111-0000-0000-0000-000000000001'
OTHER = '22222222-0000-0000-0000-000000000002'
GRANT = '99999999-0000-0000-0000-000000000001'
CLUB = 'c0000000-0000-0000-0000-00000000000c'
ANCHOR = 'a0000000-0000-0000-0000-00000000000a'
HOST = 'b0000000-0000-0000-0000-00000000000b'
CLUSTER = 'e0000000-0000-0000-0000-00000000000e'
SLOT = '5a000000-0000-0000-0000-000000000005'
H1 = 'd1000000-0000-0000-0000-000000000001'
H2 = 'd2000000-0000-0000-0000-000000000002'
H3 = 'd3000000-0000-0000-0000-000000000003'
PHASE = 'f0000000-0000-0000-0000-000000000001'


def run(args, sql=None):
    r = subprocess.run([str(x) for x in args], input=sql, text=True, capture_output=True, env=env, timeout=90)
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout.strip()


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', 'postgres', '-d', 'postgres'], sql)


def check(ok, label):
    if not ok:
        raise AssertionError(label)
    passed.append(label)
    print('PASS', label, flush=True)


def attempt(sql):
    """None when the statement committed, else the refusal text."""
    try:
        q(sql)
        return None
    except RuntimeError as e:
        return str(e)


SCHEMA = r'''
DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
DO $$BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END$$;
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid);
CREATE TABLE public.ca_promo_play_through_settings(id boolean, enforced_from timestamptz);
CREATE TABLE public.ca_promo_cash_hand_clocks(hand_id uuid, profit_capture_version integer);
CREATE TABLE public.ca_promo_play_through_grants(id uuid, amount numeric, club_id uuid, user_id uuid, closed_at timestamptz,
  remaining numeric, granted_at timestamptz, cycle_started_at timestamptz, expires_at timestamptz, fee_target numeric);
CREATE TABLE public.ca_promo_principal_custody(kind text, amount numeric, grant_id uuid, entity_id uuid);
CREATE TABLE public.ca_promo_profit_custody(grant_id uuid, club_id uuid, user_id uuid, kind text, entity_id uuid, amount numeric);
CREATE TABLE public.ca_promo_integrity_cases(id uuid);
CREATE TABLE public.ca_promo_integrity_custody(case_id uuid, club_id uuid, user_id uuid, kind text, entity_id uuid, amount numeric);
CREATE TABLE public.ca_promo_integrity_releases(case_id uuid);
CREATE TABLE public.ca_promo_profit_gates(grant_id uuid, unlocked_at timestamptz);
CREATE TABLE public.ca_promo_profit_overrides(grant_id uuid);
CREATE TABLE public.ca_promo_profit_integrity_overlap(grant_id uuid, case_id uuid, club_id uuid, user_id uuid, kind text, entity_id uuid, amount numeric);
CREATE TABLE public.ca_promo_profit_fee_phases(id uuid, grant_id uuid, activated_at timestamptz);
CREATE TABLE public.ca_promo_profit_cash_investment(hand_id uuid, grant_id uuid, club_id uuid, user_id uuid, table_id uuid,
  phase_id uuid, principal numeric, profit numeric, eligible_contribution numeric, investment numeric);
CREATE TABLE public.ca_promo_profit_cash_positions(hand_id uuid, club_id uuid, user_id uuid, table_id uuid, stack_before numeric NOT NULL,
  stack_after numeric NOT NULL, contribution numeric NOT NULL, principal_before numeric NOT NULL, profit_before numeric NOT NULL,
  review_before numeric NOT NULL, overlap_before numeric NOT NULL, cases jsonb, grants jsonb, overlap_list jsonb,
  CHECK(stack_before>=0 AND stack_after>=0 AND contribution>=0 AND principal_before>=0 AND profit_before>=0 AND review_before>=overlap_before AND overlap_before>=0 AND overlap_before<=profit_before),
  CHECK(principal_before+profit_before+review_before-overlap_before<=stack_before));
CREATE TABLE public.ca_promo_cash_hand_funding(hand_id uuid, club_id uuid, user_id uuid, table_id uuid, principal_before numeric,
  contribution numeric, promo_contribution numeric, principal_lost numeric);
CREATE TABLE public.lightning_settlement_marker(txid xid8, seat_id uuid, anchor_table_id uuid, player_id uuid, hand_id uuid,
  host_table_id uuid, hand_number bigint, created_at timestamptz DEFAULT now());
CREATE TABLE public.lightning_hand(hand_id uuid PRIMARY KEY, cluster_id uuid, formed_at timestamptz, settled_at timestamptz, voided_at timestamptz);
CREATE TABLE public.lightning_hand_player(hand_id uuid, player_id uuid, pool_slot_id uuid, stack_before numeric,
  folded_at timestamptz, committed_at_fold numeric);
-- Leaf readers and movers the promo bodies call; their own bodies are not under test.
CREATE FUNCTION public.fn_ca_promo_play_through_state(p_club_id uuid, p_user_id uuid)
 RETURNS TABLE(grant_id uuid, amount numeric, remaining numeric, fee_target numeric, cum_target numeric, cycle_started_at timestamptz,
  cycle_fees numeric, granted_at timestamptz, expires_at timestamptz, state text)
 LANGUAGE sql AS $f$ SELECT g.id,g.amount,g.remaining,g.fee_target,g.fee_target,g.cycle_started_at,0::numeric,g.granted_at,g.expires_at,'locked'
  FROM public.ca_promo_play_through_grants g WHERE g.club_id=p_club_id AND g.user_id=p_user_id AND g.closed_at IS NULL $f$;
-- Like production's clock: an unknown hand is refused by name (the migration's probe relies on it).
CREATE FUNCTION public.fn_ca_promo_capture_cash_hand_clock(p_hand uuid, p_table uuid) RETURNS void LANGUAGE plpgsql AS
 $f$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.lightning_hand WHERE hand_id=p_hand) THEN
   RAISE EXCEPTION 'promo_cash_original_accepted_hand_missing' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.ca_promo_cash_hand_clocks(hand_id) SELECT p_hand WHERE NOT EXISTS(SELECT 1 FROM public.ca_promo_cash_hand_clocks WHERE hand_id=p_hand);
 END $f$;
CREATE FUNCTION public.fn_ca_promo_integrity_source_loss(uuid,uuid,uuid,uuid,uuid[],numeric) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public.fn_ca_promo_move_selected_custody(p_club uuid,p_user uuid,p_from text,p_from_id uuid,p_to text,p_to_id uuid,
  p_amount numeric,p_reason text,p_grants uuid[]) RETURNS numeric LANGUAGE sql AS
 $f$ UPDATE public.ca_promo_principal_custody SET amount=amount-p_amount WHERE kind=p_from AND entity_id=p_from_id AND grant_id=ANY(p_grants) RETURNING 0::numeric $f$;
'''

SEED = f'''
TRUNCATE public.tables, public.ca_promo_play_through_settings, public.ca_promo_cash_hand_clocks, public.ca_promo_play_through_grants,
  public.ca_promo_principal_custody, public.ca_promo_profit_gates, public.ca_promo_profit_fee_phases,
  public.ca_promo_profit_cash_investment, public.ca_promo_profit_cash_positions,
  public.ca_promo_cash_hand_funding, public.lightning_hand, public.lightning_hand_player;
INSERT INTO public.ca_promo_play_through_settings VALUES(true, now()-interval '1 day');
INSERT INTO public.tables VALUES('{ANCHOR}',NULL),('{HOST}',NULL);
INSERT INTO public.ca_promo_play_through_grants(id,amount,club_id,user_id,remaining,granted_at,cycle_started_at,expires_at,fee_target)
 VALUES('{GRANT}',50,'{CLUB}','{USER}',50,now()-interval '1 hour',now()-interval '1 hour',now()+interval '30 days',200);
INSERT INTO public.ca_promo_profit_gates(grant_id,unlocked_at) VALUES('{GRANT}',NULL);
INSERT INTO public.ca_promo_profit_fee_phases(id,grant_id,activated_at) VALUES('{PHASE}','{GRANT}',now()-interval '1 hour');
INSERT INTO public.ca_promo_principal_custody VALUES('table_stack',50,'{GRANT}','{ANCHOR}');
INSERT INTO public.lightning_hand(hand_id,cluster_id,formed_at) VALUES('{H1}','{CLUSTER}',now()-interval '60 s'),('{H2}','{CLUSTER}',now()-interval '30 s');
INSERT INTO public.lightning_hand_player VALUES('{H1}','{USER}','{SLOT}',50,now()-interval '35 s',2),('{H2}','{USER}','{SLOT}',48,now()-interval '5 s',2);
'''


def settle_h2(marker=True):
    """The promo half of fn_lightning_settle_hand for H2 (dealt from 48, lost its 2): None or the refusal."""
    mark = (f"INSERT INTO public.lightning_settlement_marker(txid,anchor_table_id,player_id,hand_id,host_table_id) "
            f"VALUES(pg_current_xact_id(),'{ANCHOR}','{USER}','{H2}','{HOST}');") if marker else ''
    return attempt(f'''BEGIN; {mark}
SELECT public.fn_ca_promo_accept_cash_hand('{H2}','{HOST}','[{{"user_id":"{USER}","stack_before":48,"stack":46}}]',
 '{{"contributions":{{"{USER}":2}}}}','{{"{USER}":"{ANCHOR}"}}');
DELETE FROM public.lightning_settlement_marker WHERE txid=pg_current_xact_id(); COMMIT;''')


def scenarios(fixed):
    phase = 'after the migration' if fixed else 'on the installed bodies'
    q(SEED)
    out = settle_h2()
    if fixed:
        check(out is None, f'{phase}: H2 settles while the earlier hand H1 is still running')
        check(q(f"SELECT stack_before||','||principal_before FROM public.ca_promo_profit_cash_positions WHERE hand_id='{H2}'") == '50,50',
              f'{phase}: H2 records ca_promo_profit_cash_positions with position stack_before=50 (satisfies production CHECK)')
        check(q('SELECT amount FROM public.ca_promo_principal_custody') == '46',
              f'{phase}: H2 charges the promo with the position loss (50 -> 46)')
        # H1 settles afterwards from its own 48: no further loss, custody still matches the 46 left.
        q(f"""BEGIN; INSERT INTO public.lightning_settlement_marker(txid,anchor_table_id,player_id,hand_id,host_table_id)
VALUES(pg_current_xact_id(),'{ANCHOR}','{USER}','{H1}','{HOST}');
SELECT public.fn_ca_promo_accept_cash_hand('{H1}','{HOST}','[{{"user_id":"{USER}","stack_before":50,"stack":48}}]',
 '{{"contributions":{{"{USER}":2}}}}','{{"{USER}":"{ANCHOR}"}}'); COMMIT;""")
        check(q('SELECT amount FROM public.ca_promo_principal_custody') == '46',
              f'{phase}: H1 settling after H2 does not charge the loss twice')
    else:
        check(out is not None and 'original_winnings_sources_exceed_accepted_stack' in out,
              f'{phase}: H2 is refused while H1 is still running (the reported defect)')
    q(SEED)
    q(f"UPDATE public.lightning_hand SET voided_at=now() WHERE hand_id='{H1}'")
    out = settle_h2()
    check((out is None) == fixed, f'{phase}: H2 after H1 was voided ' + ('settles' if fixed else 'is refused'))
    q(SEED)
    q(f"UPDATE public.lightning_hand SET settled_at=now() WHERE hand_id='{H1}'; UPDATE public.ca_promo_principal_custody SET amount=48")
    check(settle_h2() is None, f'{phase}: H2 after H1 settled (custody already 48) settles')
    q(SEED)
    out = settle_h2(marker=False)
    check(out is not None and 'original_winnings_sources_exceed_accepted_stack' in out,
          f'{phase}: a physical hand with custody above its stack is still refused')
    if fixed:
        q(SEED)
        got = q(f"""BEGIN; INSERT INTO public.lightning_settlement_marker(txid,anchor_table_id,player_id,hand_id)
VALUES(pg_current_xact_id(),'{ANCHOR}','{USER}','{H2}');
SELECT public.fn_ca_promo_position_stack_before('{USER}','{ANCHOR}',48)||','||
 public.fn_ca_promo_position_stack_before('{OTHER}','{ANCHOR}',48)||','||
 public.fn_ca_promo_position_stack_before('{USER}','{HOST}',48); ROLLBACK;""").splitlines()[-1]
        check(got == '50,48,48', f'{phase}: only the marked player at the marked anchor counts the earlier hand ({got})')
        check(q(f"SELECT public.fn_ca_promo_position_stack_before('{USER}','{ANCHOR}',48)") == '48',
              f'{phase}: without a settlement marker the stack is the hand\'s own')
        # A hand formed AFTER H1 was voided already received H1's refunded chips in its
        # pool stack (50), so H1's committed_at_fold must NOT be added again (no phantom clean chips).
        q(SEED)
        q(f"""UPDATE public.lightning_hand SET voided_at=now()-interval '10 s' WHERE hand_id='{H1}';
UPDATE public.lightning_hand SET settled_at=now()-interval '4 s' WHERE hand_id='{H2}';
INSERT INTO public.lightning_hand(hand_id,cluster_id,formed_at) VALUES('{H3}','{CLUSTER}',now()-interval '2 s');
INSERT INTO public.lightning_hand_player VALUES('{H3}','{USER}','{SLOT}',50,NULL,0);""")
        got_h3 = q(f"""BEGIN; INSERT INTO public.lightning_settlement_marker(txid,anchor_table_id,player_id,hand_id)
VALUES(pg_current_xact_id(),'{ANCHOR}','{USER}','{H3}');
SELECT public.fn_ca_promo_position_stack_before('{USER}','{ANCHOR}',50); ROLLBACK;""").splitlines()[-1]
        check(got_h3 == '50', f'{phase}: H3 formed after H1 was voided does not double-count H1 ({got_h3})')
        # Multi-hand fast-fold cascade (exact GRANDmasterFLUSH shape): H1 (-2) and H2 (-2)
        # both running/unsettled while H3 is dealt from 46 and loses 2 -> 44. H3 settles first
        # (base = 46 + 2 + 2 = 50, custody 50 -> 44), then H2 and H1 settle with custody staying 44.
        q(SEED)
        q(f"""INSERT INTO public.lightning_hand(hand_id,cluster_id,formed_at) VALUES('{H3}','{CLUSTER}',now()-interval '2 s');
INSERT INTO public.lightning_hand_player VALUES('{H3}','{USER}','{SLOT}',46,now()-interval '1 s',2);""")
        out_h3 = attempt(f"""BEGIN; INSERT INTO public.lightning_settlement_marker(txid,anchor_table_id,player_id,hand_id,host_table_id)
VALUES(pg_current_xact_id(),'{ANCHOR}','{USER}','{H3}','{HOST}');
SELECT public.fn_ca_promo_accept_cash_hand('{H3}','{HOST}','[{{"user_id":"{USER}","stack_before":46,"stack":44}}]',
 '{{"contributions":{{"{USER}":2}}}}','{{"{USER}":"{ANCHOR}"}}');
DELETE FROM public.lightning_settlement_marker WHERE txid=pg_current_xact_id(); COMMIT;""")
        check(out_h3 is None, f'{phase}: 3-hand cascade H3 settles while H1 and H2 are both still running')
        check(q(f"SELECT stack_before||','||principal_before FROM public.ca_promo_profit_cash_positions WHERE hand_id='{H3}'") == '50,50',
              f'{phase}: 3-hand cascade H3 records ca_promo_profit_cash_positions with stack_before=50')
        check(q('SELECT amount FROM public.ca_promo_principal_custody') == '44',
              f'{phase}: 3-hand cascade H3 charges custody once (50 -> 44)')
        for hid, sb, sa in [(H2, 48, 46), (H1, 50, 48)]:
            q(f"""BEGIN; INSERT INTO public.lightning_settlement_marker(txid,anchor_table_id,player_id,hand_id,host_table_id)
VALUES(pg_current_xact_id(),'{ANCHOR}','{USER}','{hid}','{HOST}');
SELECT public.fn_ca_promo_accept_cash_hand('{hid}','{HOST}','[{{"user_id":"{USER}","stack_before":{sb},"stack":{sa}}}]',
 '{{"contributions":{{"{USER}":2}}}}','{{"{USER}":"{ANCHOR}"}}'); COMMIT;""")
        check(q('SELECT amount FROM public.ca_promo_principal_custody') == '44',
              f'{phase}: 3-hand cascade H2 and H1 settling after H3 leave custody conserved at 44')


def check_no_later_migration_regresses():
    import re
    mig_dir = ROOT / 'supabase/migrations'
    for p in sorted(mig_dir.glob('*.sql')):
        if p.name <= CANDIDATE.name:
            continue
        text = p.read_text(encoding='utf-8', errors='replace')
        for fn in ('fn_ca_promo_profit_capture_cash', 'fn_ca_promo_accept_cash_hand'):
            if re.search(rf'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.{fn}\b', text, re.I):
                check('fn_ca_promo_position_stack_before' in text,
                      f'later migration {p.name} redefining {fn} keeps fn_ca_promo_position_stack_before')
        if re.search(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_ca_promo_position_stack_before\b', text, re.I):
            check('lightning_settlement_marker' in text and 'voided_at' in text,
                  f'later migration {p.name} redefining fn_ca_promo_position_stack_before keeps marker & voided_at guards')
    check(True, 'no later migration drops fn_ca_promo_position_stack_before or its guards')


try:
    run([PG / 'initdb', '-D', w / 'd', '-U', 'postgres', '-A', 'trust', '--no-sync'])
    run([PG / 'pg_ctl', '-D', w / 'd', '-o', f'-k {sock} -c listen_addresses=', '-l', w / 'log', '-w', 'start'])
    q(SCHEMA)
    q(PREIMAGES.read_text())
    scenarios(fixed=False)
    q(CANDIDATE.read_text())
    check('lightning_promo_capture_preimage_refused' in (attempt(CANDIDATE.read_text()) or ''),
          'the migration refuses a body that is not its exact preimage')
    scenarios(fixed=True)
    check_no_later_migration_regresses()
    print(f'{len(passed)} checks passed')
finally:
    subprocess.run([str(PG / 'pg_ctl'), '-D', str(w / 'd'), '-m', 'immediate', 'stop'], capture_output=True, env=env)
    shutil.rmtree(w, ignore_errors=True)
