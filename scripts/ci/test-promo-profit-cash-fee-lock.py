"""Exercise the cash fee callback against the grant row a simultaneous cashout owns.

Use the full original promo scheme provided by test-promo-profit.py and the
repository's occupancy/exit functions. The report row and wallet/session sinks
below deliberately isolate the two resources implicated by the production cycle.
"""
import subprocess
import uuid
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def verify(db, club, table, migration, runfile, check):
    user, occupancy, hand = (str(uuid.uuid4()) for _ in range(3))
    key = 'fee-lock-' + user
    db.run(f"""
      CREATE TABLE fixture_only.fee_cashout_fact (id integer PRIMARY KEY, amount numeric NOT NULL);
      INSERT INTO fixture_only.fee_cashout_fact VALUES(1,0);
      CREATE TABLE fixture_only.fee_cashout_credit (identity text PRIMARY KEY, amount numeric NOT NULL);
      CREATE TABLE fixture_only.fee_cashout_session (member uuid PRIMARY KEY);
      ALTER TABLE tables ADD COLUMN IF NOT EXISTS current_players integer;
      ALTER TABLE table_seats ADD COLUMN IF NOT EXISTS seat_number integer,
        ADD COLUMN IF NOT EXISTS leave_pending boolean DEFAULT false;
      CREATE TABLE IF NOT EXISTS profiles(id uuid PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS seat_cashout_receipts(occupancy_id uuid PRIMARY KEY,
        user_id uuid,table_id uuid,seat_id uuid,seat_number integer,receipt jsonb);
      CREATE TABLE IF NOT EXISTS seat_departure_requests(occupancy_id uuid,user_id uuid,
        table_id uuid,seat_number integer,leave_mode text);
      CREATE TABLE IF NOT EXISTS seat_admin_departure_authorizations(occupancy_id uuid,
        user_id uuid,table_id uuid,seat_number integer);
      CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT 'service_role'::text$$;
      CREATE OR REPLACE FUNCTION public.fn_cash_session_close(uuid,uuid,numeric,text)
        RETURNS void LANGUAGE sql AS $$INSERT INTO fixture_only.fee_cashout_session VALUES($1)$$;
      CREATE OR REPLACE FUNCTION public.atomic_credit_wallet_and_log(uuid,numeric,text,text,uuid,uuid,uuid,text)
        RETURNS boolean LANGUAGE plpgsql AS $$BEGIN
          INSERT INTO fixture_only.fee_cashout_credit VALUES($8,$2);
          UPDATE fixture_only.fee_cashout_fact SET amount=amount+$2 WHERE id=1;
          RETURN true;
        END$$;
      INSERT INTO club_members(club_id,user_id,chip_balance) VALUES('{club}','{user}',100);
      SELECT fn_ca_promo_play_through_record_grant('{club}','{user}',10,'club_promo','{key}',
        NULL,'promo_wallet','{club}',NULL);
      INSERT INTO table_seats(table_id,user_id,stack,seat_number,occupancy_id)
        VALUES('{table}','{user}',25,100,'{occupancy}');
    """)
    for name in ('fn_caller_is_engine', 'atomic_seat_cashout_locked', 'fn_cashout_seat_occupancy'):
        runfile(ROOT / 'scripts/ci/fixtures/lightning-rebuy-expiry' / (name + '.sql'))
    grant = db.one(f"SELECT id FROM ca_promo_play_through_grants WHERE source_ref='{key}'")
    attribution = str(uuid.uuid4())
    # Atomic hand ownership is represented by the original attribution identity.
    # The original deferred trigger and the complete FIFO/winnings state run.
    db.run(f"INSERT INTO ca_promo_cash_hand_clocks VALUES('{hand}','{table}',1,clock_timestamp())")
    fee = f"""
      BEGIN;
      WITH claimed AS (
        INSERT INTO rake_attributions(id,club_id,player_id,rake_amount,hand_id)
        VALUES('{attribution}','{club}','{user}',20,'{hand}')
        ON CONFLICT (id) DO NOTHING RETURNING rake_amount
      )
      UPDATE fixture_only.fee_cashout_fact f SET amount=f.amount+c.rake_amount FROM claimed c WHERE f.id=1;
      COMMIT;"""
    leave = f"SELECT fn_cashout_seat_occupancy('{user}','{table}',100,'{occupancy}',NULL)"

    @contextmanager
    def held_grant(with_scope=False):
        ctl = subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',db.socket,
                                '-p',db.port,'-U','postgres','-d',db.name],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            scope_lock = (f"DO $scope$ BEGIN PERFORM fn_ca_promo_profit_try_member('{club}','{user}'); END $scope$;"
                          if with_scope else '')
            ctl.stdin.write(f"BEGIN; {scope_lock} SELECT 'grant-held' FROM ca_promo_play_through_grants WHERE id='{grant}' FOR UPDATE;\n")
            ctl.stdin.flush()
            if ctl.stdout.readline().strip() != 'grant-held':
                raise AssertionError('second connection did not lock the original grant')
            yield ctl
        finally:
            if ctl.poll() is None:
                ctl.stdin.write("ROLLBACK;\n")
                ctl.stdin.flush()
            _, err = ctl.communicate(timeout=8)
            if ctl.returncode:
                raise AssertionError(err)

    # Capture the original blocking acquisition using a short test-only lock
    # deadline. Both sessions stay local, and no production failure is induced.
    with held_grant():
        old = db.run("SET lock_timeout='150ms';"+fee, check=False)
        if old.returncode == 0 or 'canceling statement due to lock timeout' not in old.stderr:
            raise AssertionError('original deferred fee did not wait for the competing grant')
    runfile(migration)
    check('cash fee callback retains its private deferred trigger',"""
      SELECT md5(pg_get_functiondef(p.oid))='2d1a95ea3f79d752dad7af75d0d3107f'
        AND p.prosecdef AND t.tgdeferrable AND t.tginitdeferred
        AND NOT has_function_privilege('service_role',p.oid,'execute')
        AND NOT has_function_privilege('authenticated',p.oid,'execute')
        AND NOT has_function_privilege('anon',p.oid,'execute')
      FROM pg_proc p JOIN pg_trigger t ON t.tgfoid=p.oid
      WHERE t.tgrelid='public.rake_attributions'::regclass AND t.tgname='ca_promo_profit_original_cash_fee'
    """,'t')
    with held_grant(with_scope=True):
        busy = db.run("\\set VERBOSITY verbose\nSET statement_timeout='3s';"+fee, check=False)
        if busy.returncode == 0 or '55P03' not in busy.stderr or 'original_bbj_member_scope_busy' not in busy.stderr:
            raise AssertionError('occupied promo scope failed to return its retryable result: '+busy.stderr)
    with held_grant() as ctl:
        busy = db.run("\\set VERBOSITY verbose\nSET statement_timeout='3s';"+fee,check=False)
        if busy.returncode == 0 or '55P03' not in busy.stderr or 'could not obtain lock' not in busy.stderr:
            raise AssertionError('open grant failed to return its retryable result: '+busy.stderr)
        check('busy fee rolls back report and attribution together',f"""
          SELECT amount=0 AND NOT EXISTS(SELECT 1 FROM rake_attributions WHERE id='{attribution}')
            AND NOT EXISTS(SELECT 1 FROM fixture_only.profit_notice_calls WHERE grant_id='{grant}')
          FROM fixture_only.fee_cashout_fact""",'t')
        ctl.stdin.write(leave+"; COMMIT;\nSELECT 'exit-done';\n")
        ctl.stdin.flush()
        if '"ok": true' not in ctl.stdout.readline() or ctl.stdout.readline().strip() != 'exit-done':
            raise AssertionError('the original occupancy could not cash out after contention')
    db.run(fee)
    db.run(fee)
    check('original fee and cashout replay both return exactly one outcome',f"""
      SELECT ({leave})=(SELECT receipt FROM seat_cashout_receipts WHERE occupancy_id='{occupancy}')
        AND (SELECT count(*)=1 AND sum(amount)=25 FROM fixture_only.fee_cashout_credit)
        AND (SELECT count(*)=1 FROM fixture_only.fee_cashout_session)
        AND (SELECT count(*)=1 FROM rake_attributions WHERE id='{attribution}')
        AND (SELECT count(*)=1 FROM fixture_only.profit_notice_calls WHERE grant_id='{grant}')
        AND (SELECT amount=45 FROM fixture_only.fee_cashout_fact)
    """,'t')
    # A genuinely new fee must commit even when the old, terminal grant is
    # locked by another transaction. The original release timestamp stays final.
    after = str(uuid.uuid4())
    with held_grant(with_scope=True):
        db.run(f"""SET lock_timeout='150ms';
          INSERT INTO rake_attributions(id,club_id,player_id,rake_amount,hand_id)
          VALUES('{after}','{club}','{user}',1,'{hand}')""")
    check('terminal member retained its one release across a later fee',f"""
      SELECT EXISTS(SELECT 1 FROM rake_attributions WHERE id='{after}')
        AND (SELECT count(*)=1 FROM fixture_only.profit_notice_calls WHERE grant_id='{grant}')
    """,'t')
